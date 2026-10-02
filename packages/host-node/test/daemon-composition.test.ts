import { ChildProcess } from 'node:child_process'
import { getEventListeners } from 'node:events'
import { Client } from '@enkaku/client'
import type { ProcedureHandlers, Server } from '@enkaku/server'
import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, HostEvent, Protocol, ServerMessage } from '@mokei/host-protocol'
import type * as TejikaProcess from '@tejika/process'
import type { RunDaemonOptions } from '@tejika/process'
import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from 'vitest'

import { runDaemon } from '../src/daemon.js'
import { composeHandlers, serveHostDaemon } from '../src/daemon-server.js'
import { createHandlers } from '../src/server.js'

const mocks = vi.hoisted(() => ({ runDaemon: vi.fn(), ensureDaemon: vi.fn() }))
vi.mock('@tejika/process', async (original) => ({
  ...(await original<typeof TejikaProcess>()),
  runDaemon: mocks.runDaemon,
  ensureDaemon: mocks.ensureDaemon,
}))

let options: RunDaemonOptions<Protocol> | undefined
let servers: Array<Server<Protocol>>
let transports: Array<DirectTransports<ServerMessage, ClientMessage>>
let clients: Array<Client<Protocol>>
let close: Mock<() => Promise<void>>

beforeEach(() => {
  options = undefined
  servers = []
  transports = []
  clients = []
  let closing: Promise<void> | undefined
  close = vi.fn(() => {
    closing ??= (async () => {
      for (const server of servers) await server.dispose()
      await options?.onShutdown?.()
    })()
    return closing
  })
  mocks.runDaemon.mockImplementation(async (params: RunDaemonOptions<Protocol>) => {
    options = params
    return {
      pid: process.pid,
      socketPath: '/tmp/mokei-test.sock',
      pidPath: '/tmp/mokei-test.pid',
      close,
    }
  })
})

afterEach(async () => {
  for (const client of clients) await client.dispose()
  await close()
  await Promise.all(transports.map((pair) => pair.dispose()))
  vi.clearAllMocks()
})

function connect(): Client<Protocol> {
  const pair = new DirectTransports<ServerMessage, ClientMessage>()
  transports.push(pair)
  if (options == null) throw new Error('Daemon not started')
  servers.push(options.serve(pair.server))
  const client = new Client<Protocol>({ transport: pair.client })
  clients.push(client)
  return client
}

function subscribe(client: Client<Protocol>): { close(): void; received: Array<HostEvent> } {
  const stream = client.createStream('events')
  void stream.catch(() => {})
  const received: Array<HostEvent> = []
  void (async () => {
    for await (const event of stream.readable) received.push(event)
  })().catch(() => {})
  return { close: () => stream.close(), received }
}

describe('daemon composition', () => {
  test('rejects duplicate registrations', () => {
    const info: ProcedureHandlers<Protocol>['info'] = () => ({
      activeContexts: {},
      startedTime: 0,
      flowService: { state: 'starting' },
    })
    expect(() => composeHandlers({ info }, { info })).toThrow('Duplicate procedure: info')
  })

  test('shares context state and events across connections, with independent cancellation', async () => {
    const events = new EventTarget()
    await serveHostDaemon({ events, handleSignals: false })
    const firstClient = connect()
    const secondClient = connect()
    const first = subscribe(firstClient)
    const second = subscribe(secondClient)
    await vi.waitFor(() => expect(getEventListeners(events, 'context:start')).toHaveLength(2))
    const proxy = firstClient.createChannel('spawn', {
      param: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1e9)'] },
    })
    void proxy.catch(() => {})
    await vi.waitFor(async () => {
      expect(Object.keys((await secondClient.request('info')).activeContexts)).toHaveLength(1)
      expect(first.received.filter((event) => event.type === 'context:start')).toHaveLength(1)
      expect(second.received.filter((event) => event.type === 'context:start')).toHaveLength(1)
    })
    const firstInfo = await firstClient.request('info')
    expect((await secondClient.request('info')).startedTime).toBe(firstInfo.startedTime)
    first.close()
    await vi.waitFor(() => expect(getEventListeners(events, 'context:start')).toHaveLength(1))
    proxy.close()
    await vi.waitFor(() => {
      expect(second.received.filter((event) => event.type === 'context:stop')).toHaveLength(1)
      expect(first.received.filter((event) => event.type === 'context:stop')).toHaveLength(0)
    })
    second.close()
  })

  test('forwards service events and reads injected live status', async () => {
    const events = new EventTarget()
    let ready = false
    await serveHostDaemon({ events, flowStatus: () => ({ state: ready ? 'ready' : 'starting' }) })
    const client = connect()
    const subscription = subscribe(client)
    await vi.waitFor(() => expect(getEventListeners(events, 'service:status')).toHaveLength(1))
    expect((await client.request('info')).flowService).toEqual({ state: 'starting' })
    ready = true
    const detail = {
      meta: { eventID: 'status', time: Date.now() },
      data: { service: 'flow', status: { state: 'ready' } },
    }
    events.dispatchEvent(new CustomEvent('service:status', { detail }))
    await vi.waitFor(() =>
      expect(subscription.received).toEqual([{ type: 'service:status', ...detail }]),
    )
    expect((await client.request('info')).flowService).toEqual({ state: 'ready' })
    subscription.close()
  })

  test('fills missing flow procedures without overriding injected handlers', async () => {
    await serveHostDaemon({ events: new EventTarget(), handlers: { 'flows.list': () => [] } })
    const client = connect()
    expect(await client.request('flows.list')).toEqual([])
    await expect(client.request('inbox.get', { param: { id: 'missing' } })).rejects.toMatchObject({
      code: 'FLOW_UNAVAILABLE',
    })
    expect((await client.request('info')).flowService).toMatchObject({
      state: 'failed',
      error: { type: 'FlowUnavailable', message: expect.stringContaining('entry') },
    })
  })

  test('standalone flow procedures return FLOW_UNAVAILABLE', async () => {
    await serveHostDaemon({ events: new EventTarget() })
    const client = connect()
    await expect(client.request('flows.list')).rejects.toMatchObject({ code: 'FLOW_UNAVAILABLE' })
  })

  test('acknowledges shutdown before closing and invokes cleanup once', async () => {
    const onShutdown = vi.fn(async () => {})
    await serveHostDaemon({
      events: new EventTarget(),
      onShutdown,
      socketPath: '/tmp/custom.sock',
      pidPath: '/tmp/custom.pid',
      handleSignals: false,
      shutdownTimeoutMs: 100,
    })
    expect(options).toMatchObject({
      app: 'mokei',
      socketPath: '/tmp/custom.sock',
      pidPath: '/tmp/custom.pid',
      handleSignals: false,
      shutdownTimeoutMs: 100,
    })
    const client = connect()
    await expect(client.request('shutdown')).resolves.toBeUndefined()
    await vi.waitFor(() => expect(onShutdown).toHaveBeenCalledTimes(1))
    await close()
    expect(onShutdown).toHaveBeenCalledTimes(1)
  })

  test('kills tracked children while injected cleanup is pending', async () => {
    const { promise: pendingCleanup, resolve: finishCleanup } = Promise.withResolvers<void>()
    const onShutdown = vi.fn(() => pendingCleanup)
    await serveHostDaemon({ events: new EventTarget(), onShutdown })
    const client = connect()
    const proxy = client.createChannel('spawn', {
      param: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1e9)'] },
    })
    void proxy.catch(() => {})
    await vi.waitFor(async () =>
      expect(Object.keys((await client.request('info')).activeContexts)).toHaveLength(1),
    )
    const kill = vi.spyOn(ChildProcess.prototype, 'kill')
    const cleanup = options?.onShutdown?.()
    try {
      await vi.waitFor(() => expect(kill).toHaveBeenCalled())
      expect(onShutdown).toHaveBeenCalledTimes(1)
    } finally {
      finishCleanup()
      await cleanup
      kill.mockRestore()
    }
  })

  test('kills tracked children when injected cleanup fails', async () => {
    await serveHostDaemon({
      events: new EventTarget(),
      onShutdown: async () => {
        throw new Error('cleanup failed')
      },
    })
    const client = connect()
    const proxy = client.createChannel('spawn', {
      param: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1e9)'] },
    })
    void proxy.catch(() => {})
    await vi.waitFor(async () =>
      expect(Object.keys((await client.request('info')).activeContexts)).toHaveLength(1),
    )
    const kill = vi.spyOn(ChildProcess.prototype, 'kill')
    try {
      await expect(options?.onShutdown?.()).rejects.toThrow('cleanup failed')
      expect(kill).toHaveBeenCalled()
    } finally {
      await close().catch(() => {})
      kill.mockRestore()
      close = vi.fn(async () => {})
    }
  })
})

describe('event subscription cleanup', () => {
  test('already-aborted subscriptions settle without acquiring or leaking a writer', async () => {
    const events = new EventTarget()
    const writable = new WritableStream<HostEvent>()
    const handler = createHandlers({
      activeContexts: {},
      children: new Map<string, ChildProcess>(),
      events,
      startedTime: 0,
    }).events
    const context = { signal: AbortSignal.abort(), writable } as Parameters<typeof handler>[0]
    await handler(context)
    expect(writable.locked).toBe(false)
    expect(getEventListeners(events, 'context:start')).toHaveLength(0)
  })

  test('writer failures settle and remove only their own event listeners', async () => {
    const events = new EventTarget()
    const writable = new WritableStream<HostEvent>({
      write: () => {
        throw new Error('disconnected')
      },
    })
    const handler = createHandlers({
      activeContexts: {},
      children: new Map<string, ChildProcess>(),
      events,
      startedTime: 0,
    }).events
    const controller = new AbortController()
    const otherController = new AbortController()
    const received: Array<HostEvent> = []
    const otherWritable = new WritableStream<HostEvent>({
      write: (event) => {
        received.push(event)
      },
    })
    const otherPending = handler({
      signal: otherController.signal,
      writable: otherWritable,
    } as Parameters<typeof handler>[0])
    const pending = handler({ signal: controller.signal, writable } as Parameters<
      typeof handler
    >[0])
    events.dispatchEvent(
      new CustomEvent('context:stop', {
        detail: { meta: { contextID: 'test', eventID: 'stop', time: Date.now() } },
      }),
    )
    await pending
    expect(writable.locked).toBe(false)
    expect(getEventListeners(events, 'context:stop')).toHaveLength(1)
    expect(received).toHaveLength(1)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    otherController.abort()
    await otherPending
    expect(otherWritable.locked).toBe(false)
    expect(getEventListeners(events, 'context:stop')).toHaveLength(0)
  })
})

test('an explicit daemon entry overrides the default', async () => {
  await runDaemon({ entry: '/tmp/application-entry.js', socketPath: '/tmp/custom.sock' })
  expect(mocks.ensureDaemon).toHaveBeenLastCalledWith({
    app: 'mokei',
    entry: '/tmp/application-entry.js',
    socketPath: '/tmp/custom.sock',
  })
  await runDaemon()
  expect(mocks.ensureDaemon.mock.lastCall?.[0].entry).toMatch(/\/server\.js$/)
})
