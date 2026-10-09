import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@enkaku/client'
import { type ProcedureHandlers, serve } from '@enkaku/server'
import { DirectTransports, Transport } from '@enkaku/transport'
import type {
  BaseProtocol,
  BaseClientMessage as HostClientMessage,
  HostEvent,
  HostEvents,
  BaseServerMessage as HostServerMessage,
  Protocol,
} from '@mokei/host-protocol'
import { SpanStatusCode } from '@opentelemetry/api'
import { EventEmitter } from '@sozai/event'
import { describe, expect, test, vi } from 'vitest'

import { createClient } from '../src/daemon.js'
import { type HandlersContext, serveHostDaemon } from '../src/daemon-server.js'
import { createHandlers, killChildren } from '../src/server.js'
import { useTestTracing } from './support/otel.js'

const { exporter } = useTestTracing()

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
  test('child exit without client abort ends the proxy tracing as lost', async () => {
    const children = new Map<string, ReturnType<typeof spawn>>()
    const handlers = createHandlers({
      activeContexts: {},
      children,
      events: new EventEmitter<HostEvents>(),
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

    const contextSpan = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
    expect(contextSpan?.attributes['error.type']).toBe('context.lost')
    expect(contextSpan?.status.code).toBe(SpanStatusCode.ERROR)

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
    events: new EventEmitter<HostEvents>(),
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
    events: new EventEmitter<HostEvents>(),
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
    events: new EventEmitter<HostEvents>(),
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
    events: new EventEmitter<HostEvents>(),
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

test.each([true, false])(
  'context:message is built only with a subscriber (%s), forwarding stays unchanged',
  async (subscribed) => {
    const events = new EventEmitter<HostEvents>()
    const messages: Array<{ from: string; message: unknown }> = []
    if (subscribed)
      events.on('context:message', (event) => {
        messages.push(event.data)
      })
    const dispatch = vi.spyOn(events, 'fire')
    const transports = new DirectTransports<HostServerMessage, HostClientMessage>()
    const server = serve<BaseProtocol>({
      handlers: createHandlers({
        activeContexts: {},
        children: new Map(),
        events,
        tracing: { payloads: 'on' },
        startedTime: Date.now(),
      }),
      transport: transports.server,
      requireAuth: false,
    })
    const client = new Client<BaseProtocol>({ transport: transports.client })
    const channel = client.createChannel('spawn', {
      param: {
        command: process.execPath,
        args: [
          '-e',
          "require('node:readline').createInterface({input:process.stdin}).on('line', line => { const request = JSON.parse(line); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{receivedToken:request.params.token}})+'\\n') })",
        ],
      },
    })
    void channel.catch(() => {})
    const request = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'tools/call' as const,
      params: { name: 'echo', token: 't' },
    }
    try {
      const writer = channel.writable.getWriter()
      await writer.write(request)
      writer.releaseLock()
      const reader = channel.readable.getReader()
      const response = await reader.read()
      reader.releaseLock()
      expect(response.value).toMatchObject({ result: { receivedToken: 't' } })
      if (subscribed) {
        expect(messages.find((entry) => entry.from === 'client')?.message).toMatchObject({
          params: { token: '[redacted]' },
        })
      } else {
        expect(dispatch.mock.calls.some(([type]) => type === 'context:message')).toBe(false)
      }
      expect(request.params.token).toBe('t')
    } finally {
      channel.close()
      await client.dispose()
      await server.dispose()
      await transports.dispose()
    }
  },
)

function eventContext(writable: WritableStream<HostEvent>, signal: AbortSignal) {
  return {
    signal,
    writable,
    param: undefined as never,
    message: {
      header: { typ: 'JWT' as const, alg: 'none' as const },
      payload: {
        typ: 'stream' as const,
        prc: 'events' as const,
        rid: 'event-subscription',
        prm: undefined as never,
      },
    },
  }
}

function eventHandlers(events: EventEmitter<HostEvents>, options: Partial<HandlersContext> = {}) {
  return createHandlers({
    activeContexts: {},
    children: new Map(),
    events,
    startedTime: 1,
    ...options,
  })
}

test('forwards span:start, span:end, log and trace:summary events', async () => {
  const events = new EventEmitter<HostEvents>()
  const received: Array<HostEvent> = []
  const controller = new AbortController()
  const subscription = eventHandlers(events).events(
    eventContext(
      new WritableStream({
        write: (event) => {
          received.push(event)
        },
      }),
      controller.signal,
    ),
  )
  const span = {
    traceID: 'trace-one',
    spanID: 'span-one',
    name: 'tools/call',
    kind: 1,
    startTime: 1,
    attributes: {},
    links: [],
  }
  const messages: Array<HostEvent> = [
    { type: 'span:start', meta: { eventID: 'start', time: 1 }, data: span },
    {
      type: 'span:end',
      meta: { eventID: 'end', time: 2 },
      data: { ...span, endTime: 2, status: { code: 1 }, events: [] },
    },
    {
      type: 'log',
      meta: { eventID: 'log', time: 2 },
      data: {
        traceID: 'trace-one',
        spanID: 'span-one',
        logID: 'log-one',
        timestamp: 2,
        level: 'info',
        category: ['test'],
        message: 'done',
        properties: {},
      },
    },
    {
      type: 'trace:summary',
      meta: { eventID: 'summary', time: 2 },
      data: {
        traceID: 'trace-one',
        rootSpanID: 'span-one',
        name: 'tools/call',
        kind: 'mcp',
        active: false,
        outcome: 'ok',
        startTime: 1,
        attributes: {},
        spanCount: 1,
        errorCount: 0,
        droppedCount: 0,
        revision: 2,
      },
    },
  ]
  try {
    for (const { type, ...detail } of messages) events.fire(type, detail)
    await vi.waitFor(() => expect(received).toEqual(messages))
  } finally {
    controller.abort()
    await subscription
  }
})

test.each([
  {
    name: 'a subscriber that does not read is disconnected after 2000 queued events; others keep receiving',
    eventBufferLimit: undefined,
  },
  {
    name: 'uses the configured subscriber event bound; others keep receiving',
    eventBufferLimit: 3,
  },
])(
  '$name',
  async ({ eventBufferLimit }) => {
    const events = new EventEmitter<HostEvents>()
    const handlers = eventHandlers(events, { eventBufferLimit })
    const slow = new TransformStream<HostEvent, HostEvent>()
    const slowController = new AbortController()
    const fastController = new AbortController()
    const received: Array<HostEvent> = []
    let disconnected = false
    const slowSubscription = Promise.resolve(
      handlers.events(eventContext(slow.writable, slowController.signal)),
    ).then(() => {
      disconnected = true
    })
    const fastSubscription = handlers.events(
      eventContext(
        new WritableStream({
          write: (event) => {
            received.push(event)
          },
        }),
        fastController.signal,
      ),
    )
    const limit = eventBufferLimit ?? 2000
    try {
      for (let index = 0; index < limit; index++) {
        events.fire('context:stop', {
          meta: { contextID: 'context-one', eventID: String(index), time: index },
        })
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(received).toHaveLength(index + 1)
      }
      expect(disconnected).toBe(false)
      events.fire('context:stop', {
        meta: { contextID: 'context-one', eventID: 'overflow', time: limit },
      })
      await vi.waitFor(() => expect(disconnected).toBe(true))
      expect(received).toHaveLength(limit + 1)
      events.fire('context:stop', {
        meta: { contextID: 'context-one', eventID: 'after', time: limit + 1 },
      })
      await vi.waitFor(() => expect(received).toHaveLength(limit + 2))
      expect(slow.writable.locked).toBe(false)
      const reader = slow.readable.getReader()
      try {
        await expect(reader.read()).rejects.toBeUndefined()
      } finally {
        reader.releaseLock()
      }
    } finally {
      slowController.abort()
      fastController.abort()
      await slow.readable.cancel().catch(() => {})
      await Promise.all([slowSubscription, fastSubscription])
    }
  },
  20_000,
)

test('real Enkaku events stream disconnects at 2000 pending writes with a stalled transport', async () => {
  const events = new EventEmitter<HostEvents>()
  const handlers = eventHandlers(events)
  const incoming = new TransformStream<HostClientMessage, HostClientMessage>()
  const outgoing = new TransformStream<HostServerMessage, HostServerMessage>()
  const input = incoming.writable.getWriter()
  const output = outgoing.readable.getReader()
  const transport = new Transport<HostClientMessage, HostServerMessage>({
    stream: { readable: incoming.readable, writable: outgoing.writable },
  })
  let writer: WritableStreamDefaultWriter<HostEvent> | undefined
  let ended = false
  const server = serve<BaseProtocol>({
    handlers: {
      ...handlers,
      events: async (ctx) => {
        const getWriter = ctx.writable.getWriter.bind(ctx.writable)
        const spy = vi.spyOn(ctx.writable, 'getWriter').mockImplementation(() => {
          writer = getWriter()
          return writer
        })
        try {
          await handlers.events(ctx)
        } finally {
          spy.mockRestore()
          ended = true
        }
      },
    },
    transport,
    requireAuth: false,
  })
  const dispatch = (index: number) => {
    events.fire('context:stop', {
      meta: { contextID: 'context-one', eventID: String(index), time: index },
    })
  }
  try {
    await input.write({
      header: { typ: 'JWT', alg: 'none' },
      payload: { typ: 'stream', prc: 'events', rid: 'stalled-events', prm: undefined as never },
    })
    await vi.waitFor(() => expect(writer).toBeDefined())
    expect(writer?.desiredSize).toBe(1)
    // Yield between events so only transport backpressure can accumulate pending writes.
    for (let index = 0; index < 2004 && writer?.desiredSize !== -1999; index++) {
      dispatch(index)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    expect(writer?.desiredSize).toBe(-1999)
    expect(ended).toBe(false)
    dispatch(2004)
    await vi.waitFor(() => expect(ended).toBe(true))
    // Resume transport reads to observe the protocol end message after disconnect.
    let message: HostServerMessage | undefined
    do {
      const result = await output.read()
      expect(result.done).toBe(false)
      message = result.value
    } while (message?.payload.typ !== 'result')
    expect(message.payload).toMatchObject({ rid: 'stalled-events', typ: 'result' })
  } finally {
    await output.cancel().catch(() => {})
    output.releaseLock()
    await server.dispose()
    input.releaseLock()
    await transport.dispose()
  }
}, 10_000)

test('info includes tracing when tracingInfo is provided', async () => {
  const tracing = { lostSummaryCount: 4, droppedCount: 7 }
  const transports = new DirectTransports<HostServerMessage, HostClientMessage>()
  const server = serve<BaseProtocol>({
    handlers: eventHandlers(new EventEmitter<HostEvents>(), { tracingInfo: () => tracing }),
    transport: transports.server,
    requireAuth: false,
  })
  const client = new Client<BaseProtocol>({ transport: transports.client })
  try {
    expect(await client.request('info')).toMatchObject({ tracing })
    tracing.droppedCount = 8
    expect(await client.request('info')).toMatchObject({
      tracing: { lostSummaryCount: 4, droppedCount: 8 },
    })
  } finally {
    await client.dispose()
    await server.dispose()
    await transports.dispose()
  }
})

test('daemon shutdown ends a proxied context root as stopped', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mokei-host-shutdown-'))
  const socketPath = join(directory, 'daemon.sock')
  const events = new EventEmitter<HostEvents>()
  const observed = vi.fn()
  events.on('context:message', observed)
  const daemon = await serveHostDaemon({
    socketPath,
    pidPath: join(directory, 'daemon.pid'),
    events,
    handleSignals: false,
  })
  const client = await createClient(socketPath)
  const proxy = client.createChannel('spawn', {
    param: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1e9)'] },
  })
  void proxy.catch(() => {})
  try {
    await vi.waitFor(async () =>
      expect(Object.keys((await client.request('info')).activeContexts)).toHaveLength(1),
    )
    const writer = proxy.writable.getWriter()
    await writer.write({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pending' } })
    writer.releaseLock()
    await vi.waitFor(() => expect(observed).toHaveBeenCalled())
    await client.request('shutdown')
    await vi.waitFor(() => {
      const roots = exporter.getFinishedSpans().filter((span) => span.name === 'mcp.context')
      expect(roots).toHaveLength(1)
      expect(roots[0]?.status.code).toBe(SpanStatusCode.OK)
      expect(roots[0]?.attributes['error.type']).toBeUndefined()
      const requests = exporter.getFinishedSpans().filter((span) => span.name === 'mcp.tools/call')
      expect(requests).toHaveLength(1)
      expect(requests[0]?.status.code).toBe(SpanStatusCode.ERROR)
      expect(requests[0]?.attributes['error.type']).toBe('context.stopped')
    })
  } finally {
    await client.dispose()
    await daemon.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('proxy transport errors end the context and open requests as lost', async () => {
  const events = new EventEmitter<HostEvents>()
  const observed = vi.fn()
  events.on('context:message', observed)
  const children = new Map<string, ReturnType<typeof spawn>>()
  const handlers = createHandlers({ activeContexts: {}, children, events, startedTime: 1 })
  let input!: ReadableStreamDefaultController
  const failure = new Error('broken transport')
  const pending = Promise.resolve(
    handlers.spawn({
      signal: new AbortController().signal,
      param: { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1e9)'] },
      readable: new ReadableStream({
        start: (controller) => {
          input = controller
        },
      }),
      writable: new WritableStream(),
    } as Parameters<typeof handlers.spawn>[0]),
  )
  void pending.catch(() => {})
  try {
    input.enqueue({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pending' } })
    await vi.waitFor(() => expect(observed).toHaveBeenCalled())
    input.error(failure)
    await expect(pending).rejects.toBe(failure)
    const spans = exporter.getFinishedSpans().filter((span) => span.name.startsWith('mcp.'))
    expect(spans).toHaveLength(2)
    for (const span of spans) {
      expect(span.status.code).toBe(SpanStatusCode.ERROR)
      expect(span.attributes['error.type']).toBe('context.lost')
    }
    expect(children.size).toBe(0)
  } finally {
    input.error(failure)
    killChildren(children)
    await pending.catch(() => {})
  }
})
