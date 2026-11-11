import { createRuntime } from '@sozai/runtime'
import { describe, expect, test } from 'vitest'

import { type AuthorizationHandler, createOAuthMiddleware } from '../src/oauth/middleware.js'
import { createMemoryTokenStore } from '../src/oauth/store.js'
import { createHTTPClient, type FetchLike, HTTPTransport } from '../src/transport.js'

const RESOURCE = 'https://mcp.example.com/mcp'
const REDIRECT = 'http://127.0.0.1/cb'

type ErrorFrame = { id?: unknown; error?: { message?: string } }

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    })
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * An MCP endpoint behind OAuth: 401 until `Bearer fresh`, then JSON-RPC answers. `token`
 * overrides the token endpoint (default: issues `fresh`).
 */
function server(options: { token?: (init?: RequestInit) => Promise<Response> } = {}) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted) throw init.signal.reason
    const url = String(input)
    if (url.includes('oauth-protected-resource')) {
      return json({ resource: RESOURCE, authorization_servers: ['https://as.example.com'] })
    }
    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return json({
        issuer: 'https://as.example.com',
        authorization_endpoint: 'https://as.example.com/authorize',
        token_endpoint: 'https://as.example.com/token',
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (url.endsWith('/token')) {
      return options.token
        ? options.token(init)
        : json({ access_token: 'fresh', token_type: 'Bearer' })
    }
    if (new Headers(init?.headers).get('Authorization') !== 'Bearer fresh') {
      return new Response('unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      })
    }
    const message = JSON.parse(String(init?.body))
    if (message.id == null) return new Response(null, { status: 202 })
    if (message.method === 'initialize') {
      return json({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 's', version: '1' },
        },
      })
    }
    if (message.method === 'server/discover') {
      return json({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          resultType: 'complete',
          supportedVersions: ['2026-07-28'],
          capabilities: { tools: {} },
          ttlMs: 0,
          cacheScope: 'private',
        },
      })
    }
    return json({ jsonrpc: '2.0', id: message.id, result: { resultType: 'complete', tools: [] } })
  }
}

function slowHandler(ms: number, seen?: { signal?: AbortSignal }): AuthorizationHandler {
  return {
    async authorize(params) {
      if (seen) seen.signal = params.signal
      params.buildAuthorizationURL(REDIRECT)
      await sleep(ms)
      return { code: 'code', state: params.state, redirectURI: REDIRECT }
    },
  }
}

function neverHandler(seen: { signal?: AbortSignal }): AuthorizationHandler {
  return {
    authorize(params) {
      seen.signal = params.signal
      return new Promise((_resolve, reject) => {
        params.signal?.addEventListener('abort', () => reject(params.signal?.reason))
      })
    },
  }
}

function transportWith(fetch: ReturnType<typeof server>, handler: AuthorizationHandler) {
  return new HTTPTransport({
    url: RESOURCE,
    timeout: 50,
    runtime: createRuntime({ fetch: fetch as typeof globalThis.fetch }),
    fetchMiddleware: createOAuthMiddleware({
      clientID: 'c',
      resource: RESOURCE,
      handler,
      store: createMemoryTokenStore(),
    }),
  })
}

async function ping(transport: HTTPTransport): Promise<ErrorFrame & { result?: unknown }> {
  await transport.write({ jsonrpc: '2.0', id: 1, method: 'ping' } as never)
  const { value } = await transport.read()
  return value as ErrorFrame & { result?: unknown }
}

describe('sign-in outside the request deadline', () => {
  test('a sign-in longer than the request timeout succeeds', async () => {
    const transport = transportWith(server(), slowHandler(150))
    const frame = await ping(transport)
    expect(frame.error).toBeUndefined()
    expect(frame.result).toBeDefined()
    await transport.dispose()
  })

  test('a sign-in past authorizationTimeout fails', async () => {
    const seen: { signal?: AbortSignal } = {}
    const middleware = createOAuthMiddleware({
      clientID: 'c',
      resource: RESOURCE,
      handler: neverHandler(seen),
      store: createMemoryTokenStore(),
      authorizationTimeout: 100,
    })
    const fetch = server() as FetchLike
    await expect(middleware(fetch)(RESOURCE, { method: 'POST', body: '{}' })).rejects.toThrow()
    expect(seen.signal?.aborted).toBe(true)
  })

  test('caller abort ends the sign-in wait', async () => {
    const seen: { signal?: AbortSignal } = {}
    const middleware = createOAuthMiddleware({
      clientID: 'c',
      resource: RESOURCE,
      handler: neverHandler(seen),
      store: createMemoryTokenStore(),
    })
    const controller = new AbortController()
    const reason = new Error('caller stopped')
    setTimeout(() => controller.abort(reason), 20)
    const started = Date.now()
    await expect(
      middleware(server() as FetchLike)(RESOURCE, {
        method: 'POST',
        body: '{}',
        signal: controller.signal,
      }),
    ).rejects.toBe(reason)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(seen.signal?.aborted).toBe(true)
  })

  test('network calls keep the timeout', async () => {
    const transport = new HTTPTransport({
      url: RESOURCE,
      timeout: 50,
      runtime: createRuntime({
        fetch: ((_url: unknown, init?: RequestInit) => hang(init)) as typeof globalThis.fetch,
      }),
    })
    const frame = await ping(transport)
    expect(frame.error?.message).toBe('Request timed out after 50ms')
    await transport.dispose()
  })

  test('OAuth discovery and token calls keep the timeout', async () => {
    const transport = transportWith(server({ token: hang }), slowHandler(0))
    const frame = await ping(transport)
    expect(frame.error?.message).toBe('Request timed out after 50ms')
    await transport.dispose()
  })

  for (const protocolVersion of ['2025-11-25', '2026-07-28', 'auto'] as const) {
    test(`setup survives a sign-in longer than setupTimeout (${protocolVersion})`, async () => {
      const client = createHTTPClient({
        url: RESOURCE,
        protocolVersion,
        setupTimeout: 50,
        timeout: 5000,
        runtime: createRuntime({ fetch: server() as typeof globalThis.fetch }),
        fetchMiddleware: createOAuthMiddleware({
          clientID: 'c',
          resource: RESOURCE,
          handler: slowHandler(150),
          store: createMemoryTokenStore(),
        }),
      })
      try {
        await expect(client.listTools()).resolves.toBeDefined()
      } finally {
        await client.dispose()
      }
    })
  }
})
