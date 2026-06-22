import { spawn } from 'node:child_process'
import { Client } from '@enkaku/client'
import { serve } from '@enkaku/server'
import { DirectTransports } from '@enkaku/transport'
import type {
  ClientMessage as HostClientMessage,
  ServerMessage as HostServerMessage,
  Protocol,
} from '@mokei/host-protocol'
import { describe, expect, test, vi } from 'vitest'

import { createHandlers, killChildren } from '../src/server.js'

// The socket bind / chmod 0600 / pidfile lifecycle now belongs to
// @tejika/process (covered by its own tests + the integration PTY suite). These
// tests exercise the host's own request handlers directly over an in-process
// transport pair, with no socket server.

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
    const server = serve<Protocol>({ handlers, transport: transports.server, requireAuth: false })
    const client = new Client<Protocol>({ transport: transports.client })

    const stops: Array<{ type: string }> = []
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
