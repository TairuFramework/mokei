import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { expect, test } from 'vitest'

import { ContextClient } from '../src/client.js'
import { createExchangeTracer } from '../src/client-tracing.js'
import { metricAttributes, recordMCPOperation, recordMCPSession } from '../src/mcp-metrics.js'
import { getMokeiMeter, MCP_DURATION_BUCKETS, SEMCONV_SCHEMA_URL } from '../src/semconv.js'
import { useTestMetrics } from './support/metrics.js'

const { collect } = useTestMetrics()

async function roundTrip(response: (id: string | number) => ServerMessage) {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({
    transport: transports.client,
    protocolVersion: '2025-11-25',
    tracing: {
      contextID: 'ctx',
      getSessionID: () => 'session-1',
      getProtocolVersion: () => '2025-11-25',
    },
  })
  const setup = client.request('tools/list', {})
  const init = (await transports.server.read()).value
  if (!init || (typeof init.id !== 'number' && typeof init.id !== 'string'))
    throw new Error('Expected initialize')
  await transports.server.write({
    jsonrpc: '2.0',
    id: init.id,
    result: {
      capabilities: {},
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'test', version: '1' },
    },
  })
  await transports.server.read()
  const list = (await transports.server.read()).value
  if (!list || (typeof list.id !== 'number' && typeof list.id !== 'string'))
    throw new Error('Expected list')
  await transports.server.write({ jsonrpc: '2.0', id: list.id, result: { tools: [] } })
  await setup
  await collect()
  const pending = client.request('tools/call', { name: 'echo', arguments: { secret: 'x' } })
  const settled = pending.catch(() => {})
  const frame = (await transports.server.read()).value
  if (!frame || (typeof frame.id !== 'number' && typeof frame.id !== 'string'))
    throw new Error('Expected call')
  await transports.server.write(response(frame.id))
  await settled
  await transports.dispose()
}

test('tools/call records one client operation duration point', async () => {
  await roundTrip((id) => ({ jsonrpc: '2.0', id, result: { content: [] } }))
  const points = (await collect()).get('mcp.client.operation.duration') ?? []
  const point = points.find((p) => p.attributes['mcp.method.name'] === 'tools/call')
  expect(point?.attributes).toEqual({
    'mcp.method.name': 'tools/call',
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.name': 'echo',
    'mcp.protocol.version': '2025-11-25',
  })
  expect(point?.value).toMatchObject({ count: 1 })
  for (const key of Object.keys(point?.attributes ?? {})) {
    expect(key).not.toMatch(/^(jsonrpc\.|mcp\.session\.id|mokei\.)/)
  }
})

test('failed call adds error.type and status code', async () => {
  await roundTrip((id) => ({ jsonrpc: '2.0', id, error: { code: -32000, message: 'boom' } }))
  const points = (await collect()).get('mcp.client.operation.duration') ?? []
  expect(points).toHaveLength(1)
  expect(points[0]?.attributes).toMatchObject({
    'error.type': '-32000',
    'rpc.response.status_code': '-32000',
  })
})

test('incoming exchange records server operation duration', async () => {
  const exchanges = createExchangeTracer(() => ({ contextID: 'ctx' }))
  exchanges.startIncoming('roots/list', {}, 'r1').succeed({ roots: [] })
  const points = (await collect()).get('mcp.server.operation.duration') ?? []
  expect(points).toHaveLength(1)
  expect(points[0]?.attributes).toEqual({ 'mcp.method.name': 'roots/list' })
})

test('settleAll records error.type context.lost', async () => {
  const exchanges = createExchangeTracer(() => ({ contextID: 'ctx' }))
  exchanges.startOutgoing('tools/list', {})
  exchanges.settleAll('lost')
  const points = (await collect()).get('mcp.client.operation.duration') ?? []
  expect(points[0]?.attributes).toMatchObject({ 'error.type': 'context.lost' })
})

test('metricAttributes keeps only the allowed keys', () => {
  expect(
    metricAttributes({
      'mcp.method.name': 'tools/call',
      'gen_ai.tool.name': 'echo',
      'jsonrpc.request.id': '1',
      'mcp.session.id': 's',
      'mokei.context.id': 'c',
      'mcp.resource.uri': 'file:///x',
      'network.transport': 'tcp',
      'server.port': 80,
    }),
  ).toEqual({
    'mcp.method.name': 'tools/call',
    'gen_ai.tool.name': 'echo',
    'network.transport': 'tcp',
    'server.port': 80,
  })
})

test('session duration and explicit bucket advice', async () => {
  recordMCPSession({ durationS: 1.5, attributes: { 'error.type': 'context.lost' } })
  recordMCPOperation({ side: 'client', durationS: 0.3, attributes: {} })
  const collected = await collect()
  expect(collected.get('mcp.client.session.duration')?.[0]).toMatchObject({
    attributes: { 'error.type': 'context.lost' },
    value: { count: 1, sum: 1.5 },
  })
  const operation = collected.get('mcp.client.operation.duration')?.[0]
  const value = operation?.value as { buckets: { boundaries: Array<number> } } | undefined
  expect(value?.buckets.boundaries).toEqual([...MCP_DURATION_BUCKETS])
})

test('getMokeiMeter instruments carry the semconv schema URL', async () => {
  getMokeiMeter('schema-check').createCounter('mokei.test.schema').add(1)
  const point = (await collect()).get('mokei.test.schema')?.[0]
  expect(point?.schemaUrl).toBe(SEMCONV_SCHEMA_URL)
})
