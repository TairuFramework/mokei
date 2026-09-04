import { expect, test } from 'vitest'

import { type AuthorizationHandler, createOAuthMiddleware } from '../src/oauth/middleware.js'
import { createMemoryTokenStore } from '../src/oauth/store.js'

const resource = 'https://mcp.example.com/mcp'
const handler: AuthorizationHandler = {
  async authorize() {
    throw new Error('should not authorize when a valid refresh token exists')
  },
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
