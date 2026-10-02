import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@enkaku/client'
import { serve } from '@enkaku/server'
import { DirectTransports } from '@enkaku/transport'
import type {
  BaseProtocol,
  BaseClientMessage as HostClientMessage,
  BaseServerMessage as HostServerMessage,
} from '@mokei/host-protocol'
import { describe, expect, test, vi } from 'vitest'

import { createClient } from '../src/daemon.js'
import { serveHostDaemon } from '../src/daemon-server.js'
import { createHandlers, killChildren } from '../src/server.js'

// Tejika owns socket permissions and pid ownership.

describe('killChildren', () => {
  test('kills every tracked child and empties the map', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'])
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    const children = new Map([['c1', child]])

    killChildren(children)

    expect(children.size).toBe(0)
    await exited // resolves only if the child was actually killed
  })
})

describe('spawn handler child-exit cleanup', () => {
  test('dispatches context:stop and prunes maps when a spawned child self-exits', async () => {
    const children = new Map<string, ReturnType<typeof spawn>>()
    const handlers = createHandlers({
      activeContexts: {},
      children,
      events: new EventTarget(),
      startedTime: Date.now(),
    })
    const transports = new DirectTransports<HostServerMessage, HostClientMessage>()
    const server = serve<BaseProtocol>({
      handlers,
      transport: transports.server,
      requireAuth: false,
    })
    const client = new Client<BaseProtocol>({ transport: transports.client })

    const stops: Array<Record<string, unknown>> = []
    const events = client.createStream('events')
    // StreamCall is also a Promise; events.close() rejects it with 'Close'.
    // Attach a no-op catch so the expected teardown rejection stays silent.
    void events.catch(() => {})
    void (async () => {
      for await (const event of events.readable) {
        if (event.type === 'context:stop') {
          stops.push(event)
        }
      }
    })()

    // Spawn a child that exits immediately on its own. Discard the channel promise
    // so the fire-and-forget close/dispose doesn't leave an unhandled rejection.
    client
      .createChannel('spawn', {
        param: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
      })
      .catch(() => {})

    await vi.waitFor(() => {
      expect(stops.length).toBeGreaterThan(0)
    })

    events.close()
    await client.dispose()
    await server.dispose()
    await transports.dispose()
  })
})

test('serves standalone flow errors and acknowledges shutdown over a socket', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mokei-host-daemon-'))
  const socketPath = join(directory, 'daemon.sock')
  const pidPath = join(directory, 'daemon.pid')
  const onShutdown = vi.fn(async () => {})
  const daemon = await serveHostDaemon({
    socketPath,
    pidPath,
    events: new EventTarget(),
    handleSignals: false,
    onShutdown,
  })
  const client = await createClient(socketPath)
  try {
    const info = await client.request('info')
    expect(info.activeContexts).toEqual({})
    expect(info.flowService).toMatchObject({ state: 'failed', error: { type: 'FlowUnavailable' } })
    await expect(client.request('flows.list')).rejects.toMatchObject({ code: 'FLOW_UNAVAILABLE' })
    await expect(client.request('shutdown')).resolves.toBeUndefined()
    await vi.waitFor(() => {
      expect(onShutdown).toHaveBeenCalledTimes(1)
      expect(existsSync(socketPath)).toBe(false)
      expect(existsSync(pidPath)).toBe(false)
    })
  } finally {
    await client.dispose()
    await daemon.close()
    await rm(directory, { recursive: true, force: true })
  }
})
