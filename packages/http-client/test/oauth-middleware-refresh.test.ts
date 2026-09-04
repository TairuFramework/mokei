import { expect, test } from 'vitest'

import { type AuthorizationHandler, createOAuthMiddleware } from '../src/oauth/middleware.js'
import { createMemoryTokenStore } from '../src/oauth/store.js'

const resource = 'https://mcp.example.com/mcp'
const handler: AuthorizationHandler = {
  async authorize() {
    throw new Error('should not authorize when a valid refresh token exists')
  },
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('attaches the stored access token as Bearer', async () => {
  const store = createMemoryTokenStore()
  await store.set(resource, { accessToken: 'tok', tokenType: 'Bearer', expiresAt: 9_999_999_999 })
  const mw = createOAuthMiddleware({ clientId: 'c', resource, handler, store, now: () => 1000 })
  let seenAuth: string | null = null
  const next = async (_url: string, init?: RequestInit): Promise<Response> => {
    seenAuth = new Headers(init?.headers).get('Authorization')
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(seenAuth).toBe('Bearer tok')
})

test('pre-emptively refreshes an access token near expiry', async () => {
  const store = createMemoryTokenStore()
  await store.set(resource, {
    accessToken: 'old',
    tokenType: 'Bearer',
    refreshToken: 'r1',
    expiresAt: 1000,
    tokenEndpoint: 'https://as.example.com/token',
    issuer: 'https://as.example.com',
  })
  let tokenCalls = 0
  const next = async (url: string): Promise<Response> => {
    if (url.endsWith('/token')) {
      tokenCalls += 1
      return new Response(
        JSON.stringify({
          access_token: 'new',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'r2',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json', Authorization: '' },
    })
  }
  const mw = createOAuthMiddleware({ clientId: 'c', resource, handler, store, now: () => 999 })
  await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(tokenCalls).toBe(1)
  expect((await store.get(resource))?.accessToken).toBe('new')
  expect((await store.get(resource))?.refreshToken).toBe('r2')
})

test('reads and writes the token store under the canonical resource key', async () => {
  const store = createMemoryTokenStore()
  const canonicalKey = 'https://mcp.example.com/mcp'
  await store.set(canonicalKey, {
    accessToken: 'old',
    tokenType: 'Bearer',
    refreshToken: 'r1',
    expiresAt: 1000,
    tokenEndpoint: 'https://as.example.com/token',
    issuer: 'https://as.example.com',
  })
  const next = async (url: string): Promise<Response> => {
    if (url.endsWith('/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'new',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'r2',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  // resource omitted: derived from the request URL, which carries a query the store key must not.
  const mw = createOAuthMiddleware({ clientId: 'c', handler, store, now: () => 999 })
  await mw(next)('https://mcp.example.com/mcp?x=1', { method: 'POST', body: '{}' })
  expect((await store.get(canonicalKey))?.accessToken).toBe('new')
  expect((await store.get(canonicalKey))?.refreshToken).toBe('r2')
})

test('a 401 with a usable refresh token refreshes instead of calling authorize', async () => {
  const store = createMemoryTokenStore()
  await store.set(resource, {
    accessToken: 'stale',
    tokenType: 'Bearer',
    refreshToken: 'r1',
    // Not near expiry: the pre-emptive refresh block above must not be what does the refresh.
    expiresAt: 9_999_999_999,
    tokenEndpoint: 'https://as.example.com/token',
    issuer: 'https://as.example.com',
  })
  let tokenCalls = 0
  let protectedCalls = 0
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/token')) {
      tokenCalls += 1
      return new Response(
        JSON.stringify({
          access_token: 'refreshed',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'r2',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    protectedCalls += 1
    const auth = new Headers(init?.headers).get('Authorization')
    if (auth === 'Bearer refreshed') return json({ ok: true })
    return new Response('unauth', { status: 401, headers: {} })
  }
  const mw = createOAuthMiddleware({ clientId: 'c', resource, handler, store, now: () => 1000 })
  const response = await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(response.status).toBe(200)
  expect(tokenCalls).toBe(1)
  expect(protectedCalls).toBe(2)
  expect((await store.get(resource))?.accessToken).toBe('refreshed')
})

test('falls through to interactive authorize when the refresh exchange itself fails', async () => {
  const store = createMemoryTokenStore()
  await store.set(resource, {
    accessToken: 'stale',
    tokenType: 'Bearer',
    refreshToken: 'r1',
    expiresAt: 9_999_999_999,
    tokenEndpoint: 'https://as.example.com/token',
    issuer: 'https://as.example.com',
  })
  let authorizeCalls = 0
  const authorizingHandler: AuthorizationHandler = {
    async authorize({ buildAuthorizationUrl, state }) {
      authorizeCalls += 1
      buildAuthorizationUrl('http://127.0.0.1:5555/cb')
      return { code: 'auth-code', state, redirectUri: 'http://127.0.0.1:5555/cb' }
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
      // The refresh exchange itself 401s: the handler must fall through to authorize.
      const body = String(init?.body ?? '')
      if (body.includes('grant_type=refresh_token')) {
        return new Response('invalid_grant', { status: 401 })
      }
      return json({ access_token: 'fresh', token_type: 'Bearer', expires_in: 3600 })
    }
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
  const mw = createOAuthMiddleware({
    clientId: 'c',
    resource,
    handler: authorizingHandler,
    store,
    now: () => 1000,
  })
  const response = await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(response.status).toBe(200)
  expect(authorizeCalls).toBe(1)
  expect((await store.get(resource))?.accessToken).toBe('fresh')
})

test('H5: the token-refresh fetch is made with redirect: "error" (SSRF/redirect guard)', async () => {
  const store = createMemoryTokenStore()
  await store.set(resource, {
    accessToken: 'old',
    tokenType: 'Bearer',
    refreshToken: 'r1',
    expiresAt: 1000,
    tokenEndpoint: 'https://as.example.com/token',
    issuer: 'https://as.example.com',
  })
  let seenRedirect: RequestRedirect | undefined
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/token')) {
      seenRedirect = init?.redirect
      return new Response(
        JSON.stringify({ access_token: 'new', token_type: 'Bearer', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const mw = createOAuthMiddleware({ clientId: 'c', resource, handler, store, now: () => 999 })
  await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(seenRedirect).toBe('error')
})

test('a failed pre-emptive refresh does not fail the outbound request', async () => {
  const store = createMemoryTokenStore()
  await store.set(resource, {
    accessToken: 'old',
    tokenType: 'Bearer',
    refreshToken: 'r1',
    expiresAt: 1000,
    tokenEndpoint: 'https://as.example.com/token',
    issuer: 'https://as.example.com',
  })
  let seenAuth: string | null = null
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/token')) {
      return new Response('server error', { status: 500 })
    }
    seenAuth = new Headers(init?.headers).get('Authorization')
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const mw = createOAuthMiddleware({ clientId: 'c', resource, handler, store, now: () => 999 })
  const response = await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(response.status).toBe(200)
  expect(seenAuth).toBe('Bearer old')
  expect((await store.get(resource))?.accessToken).toBe('old')
})
