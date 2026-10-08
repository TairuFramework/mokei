import { DirectTransports } from '@enkaku/transport'
import { ContextClient } from '@mokei/context-client'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { context, ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { Disposer } from '@sozai/async'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { ContextHost } from '../src/host.js'

const exporter = new InMemorySpanExporter()
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
const hosts: Array<ContextHost> = []
beforeAll(() => {
  trace.setGlobalTracerProvider(provider)
})
beforeEach(() => exporter.reset())
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.dispose()
})
afterAll(async () => {
  await provider.shutdown()
  trace.disable()
})

async function fixture(register = false) {
  const host = new ContextHost({ tracing: { payloads: 'off' } })
  hosts.push(host)
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = register
    ? new ContextClient({ transport: transports.client, protocolVersion: '2025-11-25' })
    : host.createContext({
        key: 'test',
        transport: transports.client,
        protocolVersion: '2025-11-25',
      })
  if (register)
    host.registerHostedContext({
      key: 'test',
      context: {
        client,
        disposer: new Disposer({ dispose: () => client.dispose() }),
        tools: [],
      },
    })
  const pending = host.callTool({ key: 'test', name: 'echo', arguments: { secret: 'hidden' } })
  const init = (await transports.server.read()).value
  if (!init || (typeof init.id !== 'string' && typeof init.id !== 'number'))
    throw new Error('Expected initialize')
  await transports.server.write({
    jsonrpc: '2.0',
    id: init.id,
    result: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      serverInfo: { name: 'echo-server', version: '1' },
    },
  })
  await transports.server.read()
  const call = (await transports.server.read()).value
  if (!call || (typeof call.id !== 'string' && typeof call.id !== 'number'))
    throw new Error('Expected call')
  return { host, transports, pending, id: call.id }
}

for (const register of [false, true]) {
  test(
    register
      ? 'registerHostedContext binds a caller-built client'
      : 'createContext opens an mcp.context root span and binds the client',
    async () => {
      const f = await fixture(register)
      await f.transports.server.write({ jsonrpc: '2.0', id: f.id, result: { content: [] } })
      await f.pending
      await f.host.remove('test')
      const root = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
      const call = exporter.getFinishedSpans().find((span) => span.name === 'mcp.tools/call')
      expect(root).toBeDefined()
      expect(root?.parentSpanContext).toBeUndefined()
      expect(root?.attributes).toMatchObject({
        'mokei.kind': 'context',
        'mokei.root': true,
        'mokei.context.id': 'test',
        'mcp.transport': 'direct',
        'server.name': 'echo-server',
      })
      expect(call?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId)
      expect(call?.attributes['mokei.context.id']).toBe('test')
      expect(call?.attributes['mokei.mcp.request']).toBeUndefined()
      expect(call?.spanContext().traceId).toBe(root?.spanContext().traceId)
    },
  )
}

for (const reason of ['stopped', 'lost'] as const) {
  test(`remove settles context and open requests as ${reason}`, async () => {
    const f = await fixture()
    const rejected = f.pending.catch(() => {})
    if (reason === 'stopped') await f.host.remove('test')
    else await f.host.remove('test', reason)
    await rejected
    const root = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
    const call = exporter.getFinishedSpans().find((span) => span.name === 'mcp.tools/call')
    expect(root?.status.code).toBe(reason === 'stopped' ? SpanStatusCode.OK : SpanStatusCode.ERROR)
    expect(root?.attributes['error.type']).toBe(reason === 'lost' ? 'context.lost' : undefined)
    expect(call?.attributes['error.type']).toBe(`context.${reason}`)
    expect(call?.status.code).toBe(SpanStatusCode.ERROR)
  })
}

test('registration records server identity from an already-initialized client', async () => {
  const host = new ContextHost()
  hosts.push(host)
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({
    transport: transports.client,
    protocolVersion: '2025-11-25',
  })
  const initialized = client.initialize()
  const init = (await transports.server.read()).value
  if (!init || (typeof init.id !== 'string' && typeof init.id !== 'number'))
    throw new Error('Expected initialize')
  await transports.server.write({
    jsonrpc: '2.0',
    id: init.id,
    result: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      serverInfo: { name: 'registered-server', version: '1' },
    },
  })
  await transports.server.read()
  await initialized
  host.registerHostedContext({
    key: 'registered',
    context: {
      client,
      disposer: new Disposer({ dispose: () => client.dispose() }),
      tools: [],
    },
  })
  await host.remove('registered')
  const root = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
  expect(root?.attributes['server.name']).toBe('registered-server')
})

test('automatic removal reports a rejecting disposer and settles the context exactly once', async () => {
  const f = await fixture()
  const error = new Error('Disposal failed')
  const dispose = vi.spyOn(f.host.getContext('test').disposer, 'dispose').mockRejectedValue(error)
  const failed = vi.fn()
  const removed = vi.fn()
  f.host.events.on('context:failed', failed)
  f.host.events.on('context:removed', removed)
  const rejected = f.pending.catch(() => {})
  await f.transports.server.dispose()
  await rejected
  await vi.waitFor(() => expect(failed).toHaveBeenCalledWith({ key: 'test', error }))
  await f.host.remove('test')
  expect(failed).toHaveBeenCalledTimes(1)
  expect(dispose).toHaveBeenCalledTimes(1)
  expect(removed).not.toHaveBeenCalled()
  expect(f.host.getContextKeys()).toEqual([])
  const roots = exporter.getFinishedSpans().filter((span) => span.name === 'mcp.context')
  expect(roots).toHaveLength(1)
  expect(roots[0]?.attributes['error.type']).toBe('context.lost')
  expect(roots[0]?.status.code).toBe(SpanStatusCode.ERROR)
})

test('client closed without remove settles as lost, exactly once', async () => {
  const f = await fixture()
  const rejected = f.pending.catch(() => {})
  await f.transports.server.dispose()
  await rejected
  await vi.waitFor(() => expect(f.host.getContextKeys()).toEqual([]))
  await f.host.remove('test')
  const roots = exporter.getFinishedSpans().filter((span) => span.name === 'mcp.context')
  expect(roots).toHaveLength(1)
  expect(roots[0]?.attributes['error.type']).toBe('context.lost')
  expect(roots[0]?.status.code).toBe(SpanStatusCode.ERROR)
})

test('HTTP context records its transport and negotiated session', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    const message = JSON.parse(String(options?.body)) as { id?: number; method?: string }
    if (message.method === 'initialize')
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            serverInfo: { name: 'remote', version: '1' },
          },
        }),
        { headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-123' } },
      )
    if (message.method === 'tools/call')
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [] },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    return new Response(null, { status: 202 })
  })
  const host = new ContextHost()
  hosts.push(host)
  try {
    await host.addHTTPContext({
      key: 'remote',
      url: 'https://example.com/mcp',
      protocolVersion: '2025-11-25',
    })
    await host.callTool({ key: 'remote', name: 'echo', arguments: {} })
    await host.remove('remote')
    const root = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
    expect(root?.attributes).toMatchObject({
      'mcp.transport': 'http',
      'server.name': 'remote',
      'mcp.session.id': 'session-123',
    })
    const call = exporter.getFinishedSpans().find((span) => span.name === 'mcp.tools/call')
    expect(call?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId)
  } finally {
    await host.dispose()
    fetch.mockRestore()
  }
})

test('context lifetime starts a new trace even inside an active span', async () => {
  const parent = trace.getTracer('test').startSpan('parent')
  const active = vi.spyOn(context, 'active').mockReturnValue(trace.setSpan(ROOT_CONTEXT, parent))
  const host = new ContextHost()
  hosts.push(host)
  try {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    host.createContext({ key: 'nested', transport: transports.client })
    expect(exporter.getFinishedSpans().filter((span) => span.name === 'mcp.context')).toHaveLength(
      0,
    )
    await host.remove('nested')
    const root = exporter.getFinishedSpans().find((span) => span.name === 'mcp.context')
    expect(root).toBeDefined()
    expect(root?.parentSpanContext).toBeUndefined()
    expect(root?.spanContext().traceId).not.toBe(parent.spanContext().traceId)
  } finally {
    active.mockRestore()
    parent.end()
    await host.dispose()
  }
})
