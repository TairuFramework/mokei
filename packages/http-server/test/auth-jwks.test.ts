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
