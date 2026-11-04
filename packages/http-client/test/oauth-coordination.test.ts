import { expect, test } from 'vitest'

import { type AuthorizationHandler, createOAuthMiddleware } from '../src/oauth/middleware.js'
import {
  createMemoryTokenStore,
  parseTokenStoreKey,
  type StoredTokens,
  tokenStoreKey,
} from '../src/oauth/store.js'
import { createMemoryStore } from '../src/store.js'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const noAuthorize: AuthorizationHandler = {
  async authorize() {
    throw new Error('should not authorize')
  },
}

test('memory store update is atomic per key', async () => {
  const store = createMemoryStore<number>()
  await Promise.all(
    Array.from({ length: 20 }, () =>
      store.update('n', async (current) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return (current ?? 0) + 1
      }),
    ),
  )
  expect(await store.get('n')).toBe(20)
  expect(await store.keys()).toEqual(['n'])
  // Returning undefined deletes; a throwing fn writes nothing.
  await expect(
    store.update('n', () => {
      throw new Error('nope')
    }),
  ).rejects.toThrow('nope')
  expect(await store.get('n')).toBe(20)
  expect(await store.update('n', () => undefined)).toBeUndefined()
  expect(await store.keys()).toEqual([])
})

test('token store keys separate clients and scope sets', () => {
  const a = tokenStoreKey({ resource: 'https://r/mcp', clientID: 'a', scopes: ['w', 'r', 'w'] })
  expect(a).toBe(tokenStoreKey({ resource: 'https://r/mcp', clientID: 'a', scopes: ['r', 'w'] }))
  expect(a).not.toBe(
    tokenStoreKey({ resource: 'https://r/mcp', clientID: 'b', scopes: ['r', 'w'] }),
  )
  expect(a).not.toBe(tokenStoreKey({ resource: 'https://r/mcp', clientID: 'a' }))
  expect(parseTokenStoreKey(a)).toEqual({
    resource: 'https://r/mcp',
    clientID: 'a',
    scopes: ['r', 'w'],
  })
  expect(parseTokenStoreKey('https://r/mcp')).toBeUndefined()
})

test('middlewares sharing a store redeem a rotating refresh token once', async () => {
  const resource = 'https://mcp.example.com/mcp'
  const store = createMemoryTokenStore()
  await store.set(tokenStoreKey({ resource, clientID: 'c' }), {
    accessToken: 'old',
    tokenType: 'Bearer',
    refreshToken: 'r1',
    expiresAt: 1000,
    tokenEndpoint: 'https://as.example.com/token',
    issuer: 'https://as.example.com',
  })
  // A rotating authorisation server: each refresh token is valid exactly once.
  const valid = new Set(['r1'])
  let generation = 1
  let refreshes = 0
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/token')) {
      refreshes++
      const presented = new URLSearchParams(String(init?.body)).get('refresh_token') ?? ''
      if (!valid.delete(presented)) return json({ error: 'invalid_grant' }, 400)
      generation++
      valid.add(`r${generation}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return json({
        access_token: `a${generation}`,
        token_type: 'Bearer',
        refresh_token: `r${generation}`,
        expires_in: 3600,
      })
    }
    const auth = new Headers(init?.headers).get('Authorization')
    return auth === `Bearer a${generation}` ? json({ ok: true }) : json({}, 401)
  }
  const contexts = Array.from({ length: 3 }, () =>
    createOAuthMiddleware({ clientID: 'c', resource, handler: noAuthorize, store, now: () => 999 }),
  )
  const responses = await Promise.all(
    contexts.map((mw) => mw(next)(resource, { method: 'POST', body: '{}' })),
  )
  expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
  expect(refreshes).toBe(1)
  expect((await store.get(tokenStoreKey({ resource, clientID: 'c' })))?.refreshToken).toBe('r2')
})

test('two clients on one resource keep separate tokens', async () => {
  const resource = 'https://mcp.example.com/mcp'
  const store = createMemoryTokenStore()
  for (const clientID of ['a', 'b']) {
    await store.set(tokenStoreKey({ resource, clientID }), {
      accessToken: `token-${clientID}`,
      tokenType: 'Bearer',
    })
  }
  const sent: Array<string | null> = []
  const next = async (_url: string, init?: RequestInit): Promise<Response> => {
    sent.push(new Headers(init?.headers).get('Authorization'))
    return json({ ok: true })
  }
  for (const clientID of ['a', 'b']) {
    const mw = createOAuthMiddleware({ clientID, resource, handler: noAuthorize, store })
    await mw(next)(resource, { method: 'POST' })
  }
  expect(sent).toEqual(['Bearer token-a', 'Bearer token-b'])
})

test('authorisations through one handler never overlap', async () => {
  let active = 0
  let maxActive = 0
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL, state }) {
      active++
      maxActive = Math.max(maxActive, active)
      buildAuthorizationURL('http://127.0.0.1:1/cb')
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
      return { code: 'code', state, redirectURI: 'http://127.0.0.1:1/cb' }
    },
  }
  const store = createMemoryTokenStore()
  const issued = new Set<string>()
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url)
    if (u.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return json({
        resource: `https://${u.host}/mcp`,
        authorization_servers: ['https://as.example.com'],
      })
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
      const token = `t${issued.size}`
      issued.add(token)
      return json({ access_token: token, token_type: 'Bearer' })
    }
    const auth = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '')
    if (auth != null && issued.has(auth)) return json({ ok: true })
    return new Response('unauth', { status: 401 })
  }
  const resources = ['https://one.example.com/mcp', 'https://two.example.com/mcp']
  const responses = await Promise.all(
    resources.map((resource) =>
      createOAuthMiddleware({ clientID: 'c', resource, handler, store })(next)(resource, {
        method: 'POST',
      }),
    ),
  )
  expect(responses.map((r) => r.status)).toEqual([200, 200])
  expect(maxActive).toBe(1)
  const keys = await store.keys()
  expect(keys).toHaveLength(2)
  const stored = await Promise.all(keys.map((k) => store.get(k)))
  expect(
    stored.every((t: StoredTokens | undefined) => t?.issuer === 'https://as.example.com'),
  ).toBe(true)
})
