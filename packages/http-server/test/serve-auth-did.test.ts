import { randomIdentity, stringifyToken } from '@kokuin/token'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createDIDVerifier } from '../src/auth/did-verifier.js'
import {
  corruptSignature,
  expectBearerChallenge,
  expectToolsList,
  RESOURCE,
  requestToolsList,
  startGatedMCP,
} from './serve-auth-fixture.js'

const AUTHORIZATION_SERVER = 'https://did.example.test'

describe('serveHTTP with DID verifier', () => {
  let mcpServer: Awaited<ReturnType<typeof startGatedMCP>> | undefined
  let baseURL: string
  const identity = randomIdentity()

  async function mintToken(claims: Record<string, unknown> = {}): Promise<string> {
    const signed = await identity.signToken({
      aud: RESOURCE,
      scope: 'read write',
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    })
    return stringifyToken(signed)
  }

  beforeAll(async () => {
    mcpServer = await startGatedMCP(createDIDVerifier(), AUTHORIZATION_SERVER)
    baseURL = mcpServer.baseURL
  })

  afterAll(async () => {
    await mcpServer?.server.dispose()
  })

  test('accepts a signed DID token and dispatches tools/list', async () => {
    await expectToolsList(await requestToolsList(baseURL, await mintToken()))
  })

  test('rejects a tampered token with 401', async () => {
    const token = await mintToken()
    const corrupted = corruptSignature(token)
    expectBearerChallenge(await requestToolsList(baseURL, corrupted), 401, 'invalid_token')
  })

  test('rejects an expired token with 401', async () => {
    const token = await mintToken({ exp: Math.floor(Date.now() / 1000) - 120 })
    expectBearerChallenge(await requestToolsList(baseURL, token), 401, 'invalid_token')
  })

  test('rejects a wrong audience with 401', async () => {
    const token = await mintToken({ aud: 'https://other.example/mcp' })
    expectBearerChallenge(await requestToolsList(baseURL, token), 401, 'invalid_token')
  })

  test('rejects insufficient scope with 403', async () => {
    const response = await requestToolsList(baseURL, await mintToken({ scope: 'read' }))
    expectBearerChallenge(response, 403, 'insufficient_scope')
    expect(response.headers.get('WWW-Authenticate')).toContain('scope="read write"')
  })

  test('rejects a missing bearer token with 401', async () => {
    expectBearerChallenge(await requestToolsList(baseURL), 401)
  })

  test('serves protected-resource metadata without a token', async () => {
    const response = await fetch(`${baseURL}/.well-known/oauth-protected-resource/mcp`, {
      signal: AbortSignal.timeout(3_000),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(await response.json()).toEqual({
      resource: RESOURCE,
      authorization_servers: [AUTHORIZATION_SERVER],
    })
  })
})
