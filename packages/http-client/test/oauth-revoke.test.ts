import { describe, expect, test } from 'vitest'

import { revokeTokens } from '../src/oauth/revoke.js'
import type { StoredTokens } from '../src/oauth/store.js'

const AS = 'https://as.example.com'
const RESOURCE = 'https://mcp.example.com/mcp'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const TOKENS: StoredTokens = {
  accessToken: 'access-1',
  tokenType: 'Bearer',
  refreshToken: 'refresh-1',
  issuer: AS,
  tokenEndpoint: `${AS}/token`,
}

function fakeAS(
  options: {
    revocationEndpoint?: string | null
    revoke?: (body: URLSearchParams) => Response
  } = {},
) {
  const posts: Array<URLSearchParams> = []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === `${AS}/.well-known/oauth-authorization-server`) {
      return json({
        issuer: AS,
        authorization_endpoint: `${AS}/authorize`,
        token_endpoint: `${AS}/token`,
        ...(options.revocationEndpoint === null
          ? {}
          : { revocation_endpoint: options.revocationEndpoint ?? `${AS}/revoke` }),
      })
    }
    if (url === `${AS}/revoke`) {
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      const body = new URLSearchParams(String(init?.body))
      posts.push(body)
      return options.revoke?.(body) ?? new Response(null, { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  return { fetch, posts }
}

describe('revokeTokens (RFC 7009)', () => {
  test('revokes the refresh token, then the access token, as a public client', async () => {
    const { fetch, posts } = fakeAS()
    const result = await revokeTokens({
      tokens: TOKENS,
      clientID: 'cli',
      resource: RESOURCE,
      fetch,
    })
    expect(result).toEqual({
      status: 'revoked',
      endpoint: `${AS}/revoke`,
      revoked: ['refresh_token', 'access_token'],
    })
    expect(posts.map((body) => Object.fromEntries(body))).toEqual([
      { token: 'refresh-1', token_type_hint: 'refresh_token', client_id: 'cli' },
      { token: 'access-1', token_type_hint: 'access_token', client_id: 'cli' },
    ])
  })

  test('revokes only the access token when there is no refresh token', async () => {
    const { fetch, posts } = fakeAS()
    const { refreshToken: _, ...accessOnly } = TOKENS
    const result = await revokeTokens({
      tokens: accessOnly,
      clientID: 'cli',
      resource: RESOURCE,
      fetch,
    })
    expect(result).toMatchObject({ status: 'revoked', revoked: ['access_token'] })
    expect(posts).toHaveLength(1)
  })

  test('skips a token kind the server cannot revoke', async () => {
    const { fetch } = fakeAS({
      revoke: (body) =>
        body.get('token_type_hint') === 'access_token'
          ? json({ error: 'unsupported_token_type' }, 400)
          : new Response(null, { status: 200 }),
    })
    const result = await revokeTokens({
      tokens: TOKENS,
      clientID: 'cli',
      resource: RESOURCE,
      fetch,
    })
    expect(result).toMatchObject({ status: 'revoked', revoked: ['refresh_token'] })
  })

  test('throws when the endpoint refuses', async () => {
    const { fetch } = fakeAS({ revoke: () => json({ error: 'invalid_client' }, 401) })
    await expect(
      revokeTokens({ tokens: TOKENS, clientID: 'cli', resource: RESOURCE, fetch }),
    ).rejects.toThrow()
  })

  test('reports unsupported without an issuer or a revocation endpoint', async () => {
    const { issuer: _, ...noIssuer } = TOKENS
    const fetch = async (): Promise<Response> => {
      throw new Error('must not fetch')
    }
    expect(
      await revokeTokens({ tokens: noIssuer, clientID: 'cli', resource: RESOURCE, fetch }),
    ).toEqual({
      status: 'unsupported',
      reason: 'the stored tokens record no authorisation server',
    })
    const { fetch: noEndpoint } = fakeAS({ revocationEndpoint: null })
    expect(
      await revokeTokens({
        tokens: TOKENS,
        clientID: 'cli',
        resource: RESOURCE,
        fetch: noEndpoint,
      }),
    ).toEqual({ status: 'unsupported', reason: `${AS} does not advertise a revocation_endpoint` })
  })

  test('refuses a cleartext revocation endpoint for a non-loopback resource', async () => {
    const { fetch } = fakeAS({ revocationEndpoint: 'http://as.example.com/revoke' })
    await expect(
      revokeTokens({ tokens: TOKENS, clientID: 'cli', resource: RESOURCE, fetch }),
    ).rejects.toThrow(/https/)
  })
})
