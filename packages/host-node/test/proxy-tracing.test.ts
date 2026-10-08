import { getMokeiLogger } from '@mokei/logger'
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { expect, test, vi } from 'vitest'

import { createProxyTracing } from '../src/proxy-tracing.js'
import { useTestTracing } from './support/otel.js'

const { exporter } = useTestTracing()
const result = { content: [{ type: 'text', text: 'ok' }] }
function fixture() {
  return createProxyTracing({ contextID: 'ctx', command: 'node', args: ['server.js'] })
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
  expect(span?.name).toBe('mcp.tools/call')
  expect(span?.kind).toBe(SpanKind.CLIENT)
  expect(span?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId)
  expect(root?.parentSpanContext).toBeUndefined()
  expect(root?.attributes).toMatchObject({
    'mokei.kind': 'context',
    'mokei.root': true,
    'mokei.context.id': 'ctx',
    'mcp.transport': 'stdio',
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
    { name: 'mcp.response', attributes: { payload: JSON.stringify(result) } },
  ])
  expect(span?.status.code).toBe(SpanStatusCode.OK)
})

test('keys by direction and id type', () => {
  const proxy = fixture()
  proxy.observe('client', { id: 1, method: 'tools/call' })
  proxy.observe('client', { id: '1', method: 'tools/list' })
  proxy.observe('server', { id: 1, method: 'roots/list' })
  proxy.observe('client', { id: 1, result: {} })
  expect(requests().map((span) => span.name)).toEqual(['mcp.roots/list'])
  expect(requests()[0]?.kind).toBe(SpanKind.SERVER)
  proxy.observe('server', { id: '1', result: {} })
  expect(requests().map((span) => span.name)).toEqual(['mcp.roots/list', 'mcp.tools/list'])
  proxy.observe('server', { id: 1, result })
  expect(requests().map((span) => span.name)).toEqual([
    'mcp.roots/list',
    'mcp.tools/list',
    'mcp.tools/call',
  ])
  proxy.end('stopped')
})

test('notifications/cancelled ends the span with error.type cancelled and a late response is ignored', () => {
  const proxy = fixture()
  proxy.observe('client', { id: 1, method: 'tools/call' })
  proxy.observe('server', { id: 1, method: 'roots/list' })
  proxy.observe('client', { method: 'notifications/cancelled', params: { requestId: 1 } })
  expect(requests()).toHaveLength(1)
  expect(requests()[0]?.name).toBe('mcp.tools/call')
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
    expect(root?.status.code).toBe(reason === 'lost' ? SpanStatusCode.ERROR : SpanStatusCode.OK)
    expect(root?.attributes['error.type']).toBe(reason === 'lost' ? 'context.lost' : undefined)
  })
}
