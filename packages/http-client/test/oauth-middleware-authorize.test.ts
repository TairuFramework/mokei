import { expect, test } from 'vitest'

import { type AuthorizationHandler, createOAuthMiddleware } from '../src/oauth/middleware.js'
import { createMemoryTokenStore } from '../src/oauth/store.js'

const resource = 'https://mcp.example.com/mcp'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('runs full authorize on 401 then retries with the new token', async () => {
  const store = createMemoryTokenStore()
  let capturedState = ''
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL, state }) {
      capturedState = state
      const url = new URL(buildAuthorizationURL('http://127.0.0.1:5555/cb'))
      // assert the core stamped the required params
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('resource')).toBe(resource)
      expect(url.searchParams.get('state')).toBe(state)
      return { code: 'auth-code', state, redirectURI: 'http://127.0.0.1:5555/cb' }
    },
  }

  let protectedCalls = 0
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth-protected-resource'))
      return json({ resource, authorization_servers: ['https://as.example.com'] })
    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return json({
        issuer: 'https://as.example.com',
        authorization_endpoint: 'https://as.example.com/authorize',
        token_endpoint: 'https://as.example.com/token',
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (url.endsWith('/token'))
      return json({ access_token: 'fresh', token_type: 'Bearer', expires_in: 3600 })
    // protected resource: 401 first, then 200 once Authorization present
    protectedCalls += 1
    const auth = new Headers(init?.headers).get('Authorization')
    if (auth === 'Bearer fresh') return json({ ok: true })
    return new Response('unauth', {
      status: 401,
      headers: {
        'WWW-Authenticate':
          'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
      },
    })
  }

  const mw = createOAuthMiddleware({ clientID: 'c', resource, handler, store })
  const res = await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(res.status).toBe(200)
  expect(capturedState).not.toBe('')
  expect((await store.get(resource))?.accessToken).toBe('fresh')
  expect(protectedCalls).toBe(2)
})

test('with no store in config, a default in-memory store retains the token across requests', async () => {
  let authorizeCalls = 0
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL, state }) {
      authorizeCalls += 1
      buildAuthorizationURL('http://127.0.0.1:5555/cb')
      return { code: 'auth-code', state, redirectURI: 'http://127.0.0.1:5555/cb' }
    },
  }

  let protectedCalls = 0
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth-protected-resource'))
      return json({ resource, authorization_servers: ['https://as.example.com'] })
    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return json({
        issuer: 'https://as.example.com',
        authorization_endpoint: 'https://as.example.com/authorize',
        token_endpoint: 'https://as.example.com/token',
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (url.endsWith('/token'))
      return json({ access_token: 'fresh', token_type: 'Bearer', expires_in: 3600 })
    protectedCalls += 1
    const auth = new Headers(init?.headers).get('Authorization')
    if (auth === 'Bearer fresh') return json({ ok: true })
    return new Response('unauth', {
      status: 401,
      headers: {
        'WWW-Authenticate':
          'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
      },
    })
  }

  // No `store` in config: the middleware must create a default in-memory store once, at
  // construction, and reuse it across every request from this middleware instance.
  const mw = createOAuthMiddleware({ clientID: 'c', resource, handler })
  const fetch = mw(next)

  const first = await fetch(resource, { method: 'POST', body: '{}' })
  expect(first.status).toBe(200)
  expect(authorizeCalls).toBe(1)
  expect(protectedCalls).toBe(2)

  // Second request reuses the token the default store retained: no second authorize, and the
  // request succeeds on the first attempt (no 401 round trip).
  const second = await fetch(resource, { method: 'POST', body: '{}' })
  expect(second.status).toBe(200)
  expect(authorizeCalls).toBe(1)
  expect(protectedCalls).toBe(3)
})

test('refuses to attach a bearer token over cleartext non-loopback HTTP', async () => {
  const store = createMemoryTokenStore()
  await store.set('http://evil.example/mcp', { accessToken: 'secret', tokenType: 'Bearer' })
  const handler: AuthorizationHandler = {
    async authorize(): Promise<never> {
      throw new Error('should not authorize')
    },
  }
  let called = false
  const next = async (): Promise<Response> => {
    called = true
    return json({ ok: true })
  }
  const mw = createOAuthMiddleware({ clientID: 'c', handler, store })
  await expect(mw(next)('http://evil.example/mcp', { method: 'POST' })).rejects.toThrow(
    /https|loopback/i,
  )
  expect(called).toBe(false)
})

test('proceeds normally for an https transport URL', async () => {
  const store = createMemoryTokenStore()
  const handler: AuthorizationHandler = {
    async authorize(): Promise<never> {
      throw new Error('should not authorize')
    },
  }
  const next = async (): Promise<Response> => json({ ok: true })
  const mw = createOAuthMiddleware({ clientID: 'c', handler, store })
  const res = await mw(next)('https://api.example/mcp', { method: 'POST' })
  expect(res.status).toBe(200)
})

test('proceeds normally for a loopback http transport URL', async () => {
  const store = createMemoryTokenStore()
  const handler: AuthorizationHandler = {
    async authorize(): Promise<never> {
      throw new Error('should not authorize')
    },
  }
  const next = async (): Promise<Response> => json({ ok: true })
  const mw = createOAuthMiddleware({ clientID: 'c', handler, store })
  const res = await mw(next)('http://localhost:3000/mcp', { method: 'POST' })
  expect(res.status).toBe(200)
})

// J1: `init.signal` is threaded through discovery and into `config.handler.authorize` so an
// aborted outbound request cancels the whole interactive recovery flow instead of leaving it to
// run to completion in the background.
test('J1: init.signal is threaded through to config.handler.authorize', async () => {
  const store = createMemoryTokenStore()
  let receivedSignal: AbortSignal | undefined
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL, signal }): Promise<never> {
      receivedSignal = signal
      buildAuthorizationURL('http://127.0.0.1:5555/cb')
      throw new Error('abort observed by handler')
    },
  }
  const next = async (url: string): Promise<Response> => {
    if (url.includes('oauth-protected-resource'))
      return json({ resource, authorization_servers: ['https://as.example.com'] })
    if (url.endsWith('/.well-known/oauth-authorization-server'))
      return json({
        issuer: 'https://as.example.com',
        authorization_endpoint: 'https://as.example.com/authorize',
        token_endpoint: 'https://as.example.com/token',
      })
    return new Response('unauth', {
      status: 401,
      headers: {
        'WWW-Authenticate':
          'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
      },
    })
  }
  const mw = createOAuthMiddleware({ clientID: 'c', resource, handler, store })
  const controller = new AbortController()
  controller.abort()
  await expect(
    mw(next)(resource, { method: 'POST', body: '{}', signal: controller.signal }),
  ).rejects.toThrow(/abort observed/)
  expect(receivedSignal).toBe(controller.signal)
  expect(receivedSignal?.aborted).toBe(true)
})

test('rejects a state mismatch from the handler', async () => {
  const store = createMemoryTokenStore()
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL }) {
      buildAuthorizationURL('http://127.0.0.1:1/cb')
      return { code: 'c', state: 'WRONG', redirectURI: 'http://127.0.0.1:1/cb' }
    },
  }
  const next = async (url: string): Promise<Response> => {
    if (url.includes('oauth-protected-resource'))
      return json({ resource, authorization_servers: ['https://as.example.com'] })
    if (url.endsWith('/.well-known/oauth-authorization-server'))
      return json({
        issuer: 'https://as.example.com',
        authorization_endpoint: 'https://as.example.com/authorize',
        token_endpoint: 'https://as.example.com/token',
      })
    return new Response('unauth', {
      status: 401,
      headers: {
        'WWW-Authenticate':
          'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
      },
    })
  }
  const mw = createOAuthMiddleware({ clientID: 'c', resource, handler, store })
  await expect(mw(next)(resource, { method: 'POST', body: '{}' })).rejects.toThrow(/state/i)
})
