import { ContextServer, type RequestAuth } from '@mokei/context-server'
import type { OAuthTokenVerifier } from '@teikyo/oauth'
import { TokenVerificationError } from '@teikyo/oauth'
import { afterEach, describe, expect, test } from 'vitest'

import { serveHTTP } from '../src/serve.js'

const TOKENS: Record<string, { subject: string; scopes: Array<string> }> = {
  'alice-read': { subject: 'alice', scopes: ['read'] },
  'alice-write': { subject: 'alice', scopes: ['read', 'write'] },
  bob: { subject: 'bob', scopes: ['read'] },
}

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    const entry = TOKENS[token]
    if (entry == null) {
      throw new TokenVerificationError({ code: 'invalid_token', message: 'unknown token' })
    }
    return {
      issuer: 'https://as.example',
      ...entry,
      expiresAt: 4_000_000_000,
      raw: { sub: entry.subject, token },
    }
  },
}

let server: Awaited<ReturnType<typeof serveHTTP>> | undefined

afterEach(async () => {
  await server?.dispose()
  server = undefined
})

async function start(forwardResolveAuth: boolean) {
  const seen: Array<RequestAuth | undefined> = []
  server = await serveHTTP({
    createServer: ({ transport, auth, resolveAuth }) =>
      new ContextServer({
        name: 'session-auth',
        version: '1.0.0',
        protocolVersions: ['2025-11-25'],
        transport,
        auth,
        resolveAuth: forwardResolveAuth ? resolveAuth : undefined,
        tools: {
          whoami: {
            description: 'Records request.auth',
            inputSchema: { type: 'object' },
            handler: async (request) => {
              seen.push(request.auth)
              return { content: [] }
            },
          },
        },
      }),
    port: 0,
    hostname: '127.0.0.1',
    auth: {
      verifier,
      resource: 'http://127.0.0.1/mcp',
      authorizationServers: ['https://as.example'],
    },
  })
  return { url: `${server.server.url}/mcp`, seen }
}

function headers(token: string, sessionID?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(sessionID == null
      ? {}
      : { 'Mcp-Session-Id': sessionID, 'MCP-Protocol-Version': '2025-11-25' }),
  }
}

async function initialize(url: string, token: string): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    }),
  })
  expect(response.status).toBe(200)
  await response.body?.cancel()
  const sessionID = response.headers.get('Mcp-Session-Id')
  expect(sessionID).toBeTruthy()
  const initialized = await fetch(url, {
    method: 'POST',
    headers: headers(token, sessionID as string),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })
  expect(initialized.status).toBe(202)
  return sessionID as string
}

function callTool(url: string, token: string, sessionID: string, id: number): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: headers(token, sessionID),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} },
    }),
  })
}

async function readResult(response: Response): Promise<Record<string, unknown>> {
  expect(response.status).toBe(200)
  const data = (await response.text())
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line.slice(6).trim() !== '')
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
  const message = data.find((event) => 'result' in event || 'error' in event)
  expect(message?.error).toBeUndefined()
  return message as Record<string, unknown>
}

describe('2025-11-25 session auth', () => {
  test('handlers see each request’s own auth, claims included', async () => {
    const { url, seen } = await start(true)
    const sessionID = await initialize(url, 'alice-read')

    await readResult(await callTool(url, 'alice-read', sessionID, 1))
    await readResult(await callTool(url, 'alice-write', sessionID, 2))

    expect(seen).toEqual([
      {
        issuer: 'https://as.example',
        subject: 'alice',
        scopes: ['read'],
        expiresAt: 4_000_000_000,
        claims: { sub: 'alice', token: 'alice-read' },
      },
      {
        issuer: 'https://as.example',
        subject: 'alice',
        scopes: ['read', 'write'],
        expiresAt: 4_000_000_000,
        claims: { sub: 'alice', token: 'alice-write' },
      },
    ])
  })

  test('a server given only auth sees the initialize-time snapshot', async () => {
    const { url, seen } = await start(false)
    const sessionID = await initialize(url, 'alice-read')
    await readResult(await callTool(url, 'alice-write', sessionID, 1))
    expect(seen[0]?.scopes).toEqual(['read'])
  })

  test('another subject cannot use, stream or delete the session', async () => {
    const { url, seen } = await start(true)
    const sessionID = await initialize(url, 'alice-read')

    const post = await callTool(url, 'bob', sessionID, 1)
    expect(post.status).toBe(404)
    await post.body?.cancel()

    const get = await fetch(url, { method: 'GET', headers: headers('bob', sessionID) })
    expect(get.status).toBe(404)
    await get.body?.cancel()

    const notification = await fetch(url, {
      method: 'POST',
      headers: headers('bob', sessionID),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
    expect(notification.status).toBe(404)

    const del = await fetch(url, { method: 'DELETE', headers: headers('bob', sessionID) })
    expect(del.status).toBe(404)

    // The owner still has a working session.
    await readResult(await callTool(url, 'alice-write', sessionID, 2))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.subject).toBe('alice')

    const ownerDelete = await fetch(url, {
      method: 'DELETE',
      headers: headers('alice-read', sessionID),
    })
    expect(ownerDelete.status).toBe(204)
  })

  test('the refusal is indistinguishable from an unknown session', async () => {
    const { url } = await start(true)
    const sessionID = await initialize(url, 'alice-read')
    const foreign = await callTool(url, 'bob', sessionID, 1)
    const unknown = await callTool(url, 'bob', crypto.randomUUID(), 1)
    expect(foreign.status).toBe(unknown.status)
    expect(await foreign.text()).toBe(await unknown.text())
  })
})
