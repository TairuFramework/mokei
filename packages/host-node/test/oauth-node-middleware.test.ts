import { createMemoryTokenStore } from '@mokei/http-client'
import { expect, test } from 'vitest'

import { createNodeOAuthMiddleware } from '../src/oauth/node-middleware.js'

test('returns a FetchMiddleware that composes into a callable fetch-like function', () => {
  const middleware = createNodeOAuthMiddleware({ clientId: 'c' })
  expect(typeof middleware).toBe('function')

  const next = async () => new Response('ok', { status: 200 })
  const fetchLike = middleware(next)
  expect(typeof fetchLike).toBe('function')
})

test('wires a pre-seeded store into the middleware without invoking the handler', async () => {
  const resource = 'https://api.example.com/mcp'
  const store = createMemoryTokenStore()
  await store.set(resource, { accessToken: 'seeded-token', tokenType: 'Bearer' })

  const handler = {
    authorize: () => {
      throw new Error('handler should not be called when a valid token is already stored')
    },
  }

  const middleware = createNodeOAuthMiddleware({
    clientId: 'c',
    resource,
    store,
    handler,
  })

  let capturedAuthHeader: string | null = null
  const next = async (_url: string | URL, init?: RequestInit) => {
    capturedAuthHeader = new Headers(init?.headers).get('Authorization')
    return new Response('ok', { status: 200 })
  }

  const fetchLike = middleware(next)
  const response = await fetchLike(resource, {})

  expect(response.status).toBe(200)
  expect(capturedAuthHeader).toBe('Bearer seeded-token')
})

test('tokensPath produces a file-backed store', async () => {
  const middleware = createNodeOAuthMiddleware({
    clientId: 'c',
    tokensPath: '/tmp/mokei-oauth-node-middleware-test-tokens.json',
  })
  expect(typeof middleware).toBe('function')
})
