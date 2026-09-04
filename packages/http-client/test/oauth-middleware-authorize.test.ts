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
    async authorize({ buildAuthorizationUrl, state }) {
      capturedState = state
      const url = new URL(buildAuthorizationUrl('http://127.0.0.1:5555/cb'))
      // assert the core stamped the required params
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('resource')).toBe(resource)
      expect(url.searchParams.get('state')).toBe(state)
      return { code: 'auth-code', state, redirectUri: 'http://127.0.0.1:5555/cb' }
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

  const mw = createOAuthMiddleware({ clientId: 'c', resource, handler, store })
  const res = await mw(next)(resource, { method: 'POST', body: '{}' })
  expect(res.status).toBe(200)
  expect(capturedState).not.toBe('')
  expect((await store.get(resource))?.accessToken).toBe('fresh')
  expect(protectedCalls).toBe(2)
})

test('rejects a state mismatch from the handler', async () => {
  const store = createMemoryTokenStore()
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationUrl }) {
      buildAuthorizationUrl('http://127.0.0.1:1/cb')
      return { code: 'c', state: 'WRONG', redirectUri: 'http://127.0.0.1:1/cb' }
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
  const mw = createOAuthMiddleware({ clientId: 'c', resource, handler, store })
  await expect(mw(next)(resource, { method: 'POST', body: '{}' })).rejects.toThrow(/state/i)
})
