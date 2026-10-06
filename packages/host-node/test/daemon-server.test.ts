import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@enkaku/client'
import { type ProcedureHandlers, serve } from '@enkaku/server'
import { DirectTransports } from '@enkaku/transport'
import type {
  BaseProtocol,
  BaseClientMessage as HostClientMessage,
  BaseServerMessage as HostServerMessage,
  Protocol,
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

test('reports monitor procedures as unavailable when no monitor handlers are provided', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mokei-host-monitor-'))
  const socketPath = join(directory, 'daemon.sock')
  const daemon = await serveHostDaemon({
    socketPath,
    pidPath: join(directory, 'daemon.pid'),
    events: new EventTarget(),
    handleSignals: false,
  })
  const client = await createClient(socketPath)
  try {
    const stream = client.createStream('monitor.attach', {
      param: { url: 'http://127.0.0.1:1234/' },
    })
    await expect(stream).rejects.toMatchObject({ code: 'MONITOR_UNAVAILABLE' })
  } finally {
    await client.dispose()
    await daemon.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('uses a provided monitor handler without installing a duplicate fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mokei-host-monitor-handler-'))
  const socketPath = join(directory, 'daemon.sock')
  const attach = vi.fn<ProcedureHandlers<Protocol>['monitor.attach']>(() => {})
  const daemon = await serveHostDaemon({
    socketPath,
    pidPath: join(directory, 'daemon.pid'),
    events: new EventTarget(),
    handleSignals: false,
    handlers: { 'monitor.attach': attach },
  })
  const client = await createClient(socketPath)
  try {
    const stream = client.createStream('monitor.attach', {
      param: { url: 'http://127.0.0.1:1234/' },
    })
    await stream
    expect(attach).toHaveBeenCalledOnce()
  } finally {
    await client.dispose()
    await daemon.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('validates unsigned start requests before dispatch over the production socket', async () => {
  const directory = await mkdtemp('/tmp/mokei-host-validation-')
  const socketPath = join(directory, 'daemon.sock')
  const start = vi.fn<ProcedureHandlers<Protocol>['runs.start']>(({ param }) => ({
    runID: 'validated',
    label: 'Validated',
    state: 'completed' as const,
    createdAt: 1,
    updatedAt: 1,
    plan: { tools: [] },
    result: { content: [], output: param.input },
  }))
  const daemon = await serveHostDaemon({
    socketPath,
    pidPath: join(directory, 'daemon.pid'),
    events: new EventTarget(),
    handleSignals: false,
    handlers: { 'runs.start': start },
  })
  const client = await createClient(socketPath)
  const socket = createConnection(socketPath)
  try {
    const responses: Array<{ payload: { rid: string; code?: string } }> = []
    let buffered = ''
    socket.setEncoding('utf8').on('data', (chunk: string) => {
      buffered += chunk
      let end = buffered.indexOf('\n')
      while (end !== -1) {
        responses.push(JSON.parse(buffered.slice(0, end)))
        buffered = buffered.slice(end + 1)
        end = buffered.indexOf('\n')
      }
    })
    const malformed = [
      '{"flow":"registered","definition":{},"input":7,"extra":"unexpected"}',
      '{"flow":"registered","input":7}',
      '{"flow":"registered","extra":"unexpected"}',
      // JSON parsing preserves this as Infinity, which is not a JSON value.
      '{"flow":"registered","input":{"nested":[{"number":1e400}]}}',
    ]
    for (const [index, param] of malformed.entries()) {
      socket.write(
        `{"header":{"typ":"JWT","alg":"none"},"payload":{"typ":"request","rid":"invalid-${index}","prc":"runs.start","prm":${param}}}\n`,
      )
    }
    // Rejections travel the real socket; slow CI runners need more than the 1s default.
    await vi.waitFor(() => expect(responses).toHaveLength(malformed.length), { timeout: 10_000 })
    expect(responses.map(({ payload }) => payload.code)).toEqual(malformed.map(() => 'EK08'))
    expect(start).not.toHaveBeenCalled()
    const input = { nested: [null, true, 7, { value: ['ok', { deeper: false }] }] }
    await expect(
      client.request('runs.start', { param: { flow: 'registered', input } }),
    ).resolves.toMatchObject({ result: { output: input } })
    expect(start).toHaveBeenCalledOnce()
  } finally {
    socket.destroy()
    await client.dispose()
    await daemon.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)
