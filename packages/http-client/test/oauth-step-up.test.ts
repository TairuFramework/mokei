import { describe, expect, test } from 'vitest'

import { parseBearerChallenge, splitScopes } from '../src/oauth/challenge.js'
import { type AuthorizationHandler, createOAuthMiddleware } from '../src/oauth/middleware.js'
import { createMemoryTokenStore, type TokenStore, tokenStoreKey } from '../src/oauth/store.js'

const resource = 'https://mcp.example.com/mcp'
const AS = 'https://as.example.com'
const METADATA = 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp'
const key = tokenStoreKey({ resource, clientID: 'c', scopes: ['read'] })

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function insufficientScope(scope: string): Response {
  return json({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'needs admin' } }, 403, {
    'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${METADATA}"`,
  })
}

/**
 * A fake authorisation server issuing `tok:<scopes>` for whatever scopes the authorisation URL
 * asked for, in front of a resource whose `admin` call needs the `admin` scope.
 */
function setup(options: { stepUp?: boolean; store?: TokenStore; challengeScope?: string } = {}) {
  const store = options.store ?? createMemoryTokenStore()
  const authorizedScopes: Array<string | null> = []
  const refreshScopes: Array<string | null> = []
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL, state }) {
      const url = new URL(buildAuthorizationURL('http://127.0.0.1:5555/cb'))
      const scope = url.searchParams.get('scope')
      authorizedScopes.push(scope)
      return { code: scope ?? '', state, redirectURI: 'http://127.0.0.1:5555/cb' }
    },
  }
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) {
      return json({ resource, authorization_servers: [AS] })
    }
    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return json({
        issuer: AS,
        authorization_endpoint: `${AS}/authorize`,
        token_endpoint: `${AS}/token`,
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (url === `${AS}/token`) {
      const body = new URLSearchParams(String(init?.body))
      if (body.get('grant_type') === 'refresh_token') {
        refreshScopes.push(body.get('scope'))
        return json({
          access_token: `tok:${body.get('scope') ?? ''}`,
          token_type: 'Bearer',
          expires_in: 3600,
        })
      }
      return json({
        access_token: `tok:${body.get('code')}`,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh',
      })
    }
    const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '')
    if (token == null) return new Response(null, { status: 401 })
    const scopes = splitScopes(token.replace(/^tok:/, ''))
    if (!scopes.includes('admin')) return insufficientScope(options.challengeScope ?? 'read admin')
    return json({ ok: true })
  }
  const mw = createOAuthMiddleware({
    clientID: 'c',
    resource,
    scopes: ['read'],
    handler,
    store,
    stepUp: options.stepUp,
  })
  return { store, authorizedScopes, refreshScopes, fetch: mw(next) }
}

async function seedReader(store: TokenStore): Promise<void> {
  await store.set(key, {
    accessToken: 'tok:read',
    tokenType: 'Bearer',
    refreshToken: 'refresh',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    tokenEndpoint: `${AS}/token`,
    issuer: AS,
    requestedScopes: ['read'],
  })
}

describe('403 insufficient_scope step-up', () => {
  test('re-authorises for the wider scopes and retries once', async () => {
    const { store, authorizedScopes, fetch } = setup()
    await seedReader(store)
    const response = await fetch(resource, { method: 'POST', body: '{}' })
    expect(response.status).toBe(200)
    expect(authorizedScopes).toEqual(['read admin'])
    const stored = await store.get(key)
    expect(stored?.accessToken).toBe('tok:read admin')
    expect(stored?.requestedScopes).toEqual(['read', 'admin'])
  })

  test('keeps the scopes it already held when the challenge names only the new one', async () => {
    const { store, authorizedScopes, fetch } = setup({ challengeScope: 'admin' })
    await seedReader(store)
    expect((await fetch(resource, { method: 'POST', body: '{}' })).status).toBe(200)
    expect(authorizedScopes).toEqual(['read admin'])
  })

  test('a later refresh asks for the stepped-up scopes, not the configured ones', async () => {
    const { store, refreshScopes, fetch } = setup()
    await seedReader(store)
    await fetch(resource, { method: 'POST', body: '{}' })
    const stored = await store.get(key)
    // Expire it so the next request refreshes first.
    await store.set(key, { ...(stored as NonNullable<typeof stored>), expiresAt: 0 })
    const response = await fetch(resource, { method: 'POST', body: '{}' })
    expect(response.status).toBe(200)
    expect(refreshScopes).toEqual(['read admin'])
    expect((await store.get(key))?.requestedScopes).toEqual(['read', 'admin'])
  })

  test('passes the 403 through when the challenge asks for nothing new', async () => {
    const { store, authorizedScopes, fetch } = setup({ challengeScope: 'read' })
    await seedReader(store)
    const response = await fetch(resource, { method: 'POST', body: '{}' })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      'needs admin',
    )
    expect(authorizedScopes).toEqual([])
  })

  test('does not prompt again for scopes the authorisation server already refused', async () => {
    const { store, authorizedScopes, fetch } = setup()
    // Asked for admin before, but the token carries only read (the AS narrowed the grant).
    await store.set(key, {
      accessToken: 'tok:read',
      tokenType: 'Bearer',
      scope: 'read',
      requestedScopes: ['read', 'admin'],
    })
    const response = await fetch(resource, { method: 'POST', body: '{}' })
    expect(response.status).toBe(403)
    expect(authorizedScopes).toEqual([])
  })

  test('stepUp: false passes every 403 through', async () => {
    const { store, authorizedScopes, fetch } = setup({ stepUp: false })
    await seedReader(store)
    expect((await fetch(resource, { method: 'POST', body: '{}' })).status).toBe(403)
    expect(authorizedScopes).toEqual([])
  })

  test('concurrent 403s for the same key prompt once', async () => {
    const { store, authorizedScopes, fetch } = setup()
    await seedReader(store)
    const responses = await Promise.all([
      fetch(resource, { method: 'POST', body: '{}' }),
      fetch(resource, { method: 'POST', body: '{}' }),
      fetch(resource, { method: 'POST', body: '{}' }),
    ])
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    expect(authorizedScopes).toEqual(['read admin'])
  })

  test('a 403 that is not insufficient_scope is returned untouched', async () => {
    const store = createMemoryTokenStore()
    await seedReader(store)
    const handler: AuthorizationHandler = {
      async authorize(): Promise<never> {
        throw new Error('should not authorize')
      },
    }
    const mw = createOAuthMiddleware({ clientID: 'c', resource, scopes: ['read'], handler, store })
    const response = await mw(async () => new Response('Forbidden', { status: 403 }))(resource, {
      method: 'POST',
    })
    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })
})

test('a 401 challenge scope joins the authorisation request', async () => {
  const store = createMemoryTokenStore()
  const requested: Array<string | null> = []
  const handler: AuthorizationHandler = {
    async authorize({ buildAuthorizationURL, state }) {
      requested.push(
        new URL(buildAuthorizationURL('http://127.0.0.1:1/cb')).searchParams.get('scope'),
      )
      return { code: 'x', state, redirectURI: 'http://127.0.0.1:1/cb' }
    },
  }
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('oauth-protected-resource')) {
      return json({ resource, authorization_servers: [AS] })
    }
    if (url.endsWith('/.well-known/oauth-authorization-server')) {
      return json({
        issuer: AS,
        authorization_endpoint: `${AS}/authorize`,
        token_endpoint: `${AS}/token`,
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (url === `${AS}/token`) return json({ access_token: 'fresh', token_type: 'Bearer' })
    if (new Headers(init?.headers).get('Authorization') === 'Bearer fresh') return json({})
    return new Response(null, {
      status: 401,
      headers: { 'WWW-Authenticate': `Bearer resource_metadata="${METADATA}", scope="mcp:tools"` },
    })
  }
  const mw = createOAuthMiddleware({ clientID: 'c', resource, scopes: ['read'], handler, store })
  expect((await mw(next)(resource, { method: 'POST', body: '{}' })).status).toBe(200)
  expect(requested).toEqual(['read mcp:tools'])
  expect((await store.get(key))?.requestedScopes).toEqual(['read', 'mcp:tools'])
})

describe('parseBearerChallenge', () => {
  test('reads quoted and token params, case-insensitive names, escapes', () => {
    expect(
      parseBearerChallenge(
        'Bearer error="insufficient_scope", Scope="a b", realm=mcp, error_description="say \\"hi\\""',
      ),
    ).toEqual({
      error: 'insufficient_scope',
      scope: 'a b',
      realm: 'mcp',
      error_description: 'say "hi"',
    })
  })

  test('takes the Bearer challenge among several and ignores the others', () => {
    expect(
      parseBearerChallenge('Basic realm="x", Bearer scope="s", error="e", DPoP algs="ES256"'),
    ).toEqual({ scope: 's', error: 'e' })
    expect(parseBearerChallenge('Basic realm="x"')).toBeNull()
    expect(parseBearerChallenge(null)).toBeNull()
  })

  test('commas inside quoted values do not split params', () => {
    expect(parseBearerChallenge('Bearer error_description="a, b=c", scope="x"')).toEqual({
      error_description: 'a, b=c',
      scope: 'x',
    })
  })

  test('keeps the first of a repeated param and survives junk', () => {
    expect(parseBearerChallenge('bearer scope="first", scope="second"')).toEqual({
      scope: 'first',
    })
    expect(parseBearerChallenge('Bearer')).toEqual({})
    expect(parseBearerChallenge('Bearer scope="unterminated')).toEqual({})
    expect(parseBearerChallenge(',,, ;; Bearer error=x')).toEqual({ error: 'x' })
  })
})
