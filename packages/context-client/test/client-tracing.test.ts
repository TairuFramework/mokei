import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { META_SUBSCRIPTION_ID } from '@mokei/context-protocol'
import { RPCError, TransportClosedError } from '@mokei/context-rpc'
import type { Attributes } from '@opentelemetry/api'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { afterEach, expect, test, vi } from 'vitest'

import { getMokeiLogger } from '../../logger/src/index.js'
import { ContextClient } from '../src/client.js'
import type { ClientTracing } from '../src/client-tracing.js'
import { createExchangeTracer } from '../src/client-tracing.js'
import type { ClientParams } from '../src/types.js'
import { useTestTracing } from './support/otel.js'

const { exporter } = useTestTracing()
const disposals: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose()
})
const tracer = trace.getTracer('test')
const result = { content: [{ type: 'text' as const, text: 'ok' }] }
async function fixture(
  tracing?: ClientTracing,
  protocolVersion: '2025-11-25' | '2026-07-28' = '2025-11-25',
  options: Partial<ClientParams> = {},
) {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({
    transport: transports.client,
    protocolVersion,
    tracing,
    listRoots: [],
    ...options,
  })
  disposals.push(() => transports.dispose())
  const setup = client.request('tools/list', {})
  const frame = (await transports.server.read()).value
  if (!frame || (typeof frame.id !== 'number' && typeof frame.id !== 'string'))
    throw new Error('Expected setup request')
  await transports.server.write({
    jsonrpc: '2.0',
    id: frame.id,
    result:
      protocolVersion === '2025-11-25'
        ? {
            capabilities: {},
            protocolVersion,
            serverInfo: { name: 'test', version: '1' },
          }
        : {
            resultType: 'complete',
            supportedVersions: ['2026-07-28'],
            capabilities: {},
            ttlMs: 0,
            cacheScope: 'private',
          },
  })
  if (protocolVersion === '2025-11-25') await transports.server.read()
  const list = (await transports.server.read()).value
  if (!list || (typeof list.id !== 'number' && typeof list.id !== 'string'))
    throw new Error('Expected list request')
  await transports.server.write({
    jsonrpc: '2.0',
    id: list.id,
    result: { tools: [], ...(protocolVersion === '2026-07-28' ? { resultType: 'complete' } : {}) },
  })
  await setup
  const setupSpans = exporter.getFinishedSpans()
  exporter.reset()
  async function next() {
    const frame = (await transports.server.read()).value
    if (
      !frame ||
      !('method' in frame) ||
      (typeof frame.id !== 'number' && typeof frame.id !== 'string')
    )
      throw new Error('Expected request')
    return { ...frame, id: frame.id, params: frame.params as Record<string, unknown> | undefined }
  }
  async function call() {
    const pending = client.request('tools/call', { name: 'echo', arguments: { value: 'hello' } })
    const frame = await next()
    await transports.server.write({
      jsonrpc: '2.0',
      id: frame.id,
      result: {
        ...result,
        ...(protocolVersion === '2026-07-28' ? { resultType: 'complete' } : {}),
      },
    })
    await pending
    return { ...frame, id: frame.id, params: frame.params as Record<string, unknown> | undefined }
  }
  return { client, transports, next, call, setupFrame: frame, setupSpans }
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected value')
  return value
}
function spans() {
  return exporter.getFinishedSpans().filter((span) => span.name === 'mcp.tools/call')
}
function binding(): ClientTracing {
  return { contextID: 'ctx', contextSpan: tracer.startSpan('mcp.context') }
}

test('tools/call produces one mcp.tools/call span with attributes and response event', async () => {
  const f = await fixture(binding())
  const frame = await f.call()
  expect(spans()).toHaveLength(1)
  expect(required(spans()[0]).attributes).toMatchObject({
    'jsonrpc.request.id': String(frame.id),
    'gen_ai.tool.name': 'echo',
    'mokei.context.id': 'ctx',
    'mokei.kind': 'mcp',
    'mokei.direction': 'client',
  })
  expect(required(spans()[0]).events).toMatchObject([
    { name: 'mcp.response', attributes: { payload: JSON.stringify(result) } },
  ])
})
test('the request span is active when traceparent is injected', async () => {
  const f = await fixture(binding())
  const frame = await f.call()
  expect((frame.params?._meta as Record<string, unknown> | undefined)?.traceparent).toContain(
    required(spans()[0]).spanContext().spanId,
  )
})
test('parent is the active span, with a link to the context span', async () => {
  const bound = binding()
  const f = await fixture(bound)
  await tracer.startActiveSpan('outer', async (outer) => {
    await f.call()
    expect(required(spans()[0]).parentSpanContext?.spanId).toBe(outer.spanContext().spanId)
    expect(required(required(spans()[0]).links[0]).context.spanId).toBe(
      bound.contextSpan?.spanContext().spanId,
    )
    outer.end()
  })
})
test('without an active span the parent is the bound context span, no link', async () => {
  const bound = binding()
  await (await fixture(bound)).call()
  expect(required(spans()[0]).parentSpanContext?.spanId).toBe(
    bound.contextSpan?.spanContext().spanId,
  )
  expect(required(spans()[0]).links).toEqual([])
})
test('unbound client parents only to the active span and has no mokei.context.id', async () => {
  const f = await fixture()
  await tracer.startActiveSpan('outer', async (outer) => {
    await f.call()
    expect(required(spans()[0]).parentSpanContext?.spanId).toBe(outer.spanContext().spanId)
    expect(required(spans()[0]).links).toEqual([])
    expect(required(spans()[0]).attributes['mokei.context.id']).toBeUndefined()
    outer.end()
  })
})
test('JSON-RPC error sets ERROR status and error.type -32601', async () => {
  const f = await fixture()
  const pending = f.client.request('tools/call', { name: 'missing' })
  const rejected = expect(pending).rejects.toThrow('missing')
  const frame = await f.next()
  await f.transports.server.write({
    jsonrpc: '2.0',
    id: frame.id,
    error: { code: -32601, message: 'missing' },
  })
  await rejected
  expect(required(spans()[0]).status.code).toBe(SpanStatusCode.ERROR)
  expect(required(spans()[0]).attributes['error.type']).toBe('-32601')
})
test('isError result sets error.type tool_error', async () => {
  const f = await fixture()
  const pending = f.client.request('tools/call', { name: 'bad' })
  const frame = await f.next()
  await f.transports.server.write({
    jsonrpc: '2.0',
    id: frame.id,
    result: { ...result, isError: true },
  })
  await pending
  expect(required(spans()[0]).status.code).toBe(SpanStatusCode.ERROR)
  expect(required(spans()[0]).attributes['error.type']).toBe('tool_error')
})
test('transport closure settles a standalone outgoing exchange as context.lost', async () => {
  const f = await fixture()
  const pending = f.client.request('tools/call', { name: 'echo' })
  const rejected = expect(pending).rejects.toBeInstanceOf(TransportClosedError)
  await f.next()
  await f.transports.dispose()
  await rejected
  expect(spans()).toHaveLength(1)
  expect(required(spans()[0]).status.code).toBe(SpanStatusCode.ERROR)
  expect(required(spans()[0]).attributes['error.type']).toBe('context.lost')
})
test('a local request failure records error.type _OTHER', async () => {
  const f = await fixture()
  const error = new TypeError('Request ID callback failed')
  await expect(
    f.client.request(
      'tools/call',
      { name: 'echo' },
      {
        onRequestID() {
          throw error
        },
      },
    ),
  ).rejects.toBe(error)
  expect(spans()).toHaveLength(1)
  expect(required(spans()[0]).status.code).toBe(SpanStatusCode.ERROR)
  expect(required(spans()[0]).attributes['error.type']).toBe('_OTHER')
})
test('a pre-aborted signal with an RPCError reason records cancellation', async () => {
  const f = await fixture()
  const reason = new RPCError({ code: -32601, message: 'Caller cancelled' })
  const onRequestID = vi.fn()
  await expect(
    f.client.request(
      'tools/call',
      { name: 'echo' },
      {
        signal: AbortSignal.abort(reason),
        onRequestID,
      },
    ),
  ).rejects.toBe(reason)
  expect(onRequestID).not.toHaveBeenCalled()
  expect(spans()).toHaveLength(1)
  expect(required(spans()[0]).status.code).toBe(SpanStatusCode.ERROR)
  expect(required(spans()[0]).attributes['error.type']).toBe('cancelled')
})
test('each MRTR retry leg is its own span linked to the first leg', async () => {
  const f = await fixture(binding(), '2026-07-28')
  const pending = f.client.request('tools/call', { name: 'echo' })
  for (let leg = 0; leg < 3; leg++) {
    const frame = await f.next()
    await f.transports.server.write({
      jsonrpc: '2.0',
      id: frame.id,
      result:
        leg < 2
          ? {
              resultType: 'input_required' as const,
              inputRequests: { roots: { method: 'roots/list' as const, params: {} } },
              requestState: `state-${leg}`,
            }
          : { ...result, resultType: 'complete' },
    } as ServerMessage)
  }
  await pending
  expect(spans()).toHaveLength(3)
  for (const span of spans().slice(1))
    expect(
      span.links.some((link) => link.context.spanId === required(spans()[0]).spanContext().spanId),
    ).toBe(true)
})
test('payloads off records no mokei.mcp.request and no mcp.response payload', async () => {
  await (await fixture({ ...binding(), payloads: 'off' })).call()
  expect(required(spans()[0]).attributes['mokei.mcp.request']).toBeUndefined()
  expect(required(spans()[0]).events).toHaveLength(1)
  expect(required(required(spans()[0]).events[0]).attributes?.payload).toBeUndefined()
})
test('endTracing lost ends an in-flight span once despite a later response', async () => {
  const f = await fixture()
  f.client.setTracing(binding())
  const pending = f.client.request('tools/call', { name: 'echo' })
  const frame = await f.next()
  f.client.endTracing('lost')
  f.client.endTracing('lost')
  expect(spans()).toHaveLength(1)
  expect(required(spans()[0]).status.code).toBe(SpanStatusCode.ERROR)
  expect(required(spans()[0]).attributes['error.type']).toBe('context.lost')
  await f.transports.server.write({ jsonrpc: '2.0', id: frame.id, result })
  await pending
  expect(spans()).toHaveLength(1)
  expect(required(spans()[0]).events).toEqual([])
})
test('incoming exchanges parent to the context and link remote traceparent', () => {
  const bound = binding()
  const remote = tracer.startSpan('remote')
  const sc = remote.spanContext()
  const exchanges = createExchangeTracer(() => bound)
  const exchange = exchanges.startIncoming('roots/list', {}, 'request-1', {
    traceparent: `00-${sc.traceId}-${sc.spanId}-01`,
  })
  exchange.succeed({ roots: [] })
  exchange.fail('late')
  const span = required(exporter.getFinishedSpans()[0])
  expect(span.parentSpanContext?.spanId).toBe(bound.contextSpan?.spanContext().spanId)
  expect(required(span.links[0]).context.spanId).toBe(sc.spanId)
  expect(span.attributes).toMatchObject({
    'jsonrpc.request.id': 'request-1',
    'mokei.direction': 'server',
  })
})
test('stopped settles open exchanges and timeout is cancelled', async () => {
  const f = await fixture(binding())
  const pending = f.client.request('tools/call', { name: 'echo' }, { timeout: 5 })
  const rejected = expect(pending).rejects.toThrow()
  await f.next()
  await rejected
  expect(required(spans()[0]).attributes['error.type']).toBe('cancelled')
  const exchanges = createExchangeTracer(() => binding())
  exchanges.startOutgoing('roots/list', {})
  exchanges.settleAll('stopped')
  expect(exporter.getFinishedSpans().at(-1)?.attributes['error.type']).toBe('context.stopped')
})
test('without an SDK exchanges never serialise payloads', () => {
  trace.disable()
  const payload = {
    toJSON() {
      throw new Error('Payload must not be serialised')
    },
  }
  const exchanges = createExchangeTracer(() => undefined)
  const exchange = exchanges.startOutgoing('tools/call', payload)
  exchange.succeed(payload)
  expect(exchange.span.isRecording()).toBe(false)
})

test('request payload is available to processors at span start', () => {
  let attributes: Attributes | undefined
  const probe = vi.spyOn(SimpleSpanProcessor.prototype, 'onStart').mockImplementation((span) => {
    attributes = { ...span.attributes }
  })
  try {
    const exchange = createExchangeTracer(() => undefined).startOutgoing('tools/call', {
      name: 'echo',
    })
    exchange.succeed(result)
    expect(attributes?.['mokei.mcp.request']).toBe('{"name":"echo"}')
    expect(attributes?.['gen_ai.tool.name']).toBe('echo')
  } finally {
    probe.mockRestore()
  }
})

test('abort settles an outgoing exchange as cancelled', async () => {
  const f = await fixture()
  const controller = new AbortController()
  const pending = f.client.request('tools/call', { name: 'echo' }, { signal: controller.signal })
  const rejected = expect(pending).rejects.toThrow()
  await f.next()
  controller.abort()
  await rejected
  expect(required(spans()[0]).attributes['error.type']).toBe('cancelled')
  expect(required(spans()[0]).status.code).toBe(SpanStatusCode.ERROR)
})

for (const protocolVersion of ['2025-11-25', '2026-07-28'] as const) {
  const method = protocolVersion === '2025-11-25' ? 'initialize' : 'server/discover'
  test(`${method} produces an exchange span and the frame carries traceparent`, async () => {
    const bound = binding()
    const f = await fixture(bound, protocolVersion)
    const span = required(f.setupSpans.find((span) => span.name === `mcp.${method}`))
    expect(span.attributes).toMatchObject({
      'jsonrpc.request.id': String(f.setupFrame.id),
      'mokei.direction': 'client',
    })
    expect(span.parentSpanContext?.spanId).toBe(bound.contextSpan?.spanContext().spanId)
    expect(
      (
        (f.setupFrame.params as Record<string, unknown> | undefined)?._meta as
          | Record<string, unknown>
          | undefined
      )?.traceparent,
    ).toContain(span.spanContext().spanId)
    expect(span.status.code).toBe(SpanStatusCode.OK)
  })

  for (const payloads of ['on', 'off', 8] as const) {
    test(`${method} captures setup parameters at span start with payloads ${payloads}`, async () => {
      let attributes: Attributes | undefined
      const probe = vi
        .spyOn(SimpleSpanProcessor.prototype, 'onStart')
        .mockImplementation((span) => {
          if (span.name === `mcp.${method}`) attributes = { ...span.attributes }
        })
      try {
        const clientInfo = { name: 'setup-test', version: '1' }
        const f = await fixture({ ...binding(), payloads }, protocolVersion, { clientInfo })
        const span = required(f.setupSpans.find((span) => span.name === `mcp.${method}`))
        const captured = required(attributes)
        if (payloads === 'off') {
          expect(captured).not.toHaveProperty('mokei.mcp.request')
          expect(captured).not.toHaveProperty('mokei.payload.truncated')
          expect(span.attributes).not.toHaveProperty('mokei.mcp.request')
          expect(required(span.events[0]).attributes).not.toHaveProperty('payload')
        } else if (payloads === 'on') {
          expect(JSON.parse(captured['mokei.mcp.request'] as string)).toEqual(
            protocolVersion === '2025-11-25'
              ? { capabilities: { roots: {} }, clientInfo, protocolVersion }
              : { _meta: {} },
          )
          expect(captured).not.toHaveProperty('mokei.payload.truncated')
          expect(span.attributes['mokei.mcp.request']).toBe(captured['mokei.mcp.request'])
        } else {
          const payload = captured['mokei.mcp.request'] as string
          expect(payload).toBe(protocolVersion === '2025-11-25' ? '{"capabi' : '{"_meta"')
          expect(new TextEncoder().encode(payload).length).toBe(payloads)
          expect(captured['mokei.payload.truncated']).toBe(true)
          expect(span.attributes['mokei.payload.truncated']).toBe(true)
        }
      } finally {
        probe.mockRestore()
      }
    })
  }
}

test('subscriptions/listen produces one span settled when the stream settles', async () => {
  const f = await fixture(binding(), '2026-07-28')
  const subscribed = f.client.subscribeResource({ uri: 'file:///test' })
  const frame = await f.next()
  expect('method' in frame && frame.method).toBe('subscriptions/listen')
  expect(exporter.getFinishedSpans()).toEqual([])
  await f.transports.server.write({
    jsonrpc: '2.0',
    method: 'notifications/subscriptions/acknowledged',
    params: {
      notifications: { resourceSubscriptions: ['file:///test'] },
      _meta: { [META_SUBSCRIPTION_ID]: frame.id },
    },
  } as ServerMessage)
  await subscribed
  expect(exporter.getFinishedSpans()).toEqual([])
  await f.transports.server.write({
    jsonrpc: '2.0',
    id: frame.id,
    result: { resultType: 'complete', _meta: { [META_SUBSCRIPTION_ID]: frame.id } },
  })
  await vi.waitFor(() => expect(exporter.getFinishedSpans()).toHaveLength(1))
  const span = required(exporter.getFinishedSpans()[0])
  expect(span.name).toBe('mcp.subscriptions/listen')
  expect(span.attributes['jsonrpc.request.id']).toBe(String(frame.id))
  expect((frame.params?._meta as Record<string, unknown>)?.traceparent).toContain(
    span.spanContext().spanId,
  )
  expect(span.status.code).toBe(SpanStatusCode.OK)
})

test('incoming elicitation/create parents to the context and links the remote traceparent', async () => {
  const bound = binding()
  const remote = tracer.startSpan('remote').spanContext()
  let activeID: string | undefined
  const f = await fixture(bound, '2025-11-25', {
    elicit: async () => {
      activeID = trace.getActiveSpan()?.spanContext().spanId
      return { action: 'decline' }
    },
  })
  await f.transports.server.write({
    jsonrpc: '2.0',
    id: 'incoming',
    method: 'elicitation/create',
    params: {
      message: 'Test',
      requestedSchema: { type: 'object', properties: {} },
      _meta: { traceparent: `00-${remote.traceId}-${remote.spanId}-01` },
    },
  })
  await f.transports.server.read()
  const span = required(exporter.getFinishedSpans()[0])
  expect(span.name).toBe('mcp.elicitation/create')
  expect(span.attributes['mokei.direction']).toBe('server')
  expect(span.parentSpanContext?.spanId).toBe(bound.contextSpan?.spanContext().spanId)
  expect(required(span.links[0]).context.spanId).toBe(remote.spanId)
  expect(activeID).toBe(span.spanContext().spanId)
  expect(span.status.code).toBe(SpanStatusCode.OK)
})

test('incoming request cancelled by notifications/cancelled ends with error.type cancelled', async () => {
  let entered = false
  let complete: (() => void) | undefined
  const f = await fixture(binding(), '2025-11-25', {
    elicit: async () => {
      entered = true
      await new Promise<void>((resolve) => {
        complete = resolve
      })
      return { action: 'decline' }
    },
  })
  await f.transports.server.write({
    jsonrpc: '2.0',
    id: 'incoming',
    method: 'elicitation/create',
    params: { message: 'Test', requestedSchema: { type: 'object', properties: {} } },
  })
  await vi.waitFor(() => expect(entered).toBe(true))
  await f.transports.server.write({
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId: 'incoming' },
  })
  try {
    await vi.waitFor(() => expect(exporter.getFinishedSpans()).toHaveLength(1))
    expect(required(exporter.getFinishedSpans()[0]).attributes['error.type']).toBe('cancelled')
  } finally {
    complete?.()
  }
  await f.call()
  expect(
    exporter.getFinishedSpans().filter((span) => span.name === 'mcp.elicitation/create'),
  ).toHaveLength(1)
})

test('notifications in either direction log on the bound context with redacted capped payloads', async () => {
  const bound = binding()
  const f = await fixture(bound)
  const logger = getMokeiLogger('mcp').getChild('notification')
  const records: Array<{ properties: Record<string, unknown>; spanID?: string }> = []
  const spy = vi.spyOn(logger, 'debug').mockImplementation((...args: Array<unknown>) => {
    const properties = args[1]
    records.push({
      properties:
        properties !== null && typeof properties === 'object'
          ? (properties as Record<string, unknown>)
          : {},
      spanID: trace.getActiveSpan()?.spanContext().spanId,
    })
  })
  try {
    expect(logger.category).toEqual(['mokei', 'mcp', 'notification'])
    await f.client.notify('roots/list_changed', { password: 'secret', value: 'hello' })
    await f.transports.server.read()
    await f.transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
      params: { token: 'secret', value: 'hello' },
    })
    await vi.waitFor(() => expect(records).toHaveLength(2))
    expect(records.map((entry) => entry.spanID)).toEqual([
      bound.contextSpan?.spanContext().spanId,
      bound.contextSpan?.spanContext().spanId,
    ])
    expect(records.map((entry) => entry.properties)).toMatchObject([
      {
        method: 'notifications/roots/list_changed',
        direction: 'client',
        payload: expect.stringContaining('[redacted]'),
      },
      {
        method: 'notifications/tools/list_changed',
        direction: 'server',
        payload: expect.stringContaining('[redacted]'),
      },
    ])
    f.client.setTracing({ ...bound, payloads: 8 })
    await f.client.notify('roots/list_changed', { value: 'long payload' })
    await f.transports.server.read()
    expect(records.at(-1)?.properties).toMatchObject({
      payload: '{"value"',
      'mokei.payload.truncated': true,
    })
    f.client.setTracing({ ...bound, payloads: 'off' })
    await f.client.notify('roots/list_changed', {})
    await f.transports.server.read()
    expect(records.at(-1)?.properties).not.toHaveProperty('payload')
    const unbound = await fixture()
    await unbound.client.notify('roots/list_changed', {})
    await unbound.transports.server.read()
    await unbound.transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    })
    await unbound.call()
    expect(records).toHaveLength(4)
  } finally {
    spy.mockRestore()
  }
})

test('cancelled and subscription notifications also log on the bound context', async () => {
  const f = await fixture(binding(), '2026-07-28')
  const logger = getMokeiLogger('mcp').getChild('notification')
  const spy = vi.spyOn(logger, 'debug')
  try {
    await f.transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: {
        requestId: 'unknown',
        _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
      },
    } as ServerMessage)
    await f.transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
      params: {
        _meta: {
          [META_SUBSCRIPTION_ID]: 'unknown',
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        },
      },
    } as ServerMessage)
    await f.call()
    expect(spy).toHaveBeenCalledTimes(2)
  } finally {
    spy.mockRestore()
  }
})

for (const termination of ['timeout', 'closed', 'rpc-error', 'write-error'] as const) {
  test(`setup ${termination} settles its span with the appropriate error type`, async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    disposals.push(() => transports.dispose())
    if (termination === 'write-error') {
      vi.spyOn(transports.client, 'write').mockRejectedValue(new Error('Write failed'))
    }
    const client = new ContextClient({
      transport: transports.client,
      protocolVersion: '2025-11-25',
      tracing: binding(),
      setupTimeout: 10,
    })
    const pending = expect(client.initialize()).rejects.toThrow()
    if (termination !== 'write-error') {
      const frame = required((await transports.server.read()).value)
      if (typeof frame.id !== 'number' && typeof frame.id !== 'string')
        throw new Error('Expected ID')
      if (termination === 'closed') await transports.server.dispose()
      if (termination === 'rpc-error')
        await transports.server.write({
          jsonrpc: '2.0',
          id: frame.id,
          error: { code: -32603, message: 'Failed' },
        })
    }
    await pending
    const span = required(
      exporter.getFinishedSpans().find((span) => span.name === 'mcp.initialize'),
    )
    expect(span.attributes['error.type']).toBe(
      termination === 'timeout'
        ? 'cancelled'
        : termination === 'closed'
          ? 'context.lost'
          : termination === 'rpc-error'
            ? '-32603'
            : '_OTHER',
    )
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
  })
}

test('incoming transport closure settles as context.lost even when the handler ignores abort', async () => {
  let entered = false
  let complete: (() => void) | undefined
  const f = await fixture(binding(), '2025-11-25', {
    elicit: async () => {
      entered = true
      await new Promise<void>((resolve) => {
        complete = resolve
      })
      return { action: 'decline' }
    },
  })
  await f.transports.server.write({
    jsonrpc: '2.0',
    id: 'incoming',
    method: 'elicitation/create',
    params: { message: 'Test', requestedSchema: { type: 'object', properties: {} } },
  })
  await vi.waitFor(() => expect(entered).toBe(true))
  try {
    await f.transports.server.dispose()
    await vi.waitFor(() => expect(exporter.getFinishedSpans()).toHaveLength(1))
    expect(required(exporter.getFinishedSpans()[0]).attributes['error.type']).toBe('context.lost')
  } finally {
    complete?.()
  }
})
