import { getMokeiLogger } from '@mokei/logger'
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { expect, test, vi } from 'vitest'

import { createProxyTracing } from '../src/proxy-tracing.js'
import { useTestMetrics } from './support/metrics.js'
import { useTestTracing } from './support/otel.js'

const { exporter } = useTestTracing()
const { collect } = useTestMetrics()
const result = { content: [{ type: 'text', text: 'ok' }] }
function fixture() {
  return createProxyTracing({
    contextID: 'ctx',
    command: 'node',
    args: ['server.js'],
    payloads: 'on',
  })
}
function requests() {
  return exporter.getFinishedSpans().filter((span) => span.name !== 'mcp.context')
}

test('pairs a client request with the server response', () => {
  const proxy = fixture()
  proxy.observe('client', { id: 1, method: 'tools/call', params: { name: 'echo', token: 't' } })
  expect(requests()).toHaveLength(0)
  proxy.observe('server', { id: 1, result })
  proxy.end('stopped')
  const span = requests()[0]
  const root = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
  expect(requests()).toHaveLength(1)
  expect(span?.name).toBe('tools/call echo')
  expect(span?.kind).toBe(SpanKind.CLIENT)
  expect(span?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId)
  expect(root?.parentSpanContext).toBeUndefined()
  expect(root?.attributes).toMatchObject({
    'mokei.kind': 'context',
    'mokei.root': true,
    'mokei.context.id': 'ctx',
    'network.transport': 'pipe',
    'process.command': 'node',
    'process.command_args': ['server.js'],
  })
  expect(span?.attributes).toMatchObject({
    'mokei.direction': 'client',
    'mokei.context.id': 'ctx',
    'mokei.kind': 'mcp',
    'gen_ai.tool.name': 'echo',
    'jsonrpc.request.id': '1',
    'mokei.mcp.request': '{"name":"echo","token":"[redacted]"}',
  })
  expect(span?.events).toMatchObject([
    { name: 'mcp.response', attributes: { 'mokei.mcp.response': JSON.stringify(result) } },
  ])
  expect(span?.status.code).toBe(SpanStatusCode.UNSET)
  expect(span?.attributes['gen_ai.tool.call.result']).toBe(JSON.stringify(result))
  expect(span?.attributes['network.transport']).toBe('pipe')
  expect(root?.attributes['mcp.transport']).toBeUndefined()
})

test('keys by direction and id type', () => {
  const proxy = fixture()
  proxy.observe('client', { id: 1, method: 'tools/call' })
  proxy.observe('client', { id: '1', method: 'tools/list' })
  proxy.observe('server', { id: 1, method: 'roots/list' })
  proxy.observe('client', { id: 1, result: {} })
  expect(requests().map((span) => span.name)).toEqual(['roots/list'])
  expect(requests()[0]?.kind).toBe(SpanKind.SERVER)
  proxy.observe('server', { id: '1', result: {} })
  expect(requests().map((span) => span.name)).toEqual(['roots/list', 'tools/list'])
  proxy.observe('server', { id: 1, result })
  expect(requests().map((span) => span.name)).toEqual(['roots/list', 'tools/list', 'tools/call'])
  proxy.end('stopped')
})

test('notifications/cancelled ends the span with error.type cancelled and a late response is ignored', () => {
  const proxy = fixture()
  proxy.observe('client', { id: 1, method: 'tools/call' })
  proxy.observe('server', { id: 1, method: 'roots/list' })
  proxy.observe('client', { method: 'notifications/cancelled', params: { requestId: 1 } })
  expect(requests()).toHaveLength(1)
  expect(requests()[0]?.name).toBe('tools/call')
  expect(requests()[0]?.attributes['error.type']).toBe('cancelled')
  expect(requests()[0]?.status.code).toBe(SpanStatusCode.ERROR)
  proxy.observe('server', { id: 1, result })
  expect(requests()).toHaveLength(1)
  expect(requests()[0]?.events).toEqual([])
  proxy.observe('client', { id: 1, result: {} })
  expect(requests()).toHaveLength(2)
  proxy.end('stopped')
})

test('request _meta.traceparent becomes a link, not a parent', () => {
  const proxy = fixture()
  proxy.observe('server', {
    id: 1,
    method: 'roots/list',
    params: {
      _meta: {
        traceparent: '00-12345678901234567890123456789012-1234567890123456-01',
      },
    },
  })
  proxy.observe('client', { id: 1, result: {} })
  proxy.end('stopped')
  expect(requests()[0]?.links[0]?.context.spanId).toBe('1234567890123456')
  expect(requests()[0]?.parentSpanContext?.spanId).not.toBe('1234567890123456')
})

test("parentFrom 'meta' parents request spans to _meta.traceparent and links the context", () => {
  const proxy = createProxyTracing({
    contextID: 'ctx',
    command: 'node',
    args: [],
    parentFrom: 'meta',
  })
  proxy.observe('server', {
    id: 1,
    method: 'roots/list',
    params: { _meta: { traceparent: '00-12345678901234567890123456789012-1234567890123456-01' } },
  })
  proxy.observe('client', { id: 1, result: {} })
  proxy.observe('client', { id: 2, method: 'tools/call', params: { name: 'echo' } })
  proxy.observe('server', { id: 2, result })
  proxy.end('stopped')
  const root = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
  const [withMeta, without] = requests()
  expect(withMeta?.parentSpanContext?.spanId).toBe('1234567890123456')
  expect(withMeta?.links.map((link) => link.context.spanId)).toEqual([root?.spanContext().spanId])
  expect(without?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId)
  expect(without?.links).toEqual([])
})

test('notifications become traced log records on the context span', () => {
  const proxy = fixture()
  const logger = getMokeiLogger('mcp').getChild('notification')
  const records: Array<{ spanID?: string; properties: unknown }> = []
  const spy = vi.spyOn(logger, 'debug').mockImplementation((...args: Array<unknown>) => {
    records.push({ spanID: trace.getActiveSpan()?.spanContext().spanId, properties: args[1] })
  })
  try {
    proxy.observe('client', { method: 'notifications/initialized' })
    proxy.observe('server', { method: 'notifications/message', params: { token: 't' } })
    proxy.end('stopped')
    const root = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
    expect(logger.category).toEqual(['mokei', 'mcp', 'notification'])
    expect(records).toEqual([
      {
        spanID: root?.spanContext().spanId,
        properties: { method: 'notifications/initialized', direction: 'client' },
      },
      {
        spanID: root?.spanContext().spanId,
        properties: {
          method: 'notifications/message',
          direction: 'server',
          payload: '{"token":"[redacted]"}',
        },
      },
    ])
    expect(requests()).toEqual([])
  } finally {
    spy.mockRestore()
  }
})

for (const reason of ['stopped', 'lost'] as const) {
  test(`end('${reason}') settles open spans and the context exactly once`, () => {
    const proxy = fixture()
    proxy.observe('client', { id: 1, method: 'tools/call' })
    proxy.end(reason)
    proxy.end('lost')
    proxy.observe('server', { id: 1, result })
    proxy.observe('client', { id: 2, method: 'tools/list' })
    expect(requests()).toHaveLength(1)
    expect(requests()[0]?.attributes['error.type']).toBe(`context.${reason}`)
    expect(requests()[0]?.status.code).toBe(SpanStatusCode.ERROR)
    const root = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
    expect(root?.status.code).toBe(reason === 'lost' ? SpanStatusCode.ERROR : SpanStatusCode.UNSET)
    expect(root?.attributes['error.type']).toBe(reason === 'lost' ? 'context.lost' : undefined)
  })
}

test('context command arguments redact secret flag values without changing forwarded arguments', () => {
  const args = [
    'server.js',
    '--api-key',
    'secret',
    '--token=secret',
    '--port',
    '80',
    '-password',
    'secret',
    '--cookie=secret',
    '--label',
    'visible',
  ]
  const proxy = createProxyTracing({ contextID: 'ctx', command: 'node', args })
  proxy.end('stopped')
  expect(exporter.getFinishedSpans()[0]?.attributes['process.command_args']).toEqual([
    'server.js',
    '--api-key',
    '[redacted]',
    '--token=[redacted]',
    '--port',
    '80',
    '-password',
    '[redacted]',
    '--cookie=[redacted]',
    '--label',
    'visible',
  ])
  expect(args).toContain('--token=secret')
})

test('unrecorded proxy notifications never serialise payloads', () => {
  trace.disable()
  const proxy = createProxyTracing({ contextID: 'ctx', command: 'node', args: [], payloads: 'on' })
  const toJSON = vi.fn(() => {
    throw new Error('must not serialise')
  })
  expect(() =>
    proxy.observe('server', { method: 'notifications/message', params: { toJSON } }),
  ).not.toThrow()
  expect(toJSON).not.toHaveBeenCalled()
  proxy.end('stopped')
})

test.each([
  { response: { error: { code: -32603, message: 'Internal error' } }, errorType: '-32603' },
  { response: { result: { content: [], isError: true } }, errorType: 'tool_error' },
])('maps request failure to $errorType', ({ response, errorType }) => {
  const proxy = fixture()
  proxy.observe('client', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo' } })
  proxy.observe('server', { jsonrpc: '2.0', id: 1, ...response })
  expect(requests()).toHaveLength(1)
  expect(requests()[0]?.status.code).toBe(SpanStatusCode.ERROR)
  expect(requests()[0]?.attributes['error.type']).toBe(errorType)
  proxy.end('stopped')
})

test('initialize response sets the negotiated protocol version on the context and later spans', () => {
  const proxy = fixture()
  proxy.observe('client', { id: 1, method: 'initialize', params: {} })
  proxy.observe('server', { id: 1, result: { protocolVersion: '2025-11-25' } })
  proxy.observe('client', { id: 2, method: 'tools/list' })
  proxy.observe('server', { id: 2, result: {} })
  proxy.end('stopped')
  const root = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
  expect(root?.attributes['mcp.protocol.version']).toBe('2025-11-25')
  expect(requests()[0]?.attributes['mcp.protocol.version']).toBeUndefined()
  expect(requests()[1]?.attributes['mcp.protocol.version']).toBe('2025-11-25')
})

test('an error response sets the status message and rpc.response.status_code', () => {
  const proxy = fixture()
  proxy.observe('client', { id: 1, method: 'tools/call', params: { name: 'echo' } })
  proxy.observe('server', { id: 1, error: { code: -32603, message: 'boom' } })
  proxy.end('stopped')
  const span = requests()[0]
  expect(span?.status).toMatchObject({ code: SpanStatusCode.ERROR, message: 'boom' })
  expect(span?.attributes['error.type']).toBe('-32603')
  expect(span?.attributes['rpc.response.status_code']).toBe('-32603')
  expect(span?.attributes['gen_ai.tool.call.result']).toBeUndefined()
})

test('a server-initiated request answered with -32601 is not an error', () => {
  const proxy = fixture()
  proxy.observe('server', { id: 1, method: 'roots/list' })
  proxy.observe('client', { id: 1, error: { code: -32601, message: 'nope' } })
  proxy.end('stopped')
  const span = requests()[0]
  expect(span?.status.code).toBe(SpanStatusCode.UNSET)
  expect(span?.attributes['rpc.response.status_code']).toBe('-32601')
  expect(span?.attributes['error.type']).toBeUndefined()
})

test('payload capture follows the content gate', () => {
  const proxy = createProxyTracing({ contextID: 'ctx', command: 'node', args: [] })
  proxy.observe('client', { id: 1, method: 'tools/call', params: { name: 'echo', arguments: {} } })
  proxy.observe('server', { id: 1, result })
  proxy.end('stopped')
  const span = requests()[0]
  expect(span?.attributes['mokei.mcp.request']).toBeUndefined()
  expect(span?.attributes['gen_ai.tool.call.result']).toBeUndefined()
  expect(span?.events[0]?.attributes).toEqual({})
})

test('client request records client operation duration, server request records server', async () => {
  const proxy = fixture()
  proxy.observe('client', { id: 1, method: 'tools/call', params: { name: 'echo' } })
  proxy.observe('server', { id: 1, error: { code: -32000, message: 'boom' } })
  proxy.observe('server', { id: 'r', method: 'roots/list', params: {} })
  proxy.observe('client', { id: 'r', result: { roots: [] } })
  proxy.end('stopped')
  const collected = await collect()
  const client = collected.get('mcp.client.operation.duration') ?? []
  expect(client).toHaveLength(1)
  expect(client[0]?.attributes).toMatchObject({
    'mcp.method.name': 'tools/call',
    'gen_ai.tool.name': 'echo',
    'error.type': '-32000',
    'rpc.response.status_code': '-32000',
    'network.transport': 'pipe',
  })
  const server = collected.get('mcp.server.operation.duration') ?? []
  expect(server).toHaveLength(1)
  expect(server[0]?.attributes).toMatchObject({ 'mcp.method.name': 'roots/list' })
  expect(Object.keys(server[0]?.attributes ?? {}).some((k) => k.startsWith('mokei.'))).toBe(false)
})

for (const reason of ['stopped', 'lost'] as const) {
  test(`end(${reason}) records session duration`, async () => {
    const proxy = fixture()
    proxy.observe('client', { id: 1, method: 'initialize', params: {} })
    proxy.observe('server', { id: 1, result: { protocolVersion: '2025-11-25' } })
    proxy.end(reason)
    const points = (await collect()).get('mcp.client.session.duration') ?? []
    expect(points).toHaveLength(1)
    expect(points[0]?.attributes).toMatchObject({
      'network.transport': 'pipe',
      'mcp.protocol.version': '2025-11-25',
    })
    expect(points[0]?.attributes['error.type']).toBe(reason === 'lost' ? 'context.lost' : undefined)
  })
}
