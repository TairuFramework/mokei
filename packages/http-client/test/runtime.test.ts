import { fromB64U } from '@sozai/codec'
import { createRuntime, type GetRandomValues } from '@sozai/runtime'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { type AuthorizationHandler, createOAuthMiddleware } from '../src/oauth/middleware.js'
import { createMemoryTokenStore } from '../src/oauth/store.js'
import { type FetchLike, type FetchMiddleware, HTTPTransport } from '../src/transport.js'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fillOnes: GetRandomValues = (array) => {
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(1)
  return array
}

function allOnes(encoded: string | null | undefined): boolean {
  if (encoded == null || encoded === '') return false
  return fromB64U(encoded).every((byte) => byte === 1)
}

describe('runtime injection', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('transport uses runtime.fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('globalThis.fetch must not be used')
      }),
    )
    const fetch = vi.fn(async () => json({ jsonrpc: '2.0', id: 0, result: {} }))
    const transport = new HTTPTransport({
      url: 'https://example.test/mcp',
      runtime: createRuntime({ fetch }),
    })
    await transport.write({ jsonrpc: '2.0', id: 0, method: 'ping' } as never)
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.test/mcp')
    expect(init.method).toBe('POST')
    await transport.dispose()
  })

  test('fetchMiddleware wraps runtime.fetch', async () => {
    const fetch = vi.fn(async () => json({ jsonrpc: '2.0', id: 0, result: {} }))
    let wrapped: FetchLike | undefined
    const middleware: FetchMiddleware = (next) => {
      wrapped = next
      return next
    }
    const transport = new HTTPTransport({
      url: 'https://example.test/mcp',
      runtime: createRuntime({ fetch }),
      fetchMiddleware: middleware,
    })
    await transport.write({ jsonrpc: '2.0', id: 0, method: 'ping' } as never)
    expect(wrapped).toBeDefined()
    expect(fetch).toHaveBeenCalledOnce()
    await transport.dispose()
  })

  test('OAuth state and verifier come from runtime.getRandomValues', async () => {
    const resource = 'https://mcp.example.com/mcp'
    let state: string | undefined
    let verifier: string | null = null
    const handler: AuthorizationHandler = {
      async authorize(params) {
        state = params.state
        params.buildAuthorizationURL('http://127.0.0.1:5555/cb')
        return { code: 'code', state: params.state, redirectURI: 'http://127.0.0.1:5555/cb' }
      },
    }
    const next = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('oauth-protected-resource'))
        return json({ resource, authorization_servers: ['https://as.example.com'] })
      if (url.endsWith('/.well-known/oauth-authorization-server'))
        return json({
          issuer: 'https://as.example.com',
          authorization_endpoint: 'https://as.example.com/authorize',
          token_endpoint: 'https://as.example.com/token',
          code_challenge_methods_supported: ['S256'],
        })
      if (url.endsWith('/token')) {
        verifier = new URLSearchParams(String(init?.body)).get('code_verifier')
        return json({ access_token: 'fresh', token_type: 'Bearer' })
      }
      if (new Headers(init?.headers).get('Authorization') === 'Bearer fresh') return json({})
      return new Response('unauth', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
    }
    const middleware = createOAuthMiddleware({
      clientID: 'c',
      resource,
      handler,
      store: createMemoryTokenStore(),
      runtime: createRuntime({ getRandomValues: fillOnes }),
    })
    const response = await middleware(next)(resource, { method: 'POST', body: '{}' })
    expect(response.status).toBe(200)
    expect(allOnes(state)).toBe(true)
    expect(allOnes(verifier)).toBe(true)
  })
})
