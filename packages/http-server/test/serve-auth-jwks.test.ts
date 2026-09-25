import { createServer, type Server as HTTPServer } from 'node:http'
import { toB64U } from '@sozai/codec'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createJWKSVerifier } from '../src/auth/jwks-verifier.js'
import {
  corruptSignature,
  expectBearerChallenge,
  expectToolsList,
  RESOURCE,
  requestToolsList,
  startGatedMCP,
} from './serve-auth-fixture.js'

type Algorithm = 'RS256' | 'ES256'
type SigningKey = { pair: CryptoKeyPair; kid: string; jwk: JsonWebKey & { kid: string } }

function b64uJSON(value: unknown): string {
  return toB64U(new TextEncoder().encode(JSON.stringify(value)))
}

async function generateSigningKey(alg: Algorithm): Promise<SigningKey> {
  const pair = await crypto.subtle.generateKey(
    alg === 'RS256'
      ? {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        }
      : { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const kid = `test-${alg.toLowerCase()}`
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid }
  return { pair, kid, jwk }
}

async function mintToken(
  alg: Algorithm,
  key: SigningKey,
  issuer: string,
  claims: Record<string, unknown> = {},
): Promise<string> {
  const header = { alg, typ: 'JWT', kid: key.kid }
  const payload = {
    iss: issuer,
    aud: RESOURCE,
    sub: 'user-1',
    exp: Math.floor(Date.now() / 1000) + 300,
    scope: 'read write',
    ...claims,
  }
  const signingInput = `${b64uJSON(header)}.${b64uJSON(payload)}`
  const signature = await crypto.subtle.sign(
    alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' },
    key.pair.privateKey,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${toB64U(new Uint8Array(signature))}`
}

describe('serveHTTP with JWKS verifier', () => {
  let authorizationServer: HTTPServer | undefined
  let mcpServer: Awaited<ReturnType<typeof startGatedMCP>> | undefined
  let baseURL: string
  let issuer: string
  let keys: Record<Algorithm, SigningKey>

  beforeAll(async () => {
    const [rsa, ec] = await Promise.all([generateSigningKey('RS256'), generateSigningKey('ES256')])
    keys = { RS256: rsa, ES256: ec }

    authorizationServer = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/.well-known/oauth-authorization-server') {
        response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }))
      } else if (request.url === '/jwks') {
        response.end(JSON.stringify({ keys: [rsa.jwk, ec.jwk] }))
      } else {
        response.writeHead(404).end()
      }
    })
    const fakeAS = authorizationServer
    const port = await new Promise<number>((resolve, reject) => {
      fakeAS.once('error', reject)
      fakeAS.listen(0, '127.0.0.1', () => {
        fakeAS.off('error', reject)
        const address = fakeAS.address()
        resolve((address as { port: number }).port)
      })
    })
    issuer = `http://127.0.0.1:${port}`
    mcpServer = await startGatedMCP(createJWKSVerifier({ issuer, fetchTimeoutMs: 2_000 }), issuer)
    baseURL = mcpServer.baseURL
  }, 10_000)

  afterAll(async () => {
    await mcpServer?.server.dispose()
    if (authorizationServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        authorizationServer?.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })

  for (const alg of ['RS256', 'ES256'] as const) {
    test(`${alg} accepts a signed token and dispatches tools/list`, async () => {
      const token = await mintToken(alg, keys[alg], issuer)
      await expectToolsList(await requestToolsList(baseURL, token))
    })

    test(`${alg} rejects a wrong audience with 401`, async () => {
      const token = await mintToken(alg, keys[alg], issuer, { aud: 'https://other.example/mcp' })
      expectBearerChallenge(await requestToolsList(baseURL, token), 401, 'invalid_token')
    })

    test(`${alg} rejects an expired token with 401`, async () => {
      const token = await mintToken(alg, keys[alg], issuer, {
        exp: Math.floor(Date.now() / 1000) - 120,
      })
      expectBearerChallenge(await requestToolsList(baseURL, token), 401, 'invalid_token')
    })

    test(`${alg} rejects a bad signature with 401`, async () => {
      const token = await mintToken(alg, keys[alg], issuer)
      const corrupted = corruptSignature(token)
      expectBearerChallenge(await requestToolsList(baseURL, corrupted), 401, 'invalid_token')
    })

    test(`${alg} rejects insufficient scope with 403`, async () => {
      const token = await mintToken(alg, keys[alg], issuer, { scope: 'read' })
      const response = await requestToolsList(baseURL, token)
      expectBearerChallenge(response, 403, 'insufficient_scope')
      expect(response.headers.get('WWW-Authenticate')).toContain('scope="read write"')
    })
  }

  test('rejects a missing bearer token with 401', async () => {
    expectBearerChallenge(await requestToolsList(baseURL), 401)
  })

  test('answers 500, not 401, when the JWKS cannot be fetched', async () => {
    const outage = await startGatedMCP(
      createJWKSVerifier({ issuer, jwksURI: `${issuer}/missing`, fetchTimeoutMs: 2_000 }),
      issuer,
    )
    try {
      const token = await mintToken('ES256', keys.ES256, issuer)
      const response = await requestToolsList(outage.baseURL, token)
      expect(response.status).toBe(500)
      expect(response.headers.get('WWW-Authenticate')).toBeNull()
    } finally {
      await outage.server.dispose()
    }
  })

  test('serves protected-resource metadata without a token', async () => {
    const response = await fetch(`${baseURL}/.well-known/oauth-protected-resource/mcp`, {
      signal: AbortSignal.timeout(3_000),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(await response.json()).toEqual({ resource: RESOURCE, authorization_servers: [issuer] })
  })
})
