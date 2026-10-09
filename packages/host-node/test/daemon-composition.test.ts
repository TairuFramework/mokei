import { ChildProcess } from 'node:child_process'
import { getEventListeners } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@enkaku/client'
import * as nodeStreams from '@enkaku/node-streams'
import type { ProcedureHandlers, Server } from '@enkaku/server'
import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, HostEvent, Protocol, ServerMessage } from '@mokei/host-protocol'
import { SpanStatusCode } from '@opentelemetry/api'
import type * as TejikaProcess from '@tejika/process'
import type { RunDaemonOptions } from '@tejika/process'
import { afterEach, beforeEach, describe, expect, type Mock, test, vi } from 'vitest'

import { runDaemon } from '../src/daemon.js'
import { composeHandlers, serveHostDaemon } from '../src/daemon-server.js'
import { createHandlers, killChildren } from '../src/server.js'
import * as spawnModule from '../src/spawn.js'
import { useTestTracing } from './support/otel.js'

const { exporter } = useTestTracing()

vi.mock('@enkaku/node-streams', { spy: true })

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
  vi.restoreAllMocks()
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

function subscribe(client: Client<Protocol>): {
  id: string
  close(): void
  received: Array<HostEvent>
} {
  const stream = client.createStream('events')
  void stream.catch(() => {})
  const received: Array<HostEvent> = []
  void (async () => {
    for await (const event of stream.readable) received.push(event)
  })().catch(() => {})
  return { id: stream.id, close: () => stream.close(), received }
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

  test('shares context state and events across connections, with delayed independent cancellation', async () => {
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
    const pair = transports[0]
    const server = servers[0]
    if (pair == null || server == null) throw new Error('First connection was not registered')
    const transport = pair.client
    const write = transport.write.bind(transport)
    vi.spyOn(transport, 'write').mockImplementation(async (message) => {
      if (message.payload.typ === 'abort' && message.payload.rid === first.id) {
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
      return write(message)
    })
    const ended = server.events.once('handlerEnd', {
      filter: ({ rid }) => rid === first.id,
    })
    first.close()
    await ended
    for (const type of [
      'context:start',
      'context:stop',
      'context:message',
      'service:status',
      'run:state',
      'inbox:added',
      'inbox:settled',
    ]) {
      expect(getEventListeners(events, type)).toHaveLength(1)
    }
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

  test('reports RPC shutdown cleanup failure after acknowledging the request', async () => {
    const failure = new Error('cleanup failed')
    const onError = vi.fn()
    await serveHostDaemon({
      events: new EventTarget(),
      onError,
      onShutdown: async () => {
        throw failure
      },
    })
    const client = connect()
    try {
      await expect(client.request('shutdown')).resolves.toBeUndefined()
      expect(onError).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure))
      expect(options?.onError).toBe(onError)
    } finally {
      await close().catch(() => {})
      close = vi.fn(async () => {})
    }
  })

  test('logs RPC shutdown cleanup failure when no error callback is injected', async () => {
    const failure = new Error('cleanup failed')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await serveHostDaemon({
      events: new EventTarget(),
      onShutdown: async () => {
        throw failure
      },
    })
    const client = connect()
    try {
      await expect(client.request('shutdown')).resolves.toBeUndefined()
      await vi.waitFor(() => expect(log).toHaveBeenCalledWith(failure))
    } finally {
      await close().catch(() => {})
      close = vi.fn(async () => {})
    }
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
    const stopped = new CustomEvent('context:stop', {
      detail: { meta: { contextID: 'test', eventID: 'stop', time: Date.now() } },
    })
    events.dispatchEvent(stopped)
    await pending
    expect(writable.locked).toBe(false)
    expect(getEventListeners(events, 'context:stop')).toHaveLength(1)
    expect(received).toHaveLength(1)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    otherController.abort()
    events.dispatchEvent(stopped)
    await otherPending
    expect(received).toHaveLength(1)
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

describe('proxy spawn cancellation', () => {
  test('does not acquire a child for an already-aborted request', async () => {
    const spawn = vi
      .spyOn(spawnModule, 'spawnContextServer')
      .mockRejectedValueOnce(new Error('unexpected spawn'))
    const handler = createHandlers({
      activeContexts: {},
      children: new Map(),
      events: new EventTarget(),
      startedTime: 0,
    }).spawn
    await expect(
      handler({ signal: AbortSignal.abort(), param: { command: process.execPath } } as Parameters<
        typeof handler
      >[0]),
    ).resolves.toBeUndefined()
    expect(spawn).not.toHaveBeenCalled()
  })

  test('kills a child acquired after cancellation and daemon cleanup', async () => {
    const acquired = await spawnModule.spawnContextServer({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1e9)'],
    })
    const exited = new Promise<void>((resolve) =>
      acquired.childProcess.once('exit', () => resolve()),
    )
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const spawn = vi.spyOn(spawnModule, 'spawnContextServer').mockImplementationOnce(async () => {
      entered.resolve()
      await gate.promise
      return acquired
    })
    const children = new Map<string, ChildProcess>()
    const activeContexts = {}
    const events = new EventTarget()
    const started = vi.fn()
    events.addEventListener('context:start', started)
    const signal = new AbortController()
    let input: ReadableStreamDefaultController | undefined
    const readable = new ReadableStream({
      start: (controller) => {
        input = controller
      },
    })
    const handler = createHandlers({ activeContexts, children, events, startedTime: 0 }).spawn
    const pending = Promise.resolve(
      handler({
        signal: signal.signal,
        param: { command: process.execPath },
        readable,
        writable: new WritableStream(),
      } as Parameters<typeof handler>[0]),
    ).catch(() => {})
    try {
      await entered.promise
      signal.abort()
      killChildren(children)
      gate.resolve()
      await vi.waitFor(() => expect(acquired.childProcess.killed).toBe(true))
      await pending
      expect(children.size).toBe(0)
      expect(activeContexts).toEqual({})
      expect(started).not.toHaveBeenCalled()
    } finally {
      gate.resolve()
      acquired.childProcess.kill()
      try {
        input?.close()
      } catch {}
      await pending
      await exited
      spawn.mockRestore()
    }
  })

  test('retains cleanup ownership during asynchronous transport conversion', async () => {
    const convert = nodeStreams.createTransportStream
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const conversion = vi
      .spyOn(nodeStreams, 'createTransportStream')
      .mockImplementationOnce(async (...args) => {
        entered.resolve()
        await gate.promise
        return await convert(...args)
      })
    const children = new Map<string, ChildProcess>()
    const activeContexts = {}
    const events = new EventTarget()
    const stopped = vi.fn()
    events.addEventListener('context:stop', stopped)
    const signal = new AbortController()
    let input: ReadableStreamDefaultController | undefined
    const readable = new ReadableStream({
      start: (controller) => {
        input = controller
      },
    })
    const handler = createHandlers({ activeContexts, children, events, startedTime: 0 }).spawn
    const pending = Promise.resolve(
      handler({
        signal: signal.signal,
        param: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1e9)'] },
        readable,
        writable: new WritableStream(),
      } as Parameters<typeof handler>[0]),
    ).catch(() => {})
    let acquired: ChildProcess | undefined
    try {
      await entered.promise
      acquired = [...children.values()][0]
      expect(acquired).toBeDefined()
      signal.abort()
      await vi.waitFor(() => expect(acquired?.killed).toBe(true))
      expect(children.size).toBe(0)
      expect(activeContexts).toEqual({})
      expect(stopped).toHaveBeenCalledTimes(1)
    } finally {
      gate.resolve()
      acquired?.kill()
      try {
        input?.close()
      } catch {}
      await pending
      conversion.mockRestore()
    }
  })
})

test.each(['cleanup', 'close', 'rpc', 'abort', 'SIGTERM', 'SIGINT'] as const)(
  '%s shutdown settles proxy spans before killing tracked children',
  async (method) => {
    const events = new EventTarget()
    const observed = vi.fn()
    events.addEventListener('context:message', observed)
    const signal = new AbortController()
    const daemon = await serveHostDaemon({
      events,
      signal: signal.signal,
      handleSignals: method === 'SIGTERM' || method === 'SIGINT',
    })
    const client = connect()
    const proxy = client.createChannel('spawn', {
      param: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1e9)'] },
    })
    void proxy.catch(() => {})
    await vi.waitFor(async () =>
      expect(Object.keys((await client.request('info')).activeContexts)).toHaveLength(1),
    )
    const writer = proxy.writable.getWriter()
    await writer.write({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pending' } })
    writer.releaseLock()
    await vi.waitFor(() => expect(observed).toHaveBeenCalled())
    const kill = ChildProcess.prototype.kill
    const spansAtKill: Array<Array<{ name: string; status: number; errorType: unknown }>> = []
    vi.spyOn(ChildProcess.prototype, 'kill').mockImplementation(function (
      this: ChildProcess,
      signal,
    ) {
      spansAtKill.push(
        exporter.getFinishedSpans().map((span) => ({
          name: span.name,
          status: span.status.code,
          errorType: span.attributes['error.type'],
        })),
      )
      return kill.call(this, signal)
    })
    if (method === 'cleanup') await options?.onShutdown?.()
    else if (method === 'close') await daemon.close()
    else if (method === 'rpc') await client.request('shutdown')
    else if (method === 'abort') signal.abort()
    else process.emit(method)

    expect(spansAtKill[0]).toEqual(
      expect.arrayContaining([
        { name: 'mcp.context', status: SpanStatusCode.OK, errorType: undefined },
        { name: 'mcp.tools/call', status: SpanStatusCode.ERROR, errorType: 'context.stopped' },
      ]),
    )
  },
)

test.each(['SIGTERM', 'SIGINT'] as const)(
  '%s during boot closes the daemon and settles active contexts',
  async (signal) => {
    const gate = Promise.withResolvers<void>()
    const boot = mocks.runDaemon.getMockImplementation()
    if (boot == null) throw new Error('Daemon boot mock was not installed')
    mocks.runDaemon.mockImplementationOnce(async (params: RunDaemonOptions<Protocol>) => {
      const daemon = await boot(params)
      await gate.promise
      return daemon
    })
    const events = new EventTarget()
    const stopped = vi.fn()
    events.addEventListener('context:stop', stopped)
    const onShutdown = vi.fn(async () => {})
    const pending = serveHostDaemon({ events, onShutdown })
    const client = connect()
    const proxy = client.createChannel('spawn', {
      param: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1e9)'] },
    })
    void proxy.catch(() => {})
    try {
      await vi.waitFor(async () =>
        expect(Object.keys((await client.request('info')).activeContexts)).toHaveLength(1),
      )
      process.emit(signal)
      expect(stopped).toHaveBeenCalledTimes(1)
      expect((await client.request('info')).activeContexts).toEqual({})
      expect(
        exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')?.status.code,
      ).toBe(SpanStatusCode.OK)
      gate.resolve()
      await pending
      expect(close).toHaveBeenCalledTimes(1)
      expect(onShutdown).toHaveBeenCalledTimes(1)
      expect(getEventListeners(process, signal)).toHaveLength(0)
    } finally {
      gate.resolve()
      await (await pending).close()
    }
  },
)

test.each(['SIGTERM', 'SIGINT'] as const)(
  '%s during boot leaves the production daemon socket closed',
  async (signal) => {
    const tejika = await vi.importActual<typeof TejikaProcess>('@tejika/process')
    const directory = await mkdtemp(join(tmpdir(), 'mokei-host-boot-signal-'))
    const socketPath = join(directory, 'daemon.sock')
    const pidPath = join(directory, 'daemon.pid')
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    mocks.runDaemon.mockImplementationOnce(async (params: RunDaemonOptions<Protocol>) => {
      entered.resolve()
      await gate.promise
      return tejika.runDaemon<Protocol>(params)
    })
    const onShutdown = vi.fn(async () => {})
    const pending = serveHostDaemon({ socketPath, pidPath, events: new EventTarget(), onShutdown })
    try {
      await entered.promise
      process.emit(signal)
      gate.resolve()
      await pending
      expect(await tejika.isSocketLive(socketPath)).toBe(false)
      expect(existsSync(socketPath)).toBe(false)
      expect(existsSync(pidPath)).toBe(false)
      expect(onShutdown).toHaveBeenCalledTimes(1)
    } finally {
      gate.resolve()
      await pending.then(
        (daemon) => daemon.close(),
        () => {},
      )
      await rm(directory, { recursive: true, force: true })
    }
  },
)
