import { toB64U } from '@sozai/codec'
import { expect, test } from 'vitest'

import { createJWKSVerifier } from '../src/auth/jwks-verifier.js'

const issuer = 'https://as.example.com'
const resource = 'https://mcp.example.com/mcp'

function b64uJson(obj: unknown): string {
  return toB64U(new TextEncoder().encode(JSON.stringify(obj)))
}

async function makeToken(overrides?: {
  header?: Record<string, unknown>
  payload?: Record<string, unknown>
}): Promise<{ token: string; jwk: JsonWebKey & { kid?: string } }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const jwk: JsonWebKey & { kid?: string } = await crypto.subtle.exportKey('jwk', pair.publicKey)
  jwk.kid = 'test-key'
  const header = { alg: 'ES256', typ: 'JWT', kid: 'test-key', ...overrides?.header }
  const payload = {
    iss: issuer,
    aud: resource,
    sub: 'user-1',
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: 'read',
    ...overrides?.payload,
  }
  const signingInput = `${b64uJson(header)}.${b64uJson(payload)}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new TextEncoder().encode(signingInput),
  )
  return { token: `${signingInput}.${toB64U(new Uint8Array(sig))}`, jwk }
}

async function makeRS256Token(): Promise<{ token: string; jwk: JsonWebKey & { kid?: string } }> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const jwk: JsonWebKey & { kid?: string } = await crypto.subtle.exportKey('jwk', pair.publicKey)
  jwk.kid = 'test-rsa-key'
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-rsa-key' }
  const payload = {
    iss: issuer,
    aud: resource,
    sub: 'user-2',
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: 'read write',
  }
  const signingInput = `${b64uJson(header)}.${b64uJson(payload)}`
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    pair.privateKey,
    new TextEncoder().encode(signingInput),
  )
  return { token: `${signingInput}.${toB64U(new Uint8Array(sig))}`, jwk }
}

test('verifies an RS256 JWT against a JWKS', async () => {
  const { token, jwk } = await makeRS256Token()
  const fetchJwks = async (): Promise<Response> =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  const info = await verifier.verifyAccessToken(token, { resource })
  expect(info.subject).toBe('user-2')
  expect(info.scopes).toEqual(['read', 'write'])
})

test('verifies an ES256 JWT against a JWKS', async () => {
  const { token, jwk } = await makeToken()
  const fetchJwks = async (): Promise<Response> =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  const info = await verifier.verifyAccessToken(token, { resource })
  expect(info.subject).toBe('user-1')
  expect(info.scopes).toEqual(['read'])
})

test('rejects a token for the wrong resource', async () => {
  const { token, jwk } = await makeToken()
  const fetchJwks = async (): Promise<Response> =>
    new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  await expect(
    verifier.verifyAccessToken(token, { resource: 'https://other.test' }),
  ).rejects.toThrow(/audience/i)
})

test('rejects a disallowed algorithm (alg-confusion defense)', async () => {
  const { token, jwk } = await makeToken()
  // Tamper the header to claim an unsupported alg (e.g. 'none') while keeping the rest intact.
  const parts = token.split('.')
  const forgedHeader = toB64U(
    new TextEncoder().encode(JSON.stringify({ alg: 'none', typ: 'JWT', kid: 'test-key' })),
  )
  const forgedToken = `${forgedHeader}.${parts[1]}.${parts[2]}`
  const fetchJwks = async (): Promise<Response> =>
    new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  await expect(verifier.verifyAccessToken(forgedToken, { resource })).rejects.toThrow()
})

test('rejects an HS256 algorithm claim (alg-confusion defense)', async () => {
  const { token, jwk } = await makeToken()
  const parts = token.split('.')
  const forgedHeader = toB64U(
    new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'test-key' })),
  )
  const forgedToken = `${forgedHeader}.${parts[1]}.${parts[2]}`
  const fetchJwks = async (): Promise<Response> =>
    new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  await expect(verifier.verifyAccessToken(forgedToken, { resource })).rejects.toThrow()
})

test('rejects a token with no exp claim', async () => {
  const { token, jwk } = await makeToken({ payload: { exp: undefined } })
  const fetchJwks = async (): Promise<Response> =>
    new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  await expect(verifier.verifyAccessToken(token, { resource })).rejects.toThrow(/exp/i)
})

test('rejects a token with a wrong signature', async () => {
  const { token, jwk } = await makeToken()
  const parts = token.split('.')
  // Corrupt the signature bytes (flip a character in the base64url string).
  const sig = parts[2]
  const corrupted = sig.slice(0, -4) + (sig.at(-4) === 'A' ? 'B' : 'A') + sig.slice(-3)
  const forgedToken = `${parts[0]}.${parts[1]}.${corrupted}`
  const fetchJwks = async (): Promise<Response> =>
    new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  await expect(verifier.verifyAccessToken(forgedToken, { resource })).rejects.toThrow()
})

test('a bad signature on a known kid does not force a JWKS refetch (amplification guard)', async () => {
  const { token, jwk } = await makeToken()
  const parts = token.split('.')
  const sig = parts[2]
  const corrupted = sig.slice(0, -4) + (sig.at(-4) === 'A' ? 'B' : 'A') + sig.slice(-3)
  const forgedToken = `${parts[0]}.${parts[1]}.${corrupted}`
  let fetchCalls = 0
  const fetchJwks = async (): Promise<Response> => {
    fetchCalls += 1
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  }
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  await expect(verifier.verifyAccessToken(forgedToken, { resource })).rejects.toThrow()
  // The `kid` matched a cached key; a bad signature against it must not trigger a forced
  // refetch — otherwise an attacker sending garbage signed with a valid kid could force one
  // unauthenticated JWKS fetch per request.
  expect(fetchCalls).toBe(1)
})

test('an alg mismatch on a known kid does not force a JWKS refetch (amplification guard)', async () => {
  // The token's header claims RS256 (an allowlisted alg) while its `kid` resolves to the
  // cached EC (ES256) key. The `kid` is found, so this is a bad token, not a rotation — it
  // must be rejected with no forced refetch. Otherwise anyone knowing a published `kid`
  // could amplify unauthenticated JWKS fetches by flipping the header `alg`.
  const { token, jwk } = await makeToken({ header: { alg: 'RS256' } })
  let fetchCalls = 0
  const fetchJwks = async (): Promise<Response> => {
    fetchCalls += 1
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  }
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  await expect(verifier.verifyAccessToken(token, { resource })).rejects.toThrow()
  expect(fetchCalls).toBe(1)
})

test('a JWK carrying alg RS256 is rejected against an ES256 JWT header (matching kid), with no extra fetch', async () => {
  const { token, jwk } = await makeToken()
  const jwkWithAlg = { ...jwk, alg: 'RS256' }
  let fetchCalls = 0
  const fetchJwks = async (): Promise<Response> => {
    fetchCalls += 1
    return new Response(JSON.stringify({ keys: [jwkWithAlg] }), { status: 200 })
  }
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  await expect(verifier.verifyAccessToken(token, { resource })).rejects.toThrow()
  expect(fetchCalls).toBe(1)
})

test('discovery rejects AS metadata whose issuer differs from config.issuer', async () => {
  const fetchFn = async (url: string): Promise<Response> => {
    if (url === `${issuer}/.well-known/oauth-authorization-server`) {
      return new Response(
        JSON.stringify({ issuer: 'https://attacker.example', jwks_uri: `${issuer}/jwks` }),
        { status: 200 },
      )
    }
    throw new Error(`unexpected ${url}`)
  }
  const verifier = createJWKSVerifier({ issuer, fetch: fetchFn as never })
  const { token } = await makeToken()
  await expect(verifier.verifyAccessToken(token, { resource })).rejects.toThrow(/issuer/i)
})

test('discovery rejects a non-loopback http jwks_uri returned by AS metadata', async () => {
  const fetchFn = async (url: string): Promise<Response> => {
    if (url === `${issuer}/.well-known/oauth-authorization-server`) {
      return new Response(JSON.stringify({ issuer, jwks_uri: 'http://as.example.com/jwks' }), {
        status: 200,
      })
    }
    throw new Error(`unexpected fetch of ${url}`)
  }
  const verifier = createJWKSVerifier({ issuer, fetch: fetchFn as never })
  const { token } = await makeToken()
  await expect(verifier.verifyAccessToken(token, { resource })).rejects.toThrow(/https/i)
})

test('RFC 8414 discovery inserts the well-known segment before a path-bearing issuer', async () => {
  const pathIssuer = 'https://as.example.com/tenant1'
  const metadataUrl = 'https://as.example.com/.well-known/oauth-authorization-server/tenant1'
  let fetchedMetadataUrl: string | undefined
  const fetchFn = async (url: string): Promise<Response> => {
    if (url === metadataUrl) {
      fetchedMetadataUrl = url
      return new Response(JSON.stringify({ issuer: pathIssuer, jwks_uri: `${pathIssuer}/jwks` }), {
        status: 200,
      })
    }
    return new Response(JSON.stringify({ keys: [] }), { status: 200 })
  }
  const verifier = createJWKSVerifier({ issuer: pathIssuer, fetch: fetchFn as never })
  const { token } = await makeToken({ payload: { iss: pathIssuer } })
  // Verification itself fails (empty JWKS) — only the discovery URL is asserted below.
  await verifier.verifyAccessToken(token, { resource }).catch(() => {})
  expect(fetchedMetadataUrl).toBe(metadataUrl)
})

test('H4: two different unknown kids within the cooldown window force at most one extra JWKS refresh', async () => {
  const { token: knownToken, jwk } = await makeToken()
  let fetchCalls = 0
  const fetchJwks = async (): Promise<Response> => {
    fetchCalls += 1
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  }
  const nowValue = Math.floor(Date.now() / 1000)
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
    now: () => nowValue,
    minRefreshIntervalSeconds: 30,
  })

  // Warm the cache with a successful verify first.
  await verifier.verifyAccessToken(knownToken, { resource })
  expect(fetchCalls).toBe(1)

  const { token: unknown1 } = await makeToken({ header: { kid: 'unknown-kid-1' } })
  await expect(verifier.verifyAccessToken(unknown1, { resource })).rejects.toThrow()
  const { token: unknown2 } = await makeToken({ header: { kid: 'unknown-kid-2' } })
  await expect(verifier.verifyAccessToken(unknown2, { resource })).rejects.toThrow()

  // At most one extra fetch across both unknown-kid attempts within the cooldown window.
  expect(fetchCalls).toBeLessThanOrEqual(2)
})

test('H5: the JWKS metadata and keys fetches are made with redirect: "error" (SSRF/redirect guard)', async () => {
  const { token, jwk } = await makeToken()
  const redirects: Array<string | undefined> = []
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    redirects.push(init?.redirect)
    if (url === `${issuer}/.well-known/oauth-authorization-server`) {
      return new Response(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }), { status: 200 })
    }
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  }
  const verifier = createJWKSVerifier({ issuer, fetch: fetchFn as never })
  await verifier.verifyAccessToken(token, { resource })
  expect(redirects.length).toBeGreaterThan(0)
  for (const redirect of redirects) {
    expect(redirect).toBe('error')
  }
})

test('an unknown kid still forces exactly one JWKS refresh and retry', async () => {
  // The token's `kid` never appears in the JWKS at all, so verification still fails overall —
  // what this test pins down is the *fetch count*: the first (cache-populating) fetch, plus
  // exactly one forced refresh for the not-found kid, and no more.
  const { token, jwk } = await makeToken({ header: { kid: 'nonexistent-kid' } })
  let fetchCalls = 0
  const fetchJwks = async (): Promise<Response> => {
    fetchCalls += 1
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  }
  const verifier = createJWKSVerifier({
    issuer,
    jwksUri: `${issuer}/jwks`,
    fetch: fetchJwks as never,
  })
  await expect(verifier.verifyAccessToken(token, { resource })).rejects.toThrow()
  expect(fetchCalls).toBe(2)
})
