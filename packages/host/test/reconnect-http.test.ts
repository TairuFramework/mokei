import { TaskInterruptedError } from '@mokei/context-client'
import type * as HTTPClientModule from '@mokei/http-client'
import {
  AuthRequiredError,
  createMemoryTokenStore,
  createOAuthMiddleware,
  tokenStoreKey,
} from '@mokei/http-client'
import { createRuntime } from '@sozai/runtime'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { ContextHost } from '../src/index.js'
import { nextEvent, record } from './support/reconnect.js'

// Lets a test hide the transport's connection events from the host, so a loss is only seen
// through the failed call itself.
const connectionEvents = { muted: false }
vi.mock('@mokei/http-client', async (importOriginal) => {
  const original = await importOriginal<typeof HTTPClientModule>()
  const { EventEmitter } = await import('@sozai/event')
  class MutableHTTPTransport extends original.HTTPTransport {
    #silent = new EventEmitter<{ connection: HTTPClientModule.ConnectionEvent }>()
    override get connectionEvents() {
      return connectionEvents.muted ? this.#silent : super.connectionEvents
    }
  }
  return { ...original, HTTPTransport: MutableHTTPTransport }
})

const URL_MCP = 'https://mcp.example.test/mcp'
const FAST = { initialDelayMs: 1, maxDelayMs: 1 }

type Incoming = {
  httpMethod: string
  method?: string
  id?: number
  session: string | null
  authorization: string | null
}
/** `undefined` lets the responder answer; `'reject'` fails the fetch (no response). */
type Override = (request: Incoming) => 'reject' | Response | undefined

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const tools = [
  { name: 'read', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'write', inputSchema: { type: 'object' } },
]

/**
 * An in-memory `2025-11-25` Streamable HTTP server behind a runtime fetch stub. Each
 * `initialize` opens a new session (`s1`, `s2`, ...); `tools/call` answers with its session.
 */
function server() {
  const requests: Array<Incoming> = []
  const expired = new Set<string>()
  let sessions = 0
  let override: Override | undefined
  const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as { id?: number; method?: string })
        : undefined
    const request: Incoming = {
      httpMethod: init?.method ?? 'GET',
      method: body?.method,
      id: body?.id,
      session: headers.get('Mcp-Session-Id'),
      authorization: headers.get('Authorization'),
    }
    requests.push(request)
    const replaced = override?.(request)
    if (replaced === 'reject') throw new TypeError('fetch failed')
    if (replaced != null) return replaced
    if (request.httpMethod === 'GET') return new Response(null, { status: 405 })
    if (request.httpMethod === 'DELETE') return new Response(null, { status: 204 })
    if (request.session != null && expired.has(request.session)) {
      return new Response(null, { status: 404 })
    }
    if (body?.id == null) return new Response(null, { status: 202 })
    const reply = (result: unknown, extra: Record<string, string> = {}) =>
      json({ jsonrpc: '2.0', id: body.id, result }, 200, extra)
    switch (body.method) {
      case 'initialize':
        sessions += 1
        return reply(
          {
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'http', version: '1.0.0' },
          },
          { 'Mcp-Session-Id': `s${sessions}` },
        )
      case 'tools/list':
        return reply({ tools })
      case 'tools/call':
        return reply({ content: [{ type: 'text', text: `ok ${request.session}` }] })
      default:
        return json(
          { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'not found' } },
          200,
        )
    }
  }
  return {
    requests,
    expired,
    sessions: () => sessions,
    runtime: createRuntime({ fetch: fetch as typeof globalThis.fetch }),
    /** Applies `next` until it returns a value for a request, then stops. */
    once(next: Override) {
      override = (request) => {
        const replaced = next(request)
        if (replaced != null) override = undefined
        return replaced
      }
    },
    always(next: Override | undefined) {
      override = next
    },
  }
}

const hosts: Array<ContextHost> = []

async function connect(
  env: ReturnType<typeof server>,
  extra: Partial<Parameters<ContextHost['addHTTPContext']>[0]> = {},
) {
  const host = new ContextHost()
  hosts.push(host)
  const events = record(host)
  await host.addHTTPContext({
    key: 'remote',
    url: URL_MCP,
    protocolVersion: '2025-11-25',
    runtime: env.runtime,
    reconnect: FAST,
    ...extra,
  })
  await host.setup({ key: 'remote' })
  return { host, events }
}

const textOf = (result: { content: Array<unknown> }) =>
  (result.content[0] as { type: 'text'; text: string }).text

afterEach(async () => {
  connectionEvents.muted = false
  await Promise.all(hosts.splice(0).map((host) => host.dispose()))
})

describe('HTTP context reconnect', () => {
  test('a network failure reconnects an HTTP context', async () => {
    const env = server()
    const { host, events } = await connect(env)
    const firstClient = host.getContext('remote').client
    env.once((request) => (request.method === 'tools/call' ? 'reject' : undefined))

    const reconnected = nextEvent(host, 'context:reconnected')
    await expect(host.callTool({ key: 'remote', name: 'write', arguments: {} })).rejects.toThrow()
    await reconnected

    const result = await host.callTool({ key: 'remote', name: 'write', arguments: {} })
    expect(textOf(result)).toBe('ok s2')
    expect(host.getContext('remote').client).not.toBe(firstClient)
    expect(env.sessions()).toBe(2)
    expect(events.map((event) => event.name)).toEqual([
      'context:added',
      'context:reconnecting',
      'context:reconnected',
    ])
  })

  test('a read-only call lost to a network failure is retried on the new transport', async () => {
    const env = server()
    const { host } = await connect(env)
    env.once((request) => (request.method === 'tools/call' ? 'reject' : undefined))

    const result = await host.callTool({ key: 'remote', name: 'read', arguments: {} })
    expect(textOf(result)).toBe('ok s2')
  })

  test('session expiry re-initialises', async () => {
    const env = server()
    const { host } = await connect(env)
    env.expired.add('s1')

    const reconnected = nextEvent(host, 'context:reconnected')
    await expect(host.callTool({ key: 'remote', name: 'write', arguments: {} })).rejects.toThrow()
    await reconnected

    const result = await host.callTool({ key: 'remote', name: 'write', arguments: {} })
    expect(textOf(result)).toBe('ok s2')
    const initializes = env.requests.filter((request) => request.method === 'initialize')
    expect(initializes).toHaveLength(2)
    // The new transport starts without the expired session.
    expect(initializes[1]?.session).toBeNull()
    // Let the lost generation's background disposal finish before checking for its DELETE.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(
      env.requests.filter((request) => request.httpMethod === 'DELETE' && request.session === 's1'),
    ).toEqual([])
  })

  test('auth required ends the loop', async () => {
    const env = server()
    const resource = URL_MCP
    const metadata = 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp'
    const store = createMemoryTokenStore()
    await store.set(tokenStoreKey({ resource, clientID: 'c', scopes: ['read'] }), {
      accessToken: 'tok:good',
      tokenType: 'Bearer',
    })
    const authorize = vi.fn(async ({ state }: { state: string }) => {
      return { code: 'good', state, redirectURI: 'http://127.0.0.1:5555/cb' }
    })
    const fetchMiddleware = createOAuthMiddleware({
      clientID: 'c',
      resource,
      scopes: ['read'],
      handler: { authorize },
      store,
    })
    const { host, events } = await connect(env, { fetchMiddleware })
    expect(env.requests.every((request) => request.authorization === 'Bearer tok:good')).toBe(true)

    // The network drops, and when it comes back the server no longer accepts the token.
    let revoked = false
    env.always((request) => {
      if (request.method === 'tools/call') {
        revoked = true
        return 'reject'
      }
      if (!revoked) return undefined
      if (request.httpMethod !== 'POST') return new Response(null, { status: 204 })
      return new Response(null, {
        status: 401,
        headers: { 'WWW-Authenticate': `Bearer resource_metadata="${metadata}"` },
      })
    })

    const failed = nextEvent(host, 'context:failed')
    const removed = nextEvent(host, 'context:removed')
    await expect(host.callTool({ key: 'remote', name: 'write', arguments: {} })).rejects.toThrow()
    const { error } = await failed
    await removed

    expect(error).toBeInstanceOf(AuthRequiredError)
    expect(authorize).not.toHaveBeenCalled()
    expect(host.hasContext({ key: 'remote' })).toBe(false)
    expect(events.filter((event) => event.name === 'context:reconnecting')).toHaveLength(1)
    expect(events.filter((event) => event.name === 'context:failed')).toHaveLength(1)
    expect(events.filter((event) => event.name === 'context:removed')).toHaveLength(1)
  })

  test('a 401 with a JSON-RPC body ends the reconnect at once with AuthRequiredError', async () => {
    const env = server()
    const { host, events } = await connect(env)
    let revoked = false
    env.always((request) => {
      if (request.method === 'tools/call') {
        revoked = true
        return 'reject'
      }
      if (!revoked) return undefined
      if (request.httpMethod !== 'POST') return new Response(null, { status: 204 })
      return json(
        { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'revoked' } },
        401,
      )
    })

    const failed = nextEvent(host, 'context:failed')
    const removed = nextEvent(host, 'context:removed')
    await expect(host.callTool({ key: 'remote', name: 'write', arguments: {} })).rejects.toThrow()
    const { error } = await failed
    await removed

    expect(error).toBeInstanceOf(AuthRequiredError)
    expect(events.filter((event) => event.name === 'context:reconnecting')).toHaveLength(1)
  })

  test('5xx does not reconnect', async () => {
    const env = server()
    const { host, events } = await connect(env)
    const client = host.getContext('remote').client
    env.once((request) =>
      request.method === 'tools/call' ? new Response('boom', { status: 503 }) : undefined,
    )

    await expect(host.callTool({ key: 'remote', name: 'read', arguments: {} })).rejects.toThrow()
    const result = await host.callTool({ key: 'remote', name: 'read', arguments: {} })

    expect(textOf(result)).toBe('ok s1')
    expect(host.getContext('remote').client).toBe(client)
    expect(env.sessions()).toBe(1)
    expect(events.map((event) => event.name)).toEqual(['context:added'])
  })

  test('idle stream loss reconnects', { timeout: 10_000 }, async () => {
    const env = server()
    // The GET stream fails at the network on every re-open; no call is made.
    env.always((request) => (request.httpMethod === 'GET' ? 'reject' : undefined))
    const { host } = await connect(env)

    const reconnecting = await nextEvent(host, 'context:reconnecting')
    expect(reconnecting).toMatchObject({ key: 'remote', attempt: 1 })
    expect(reconnecting.error.name).toBe('NetworkError')
    expect(env.requests.filter((request) => request.method === 'tools/call')).toEqual([])
  })

  test('without reconnect, a network failure leaves the context in place', async () => {
    const env = server()
    const { host, events } = await connect(env, { reconnect: undefined })
    env.once((request) => (request.method === 'tools/call' ? 'reject' : undefined))

    await expect(host.callTool({ key: 'remote', name: 'write', arguments: {} })).rejects.toThrow()
    const result = await host.callTool({ key: 'remote', name: 'write', arguments: {} })

    expect(textOf(result)).toBe('ok s1')
    expect(events.map((event) => event.name)).toEqual(['context:added'])
  })
})

describe('HTTP loss seen only by the failed call', () => {
  test('a network failure on a call reconnects without a connection event', async () => {
    connectionEvents.muted = true
    const env = server()
    const { host } = await connect(env)
    env.once((request) => (request.method === 'tools/call' ? 'reject' : undefined))

    const reconnected = nextEvent(host, 'context:reconnected')
    await expect(host.callTool({ key: 'remote', name: 'write', arguments: {} })).rejects.toThrow()
    await reconnected

    const result = await host.callTool({ key: 'remote', name: 'write', arguments: {} })
    expect(textOf(result)).toBe('ok s2')
  })

  test('a read-only call retries after a network failure without a connection event', async () => {
    connectionEvents.muted = true
    const env = server()
    const { host } = await connect(env)
    env.once((request) => (request.method === 'tools/call' ? 'reject' : undefined))

    const result = await host.callTool({ key: 'remote', name: 'read', arguments: {} })
    expect(textOf(result)).toBe('ok s2')
  })

  test('a read-only call retries after a session expiry without a connection event', async () => {
    connectionEvents.muted = true
    const env = server()
    const { host } = await connect(env)
    env.expired.add('s1')

    const result = await host.callTool({ key: 'remote', name: 'read', arguments: {} })
    expect(textOf(result)).toBe('ok s2')
  })
})

describe('HTTP loss after a task was accepted', () => {
  const created = {
    resultType: 'task',
    taskId: 'task-1',
    status: 'working',
    createdAt: '2026-11-11T12:00:00.000Z',
    lastUpdatedAt: '2026-11-11T12:00:00.000Z',
    ttlMs: 60_000,
  }

  /** A sessionless `2026-07-28` server whose `tools/call` returns a task. */
  function taskServer() {
    const requests: Array<string | undefined> = []
    let dropTasks = true
    const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method !== 'POST' || typeof init.body !== 'string') {
        return new Response(null, { status: 405 })
      }
      const body = JSON.parse(init.body) as { id?: number; method: string }
      requests.push(body.method)
      if (body.method.startsWith('tasks/') && dropTasks) {
        dropTasks = false
        throw new TypeError('fetch failed')
      }
      if (body.id == null) return new Response(null, { status: 202 })
      const reply = (result: unknown) => json({ jsonrpc: '2.0', id: body.id, result })
      switch (body.method) {
        case 'server/discover':
          return reply({
            resultType: 'complete',
            supportedVersions: ['2026-07-28'],
            capabilities: { tools: {} },
            serverInfo: { name: 'tasks', version: '1.0.0' },
            ttlMs: 0,
            cacheScope: 'private',
          })
        case 'tools/list':
          return reply({ resultType: 'complete', tools, ttlMs: 0, cacheScope: 'private' })
        case 'tools/call':
          return reply(created)
        default:
          return json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'none' } })
      }
    }
    return { requests, runtime: createRuntime({ fetch: fetch as typeof globalThis.fetch }) }
  }

  test('a read-only call is not retried once its task was accepted', async () => {
    const env = taskServer()
    const host = new ContextHost()
    hosts.push(host)
    await host.addHTTPContext({
      key: 'remote',
      url: URL_MCP,
      protocolVersion: '2026-07-28',
      runtime: env.runtime,
      reconnect: FAST,
    })
    await host.setup({ key: 'remote' })

    const reconnected = nextEvent(host, 'context:reconnected')
    const error = await host
      .callTool({ key: 'remote', name: 'read', arguments: {} })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TaskInterruptedError)
    await reconnected
    expect(env.requests.filter((method) => method === 'tools/call')).toHaveLength(1)
  })
})
