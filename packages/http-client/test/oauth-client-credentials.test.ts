import { b64uToJSON } from '@sozai/codec'
import { expect, test } from 'vitest'

import {
  type ClientAssertionSigner,
  createClientCredentialsMiddleware,
  createWebCryptoAssertionSigner,
} from '../src/index.js'
import { createClientCredentialsMiddleware as direct } from '../src/oauth/client-credentials.js'
import {
  type AuthorizationHandler,
  createOAuthMiddleware,
  withSingleFlight,
} from '../src/oauth/middleware.js'
import {
  clientCredentialsStoreKey,
  createMemoryTokenStore,
  type StoredTokens,
  tokenStoreKey,
} from '../src/oauth/store.js'

const resource = 'https://mcp.example.com/mcp'
const issuer = 'https://as.example.com'
const clientID = 'svc'

const signer: ClientAssertionSigner = {
  alg: 'EdDSA',
  async sign() {
    return new Uint8Array([1, 2, 3])
  },
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function decodeJWT(jwt: string): {
  header: Record<string, unknown>
  claims: Record<string, unknown>
} {
  const [header, claims] = jwt.split('.') as [string, string]
  return {
    header: b64uToJSON<Record<string, unknown>>(header),
    claims: b64uToJSON<Record<string, unknown>>(claims),
  }
}

type World = {
  next: (url: string, init?: RequestInit) => Promise<Response>
  tokenForms: Array<URLSearchParams>
  metadataCalls: Array<string>
  protectedAuth: Array<string | null>
}

type WorldOptions = {
  prmResource?: string
  authorizationServers?: Array<string>
  asMetadata?: Record<string, unknown>
  tokenResponse?: (form: URLSearchParams, index: number) => Response | Promise<Response>
  /** Response of the protected resource for a given Authorization header. */
  protectedResponse?: (auth: string | null) => Response
  challenge?: string
  /** Runs before the protected-resource metadata is served; may throw like a failed fetch. */
  onPRM?: () => void
}

function world(options: WorldOptions = {}): World {
  const tokenForms: Array<URLSearchParams> = []
  const metadataCalls: Array<string> = []
  const protectedAuth: Array<string | null> = []
  const asMetadata = options.asMetadata ?? {
    issuer,
    token_endpoint: `${issuer}/token`,
  }
  const next = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('/.well-known/oauth-protected-resource')) {
      metadataCalls.push(url)
      options.onPRM?.()
      return json({
        resource: options.prmResource ?? resource,
        authorization_servers: options.authorizationServers ?? [issuer],
      })
    }
    if (url === `${issuer}/.well-known/oauth-authorization-server`) {
      metadataCalls.push(url)
      return json(asMetadata)
    }
    if (url === `${issuer}/token`) {
      const form = new URLSearchParams(String(init?.body))
      tokenForms.push(form)
      if (options.tokenResponse != null) {
        return await options.tokenResponse(form, tokenForms.length - 1)
      }
      return json({
        access_token: `tok-${tokenForms.length}`,
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    const auth = new Headers(init?.headers).get('Authorization')
    protectedAuth.push(auth)
    if (options.protectedResponse != null) return options.protectedResponse(auth)
    if (auth?.startsWith('Bearer tok-')) return json({ ok: true })
    return new Response('unauth', {
      status: 401,
      headers: { 'WWW-Authenticate': options.challenge ?? 'Bearer' },
    })
  }
  return { next, tokenForms, metadataCalls, protectedAuth }
}

const ccKey = (params: { resource?: string; scopes?: Array<string> } = {}): string =>
  clientCredentialsStoreKey({
    issuer,
    resource: params.resource ?? resource,
    clientID,
    scopes: params.scopes,
  })

test('exports the middleware and signer helpers from the package root', () => {
  expect(createClientCredentialsMiddleware).toBe(direct)
  expect(typeof createWebCryptoAssertionSigner).toBe('function')
})

test('a cold 401 discovers, grants once with a pinned assertion and retries with the token', async () => {
  const w = world()
  const store = createMemoryTokenStore()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer, store, now: () => 1000 })
  const response = await mw(w.next)(resource, { method: 'POST', body: '{}' })

  expect(response.status).toBe(200)
  expect(w.tokenForms).toHaveLength(1)
  const form = w.tokenForms[0] as URLSearchParams
  expect(form.get('grant_type')).toBe('client_credentials')
  expect(form.get('client_id')).toBe(clientID)
  expect(form.get('resource')).toBe(resource)
  expect(form.get('client_assertion_type')).toBe(
    'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
  )
  const { header, claims } = decodeJWT(form.get('client_assertion') as string)
  expect(header.alg).toBe('EdDSA')
  expect(claims.aud).toBe(issuer)
  expect(claims.iss).toBe(clientID)
  expect(claims.sub).toBe(clientID)
  expect(claims.exp).toBe(1060)
  expect(w.protectedAuth).toEqual([null, 'Bearer tok-1'])
  expect(await store.get(ccKey())).toMatchObject({
    accessToken: 'tok-1',
    issuer,
    tokenEndpoint: `${issuer}/token`,
    expiresAt: 4600,
  })
})

test('honours assertionLifetimeSeconds', async () => {
  const w = world()
  const mw = createClientCredentialsMiddleware({
    clientID,
    issuer,
    signer,
    now: () => 1000,
    assertionLifetimeSeconds: 30,
  })
  await mw(w.next)(resource)
  const { claims } = decodeJWT(w.tokenForms[0]?.get('client_assertion') as string)
  expect(claims.exp).toBe(1030)
})

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects assertionLifetimeSeconds %s at construction',
  (assertionLifetimeSeconds) => {
    expect(() =>
      createClientCredentialsMiddleware({ clientID, issuer, signer, assertionLifetimeSeconds }),
    ).toThrow('Client credentials assertionLifetimeSeconds must be a positive integer')
  },
)

test('refuses when the pin is not in authorization_servers, without a token request', async () => {
  const w = world({ authorizationServers: ['https://other.example.com'] })
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
  await expect(mw(w.next)(resource)).rejects.toThrow(
    /expected issuer https:\/\/as\.example\.com not in authorization_servers: https:\/\/other\.example\.com/,
  )
  expect(w.tokenForms).toHaveLength(0)
})

test('accepts token-only AS metadata (no authorization_endpoint)', async () => {
  const w = world({ asMetadata: { issuer, token_endpoint: `${issuer}/token` } })
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
  const response = await mw(w.next)(resource)
  expect(response.status).toBe(200)
  expect(w.tokenForms).toHaveLength(1)
})

const compatibility = [
  {
    field: 'grant_types_supported',
    value: 'client_credentials',
    error: 'AS metadata does not list grant client_credentials',
  },
  {
    field: 'token_endpoint_auth_methods_supported',
    value: 'private_key_jwt',
    error: 'AS metadata does not list auth method private_key_jwt',
  },
  {
    field: 'token_endpoint_auth_signing_alg_values_supported',
    value: 'EdDSA',
    error: 'AS metadata does not list signing alg EdDSA',
  },
]

for (const { field, value, error } of compatibility) {
  test(`${field}: absent proceeds, listed proceeds`, async () => {
    for (const listed of [undefined, ['other', value]]) {
      const w = world({
        asMetadata: {
          issuer,
          token_endpoint: `${issuer}/token`,
          ...(listed == null ? {} : { [field]: listed }),
        },
      })
      const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
      expect((await mw(w.next)(resource)).status).toBe(200)
      expect(w.tokenForms).toHaveLength(1)
    }
  })

  test(`${field}: a string instead of an array is malformed`, async () => {
    const w = world({
      asMetadata: { issuer, token_endpoint: `${issuer}/token`, [field]: 'private_key_jwt' },
    })
    const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
    await expect(mw(w.next)(resource)).rejects.toThrow(`AS metadata field ${field} is malformed`)
    expect(w.tokenForms).toHaveLength(0)
  })

  test(`${field}: a non-string element is malformed`, async () => {
    const w = world({
      asMetadata: { issuer, token_endpoint: `${issuer}/token`, [field]: [value, 1] },
    })
    const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
    await expect(mw(w.next)(resource)).rejects.toThrow(`AS metadata field ${field} is malformed`)
    expect(w.tokenForms).toHaveLength(0)
  })

  test(`${field}: an array lacking the value fails with its own error`, async () => {
    const w = world({
      asMetadata: { issuer, token_endpoint: `${issuer}/token`, [field]: ['something-else'] },
    })
    const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
    await expect(mw(w.next)(resource)).rejects.toThrow(error)
    expect(w.tokenForms).toHaveLength(0)
  })
}

test('an explicit resource is sent verbatim and keys the store', async () => {
  const explicit = 'https://mcp.example.com/mcp/?tenant=a'
  const w = world({ prmResource: explicit })
  const store = createMemoryTokenStore()
  const mw = createClientCredentialsMiddleware({
    clientID,
    issuer,
    signer,
    store,
    resource: explicit,
  })
  const response = await mw(w.next)(resource)
  expect(response.status).toBe(200)
  expect(w.tokenForms[0]?.get('resource')).toBe(explicit)
  expect((await store.get(ccKey({ resource: explicit })))?.accessToken).toBe('tok-1')
  expect(await store.get(ccKey())).toBeUndefined()
})

test('rejects an invalid explicit resource at construction', () => {
  for (const bad of [
    'mcp/relative',
    'http://mcp.example.com/mcp',
    'https://mcp.example.com/mcp#frag',
    'https://mcp.example.com/mcp#',
    'ftp://mcp.example.com/mcp',
  ]) {
    expect(() =>
      createClientCredentialsMiddleware({ clientID, issuer, signer, resource: bad }),
    ).toThrow()
  }
  expect(() =>
    createClientCredentialsMiddleware({
      clientID,
      issuer,
      signer,
      resource: 'http://localhost:3000/mcp',
    }),
  ).not.toThrow()
})

test('near expiry re-grants at the stored token endpoint without metadata, with a new jti', async () => {
  const w = world({
    tokenResponse: (_form, index) =>
      json({ access_token: `tok-${index + 1}`, token_type: 'Bearer', expires_in: 30 }),
  })
  const mw = createClientCredentialsMiddleware({
    clientID,
    issuer,
    signer,
    clockSkewSeconds: 60,
    now: () => 1000,
  })
  await mw(w.next)(resource)
  expect(w.tokenForms).toHaveLength(1)
  const metadataAfterFirst = w.metadataCalls.length

  const response = await mw(w.next)(resource)
  expect(response.status).toBe(200)
  expect(w.tokenForms).toHaveLength(2)
  expect(w.metadataCalls).toHaveLength(metadataAfterFirst)
  expect(w.protectedAuth.at(-1)).toBe('Bearer tok-2')
  const jti = (form: URLSearchParams | undefined) =>
    decodeJWT(form?.get('client_assertion') as string).claims.jti
  expect(jti(w.tokenForms[1])).not.toBe(jti(w.tokenForms[0]))
})

test('a second 401 after a fresh grant is returned to the caller', async () => {
  const w = world({ protectedResponse: () => new Response('no', { status: 401 }) })
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
  const response = await mw(w.next)(resource)
  expect(response.status).toBe(401)
  expect(w.tokenForms).toHaveLength(1)
  expect(w.protectedAuth).toEqual([null, 'Bearer tok-1'])
})

test('a 403 passes through without a grant', async () => {
  const w = world({ protectedResponse: () => new Response('forbidden', { status: 403 }) })
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
  const response = await mw(w.next)(resource)
  expect(response.status).toBe(403)
  expect(await response.text()).toBe('forbidden')
  expect(w.tokenForms).toHaveLength(0)
})

test('without configured scopes, the challenge scopes are requested', async () => {
  const w = world({ challenge: 'Bearer scope="a b"' })
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
  await mw(w.next)(resource)
  expect(w.tokenForms[0]?.get('scope')).toBe('a b')
})

test('configured scopes win over challenge scopes', async () => {
  const w = world({ challenge: 'Bearer scope="y"' })
  const store = createMemoryTokenStore()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer, store, scopes: ['x'] })
  await mw(w.next)(resource)
  expect(w.tokenForms[0]?.get('scope')).toBe('x')
  expect((await store.get(ccKey({ scopes: ['x'] })))?.accessToken).toBe('tok-1')
})

test('no scope field when neither config nor challenge names scopes', async () => {
  const w = world()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
  await mw(w.next)(resource)
  expect(w.tokenForms[0]?.has('scope')).toBe(false)
})

test('5 concurrent cold requests make exactly one token request', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const w = world({
    tokenResponse: async () => {
      await gate
      return json({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 })
    },
  })
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
  const pending = Array.from({ length: 5 }, () => mw(w.next)(resource))
  await new Promise((resolve) => setTimeout(resolve, 10))
  release()
  const responses = await Promise.all(pending)
  expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
  expect(w.tokenForms).toHaveLength(1)
})

test('a PKCE middleware sharing the store never attaches the service token', async () => {
  const store = createMemoryTokenStore()
  const pkceKey = tokenStoreKey({ resource, clientID })
  const pkceRecord: StoredTokens = {
    accessToken: 'user-token',
    tokenType: 'Bearer',
    expiresAt: 9_999_999_999,
  }
  const handler: AuthorizationHandler = {
    async authorize() {
      throw new Error('no sign-in expected')
    },
  }

  // Service grant first: the PKCE record must stay as it was.
  await store.set(pkceKey, pkceRecord)
  const w = world()
  const cc = createClientCredentialsMiddleware({ clientID, issuer, signer, store })
  expect((await cc(w.next)(resource)).status).toBe(200)
  expect(await store.get(pkceKey)).toEqual(pkceRecord)
  expect((await store.get(ccKey()))?.accessToken).toBe('tok-1')

  const seen: Array<string | null> = []
  const pkceNext = async (_url: string, init?: RequestInit): Promise<Response> => {
    seen.push(new Headers(init?.headers).get('Authorization'))
    return json({ ok: true })
  }
  const pkce = createOAuthMiddleware({ clientID, resource, handler, store })
  await pkce(pkceNext)(resource)
  expect(seen).toEqual(['Bearer user-token'])

  // Without its own record, PKCE sends no token at all rather than the service one.
  await store.delete(pkceKey)
  await pkce(pkceNext)(resource)
  expect(seen).toEqual(['Bearer user-token', null])
  expect((await store.get(ccKey()))?.accessToken).toBe('tok-1')
})

test('a stored record from another issuer is never attached', async () => {
  const store = createMemoryTokenStore()
  await store.set(ccKey(), {
    accessToken: 'foreign',
    tokenType: 'Bearer',
    expiresAt: 9_999_999_999,
    issuer: 'https://evil.example.com',
    tokenEndpoint: 'https://evil.example.com/token',
  })
  const w = world()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer, store })
  const response = await mw(w.next)(resource)
  expect(response.status).toBe(200)
  expect(w.protectedAuth).toEqual([null, 'Bearer tok-1'])
})

test('without expires_in there is no pre-emptive grant and a 401 recovers', async () => {
  let accepted = 'tok-1'
  const w = world({
    tokenResponse: (_form, index) =>
      json({ access_token: `tok-${index + 1}`, token_type: 'Bearer' }),
    protectedResponse: (auth) =>
      auth === `Bearer ${accepted}` ? json({ ok: true }) : new Response('no', { status: 401 }),
  })
  const store = createMemoryTokenStore()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer, store, now: () => 1000 })
  await mw(w.next)(resource)
  expect((await store.get(ccKey()))?.expiresAt).toBeUndefined()

  await mw(w.next)(resource)
  expect(w.tokenForms).toHaveLength(1)

  accepted = 'tok-2'
  const response = await mw(w.next)(resource)
  expect(response.status).toBe(200)
  expect(w.tokenForms).toHaveLength(2)
  expect(w.protectedAuth.slice(-2)).toEqual(['Bearer tok-1', 'Bearer tok-2'])
})

test('a non-bearer token_type is rejected and nothing is stored', async () => {
  const w = world({
    tokenResponse: () => json({ access_token: 'dpop', token_type: 'DPoP', expires_in: 3600 }),
  })
  const store = createMemoryTokenStore()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer, store })
  await expect(mw(w.next)(resource)).rejects.toThrow('Unsupported token_type: DPoP')
  expect(await store.get(ccKey())).toBeUndefined()
})

test('a token endpoint error surfaces to the caller', async () => {
  const w = world({ tokenResponse: () => json({ error: 'invalid_client' }, 401) })
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
  await expect(mw(w.next)(resource)).rejects.toMatchObject({ code: 'invalid_client' })
})

test('an abort during the grant rejects with the reason, stores nothing, next request re-grants', async () => {
  const controller = new AbortController()
  const reason = new Error('caller gave up')
  const w = world({
    tokenResponse: (_form, index) => {
      if (index === 0) controller.abort(reason)
      return json({ access_token: `tok-${index + 1}`, token_type: 'Bearer', expires_in: 3600 })
    },
  })
  const store = createMemoryTokenStore()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer, store })
  await expect(mw(w.next)(resource, { signal: controller.signal })).rejects.toBe(reason)
  expect(await store.get(ccKey())).toBeUndefined()

  const response = await mw(w.next)(resource)
  expect(response.status).toBe(200)
  expect(w.tokenForms).toHaveLength(2)
  expect((await store.get(ccKey()))?.accessToken).toBe('tok-2')
})

test('refuses a plain-http, non-loopback transport URL', async () => {
  const w = world()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer })
  await expect(mw(w.next)('http://mcp.example.com/mcp')).rejects.toThrow(/https/)
})

test('an abort noticed during discovery rejects with the reason and stores nothing', async () => {
  const controller = new AbortController()
  const reason = new Error('caller gave up')
  const w = world({
    onPRM: () => {
      controller.abort(reason)
      // A fetch that notices the abort may fail with an error of its own.
      throw new TypeError('fetch failed')
    },
  })
  const store = createMemoryTokenStore()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer, store })
  await expect(mw(w.next)(resource, { signal: controller.signal })).rejects.toBe(reason)
  expect(w.tokenForms).toHaveLength(0)
  expect(await store.get(ccKey())).toBeUndefined()
})

test('a joined flight returning a record from another issuer is never attached', async () => {
  const store = createMemoryTokenStore()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  // Another participant on the same store and key, whose flight yields a foreign record.
  const foreign = withSingleFlight({
    store,
    key: ccKey(),
    staleAccessToken: undefined,
    run: async () => {
      await gate
      return {
        accessToken: 'foreign',
        tokenType: 'Bearer',
        issuer: 'https://evil.example.com',
        tokenEndpoint: 'https://evil.example.com/token',
      }
    },
  })
  const w = world()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer, store })
  const pending = mw(w.next)(resource)
  await new Promise((resolve) => setTimeout(resolve, 10))
  release()
  await foreign
  const response = await pending
  expect(response.status).toBe(200)
  expect(w.protectedAuth).toEqual([null, 'Bearer tok-1'])
  expect(w.tokenForms).toHaveLength(1)
  expect((await store.get(ccKey()))?.issuer).toBe(issuer)
})

test('an unsupported signer algorithm fails before any token request', async () => {
  const w = world()
  const badSigner = { ...signer, alg: 'RS256' } as unknown as ClientAssertionSigner
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer: badSigner })
  await expect(mw(w.next)(resource)).rejects.toThrow(
    'Unsupported client assertion algorithm: RS256',
  )
  expect(w.tokenForms).toHaveLength(0)
})

test('a joiner whose signal aborts stops waiting; the starter still completes and stores', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const w = world({
    tokenResponse: async () => {
      await gate
      return json({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 })
    },
  })
  const store = createMemoryTokenStore()
  const mw = createClientCredentialsMiddleware({ clientID, issuer, signer, store })
  const starter = mw(w.next)(resource)
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(w.tokenForms).toHaveLength(1)

  const controller = new AbortController()
  const reason = new Error('joiner gave up')
  const joiner = mw(w.next)(resource, { signal: controller.signal })
  await new Promise((resolve) => setTimeout(resolve, 10))
  controller.abort(reason)
  await expect(joiner).rejects.toBe(reason)

  release()
  const response = await starter
  expect(response.status).toBe(200)
  expect(w.tokenForms).toHaveLength(1)
  expect((await store.get(ccKey()))?.accessToken).toBe('tok-1')
})
