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

function unauthorized(): Response {
  return new Response('unauth', {
    status: 401,
    headers: {
      'WWW-Authenticate':
        'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    },
  })
}

test('two concurrent 401s dedupe to a single authorize/token-exchange, both requests succeed', async () => {
  const store = createMemoryTokenStore()
  let authorizeCalls = 0
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL, state }) {
      authorizeCalls += 1
      const redirectURI = 'http://127.0.0.1:5555/cb'
      buildAuthorizationURL(redirectURI)
      return { code: 'auth-code', state, redirectURI }
    },
  }

  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) {
      return json({ resource, authorization_servers: ['https://as.example.com'] })
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
      return json({ access_token: 'fresh', token_type: 'Bearer', expires_in: 3600 })
    }
    const auth = new Headers(init?.headers).get('Authorization')
    if (auth === 'Bearer fresh') return json({ ok: true })
    return unauthorized()
  }

  const mw = createOAuthMiddleware({ clientID: 'c', resource, handler, store })
  const [resA, resB] = await Promise.all([
    mw(next)(resource, { method: 'POST', body: '{}' }),
    mw(next)(resource, { method: 'POST', body: '{}' }),
  ])

  expect(resA.status).toBe(200)
  expect(resB.status).toBe(200)
  expect(authorizeCalls).toBe(1)
  expect((await store.get(resource))?.accessToken).toBe('fresh')
})

test('a rejected pre-emptive-refresh leader does not hard-fail a concurrent 401 caller', async () => {
  const store = createMemoryTokenStore()
  await store.set(resource, {
    accessToken: 'stale',
    tokenType: 'Bearer',
    refreshToken: 'bad-refresh',
    expiresAt: 1000,
    tokenEndpoint: 'https://as.example.com/token',
    issuer: 'https://as.example.com',
  })

  let authorizeCalls = 0
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL, state }) {
      authorizeCalls += 1
      const redirectURI = 'http://127.0.0.1:5555/cb'
      buildAuthorizationURL(redirectURI)
      return { code: 'auth-code', state, redirectURI }
    },
  }

  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) {
      return json({ resource, authorization_servers: ['https://as.example.com'] })
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
      const body = String(init?.body ?? '')
      if (body.includes('grant_type=refresh_token')) {
        // The refresh token is bad: refresh always fails.
        return new Response('server error', { status: 500 })
      }
      // authorization_code exchange succeeds.
      return json({ access_token: 'fresh', token_type: 'Bearer', expires_in: 3600 })
    }
    const auth = new Headers(init?.headers).get('Authorization')
    if (auth === 'Bearer fresh') return json({ ok: true })
    return unauthorized()
  }

  const mw = createOAuthMiddleware({ clientID: 'c', resource, handler, store, now: () => 999 })

  // Two concurrent callers share the near-expiry token: both may attempt a pre-emptive refresh
  // (which always fails), and both must still converge on exactly one recovery authorize instead
  // of either request throwing.
  const results = await Promise.allSettled([
    mw(next)(resource, { method: 'POST', body: '{}' }),
    mw(next)(resource, { method: 'POST', body: '{}' }),
  ])

  for (const result of results) {
    expect(result.status).toBe('fulfilled')
    if (result.status === 'fulfilled') {
      expect(result.value.status).toBe(200)
    }
  }
  expect(authorizeCalls).toBe(1)
  expect((await store.get(resource))?.accessToken).toBe('fresh')
})

test('two createOAuthMiddleware instances never share a single-flight lock', async () => {
  const storeA = createMemoryTokenStore()
  const storeB = createMemoryTokenStore()
  let authorizeCallsA = 0
  let authorizeCallsB = 0

  const handlerA: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL, state }) {
      authorizeCallsA += 1
      const redirectURI = 'http://127.0.0.1:5555/cb'
      buildAuthorizationURL(redirectURI)
      return { code: 'code-a', state, redirectURI }
    },
  }
  const handlerB: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL, state }) {
      authorizeCallsB += 1
      const redirectURI = 'http://127.0.0.1:5555/cb'
      buildAuthorizationURL(redirectURI)
      return { code: 'code-b', state, redirectURI }
    },
  }

  function makeNext(expectedCode: string, token: string) {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('oauth-protected-resource')) {
        return json({ resource, authorization_servers: ['https://as.example.com'] })
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
        const body = String(init?.body ?? '')
        expect(body).toContain(`code=${expectedCode}`)
        return json({ access_token: token, token_type: 'Bearer', expires_in: 3600 })
      }
      const auth = new Headers(init?.headers).get('Authorization')
      if (auth === `Bearer ${token}`) return json({ ok: true })
      return unauthorized()
    }
  }

  const mwA = createOAuthMiddleware({
    clientID: 'client-a',
    resource,
    handler: handlerA,
    store: storeA,
  })
  const mwB = createOAuthMiddleware({
    clientID: 'client-b',
    resource,
    handler: handlerB,
    store: storeB,
  })

  const [resA, resB] = await Promise.all([
    mwA(makeNext('code-a', 'token-a'))(resource, { method: 'POST', body: '{}' }),
    mwB(makeNext('code-b', 'token-b'))(resource, { method: 'POST', body: '{}' }),
  ])

  expect(resA.status).toBe(200)
  expect(resB.status).toBe(200)
  expect(authorizeCallsA).toBe(1)
  expect(authorizeCallsB).toBe(1)
  expect((await storeA.get(resource))?.accessToken).toBe('token-a')
  expect((await storeB.get(resource))?.accessToken).toBe('token-b')
})
