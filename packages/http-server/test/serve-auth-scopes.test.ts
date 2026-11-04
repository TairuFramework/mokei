import { ContextServer, createPrompt, createTool } from '@mokei/context-server'
import type { OAuthTokenVerifier } from '@teikyo/oauth'
import { TokenVerificationError } from '@teikyo/oauth'
import { afterEach, describe, expect, test } from 'vitest'

import { serveHTTP } from '../src/serve.js'
import { mcpHeaders, statelessHeaders } from './mcp-headers.js'

const RESOURCE = 'http://127.0.0.1/mcp'
const RESOURCE_METADATA_URL = 'http://127.0.0.1/.well-known/oauth-protected-resource/mcp'

const TOKENS: Record<string, Array<string>> = {
  reader: ['read'],
  admin: ['read', 'admin'],
}

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    const scopes = TOKENS[token]
    if (scopes == null) {
      throw new TokenVerificationError({ code: 'invalid_token', message: 'unknown token' })
    }
    return { issuer: 'https://as.example', subject: 'alice', scopes }
  },
}

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'scopes-test', version: '1.0.0' },
}

let server: Awaited<ReturnType<typeof serveHTTP>> | undefined

afterEach(async () => {
  await server?.dispose()
  server = undefined
})

async function start() {
  const calls: Array<string> = []
  server = await serveHTTP({
    createServer: ({ transport, auth, resolveAuth }) =>
      new ContextServer({
        name: 'scopes',
        version: '1.0.0',
        protocolVersions: ['2025-11-25', '2026-07-28'],
        transport,
        auth,
        resolveAuth,
        tools: {
          echo: createTool({
            description: 'Echo',
            inputSchema: { type: 'object' } as const,
            handler: () => {
              calls.push('echo')
              return { content: [] }
            },
          }),
          purge: createTool({
            description: 'Needs admin',
            inputSchema: { type: 'object' } as const,
            scopes: ['admin'],
            handler: () => {
              calls.push('purge')
              return { content: [{ type: 'text', text: 'purged' }] }
            },
          }),
        },
        prompts: {
          audit: createPrompt({
            description: 'Needs admin',
            scopes: ['admin'],
            handler: () => {
              calls.push('audit')
              return { messages: [] }
            },
          }),
        },
        resources: {
          scopes: (uri) => (uri.startsWith('admin://') ? ['admin'] : []),
          read: ({ params }) => {
            calls.push(params.uri)
            return { contents: [{ uri: params.uri, text: 'x' }] }
          },
        },
      }),
    port: 0,
    hostname: '127.0.0.1',
    auth: {
      verifier,
      resource: RESOURCE,
      authorizationServers: ['https://as.example'],
      requiredScopes: ['read'],
    },
  })
  return { url: `${server.server.url}/mcp`, calls }
}

function statelessCall(
  url: string,
  token: string,
  name: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
      ...mcpHeaders('tools/call', { name }),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name, arguments: {}, _meta: META },
    }),
  })
}

function statelessRequest(
  url: string,
  token: string,
  method: string,
  params: Record<string, unknown>,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...statelessHeaders(method, params),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params: { ...params, _meta: META } }),
  })
}

async function expectInsufficientScope(response: Response): Promise<void> {
  expect(response.status).toBe(403)
  const challenge = response.headers.get('WWW-Authenticate') ?? ''
  expect(challenge).toMatch(/^Bearer /)
  expect(challenge).toContain('error="insufficient_scope"')
  expect(challenge).toContain('scope="read admin"')
  expect(challenge).toContain(`resource_metadata="${RESOURCE_METADATA_URL}"`)
  expect(response.headers.get('Content-Type')).toContain('application/json')
  const body = (await response.json()) as {
    id: unknown
    error: { code: number; data: unknown }
  }
  expect(body.id).toBe(7)
  expect(body.error.code).toBe(-32600)
  expect(body.error.data).toEqual({ error: 'insufficient_scope', scopes: ['read', 'admin'] })
}

function sseMessages(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line.slice(6).trim() !== '')
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
}

describe('per-tool scopes over HTTP (2026-07-28)', () => {
  test('answers 403 insufficient_scope before the tool runs', async () => {
    const { url, calls } = await start()
    await expectInsufficientScope(await statelessCall(url, 'reader', 'purge'))
    expect(calls).toEqual([])
  })

  test('runs the tool for a token holding its scopes', async () => {
    const { url, calls } = await start()
    const response = await statelessCall(url, 'admin', 'purge')
    expect(response.status).toBe(200)
    const [message] = sseMessages(await response.text())
    expect(message?.error).toBeUndefined()
    expect(calls).toEqual(['purge'])
  })

  test('leaves tools without scopes alone', async () => {
    const { url, calls } = await start()
    const response = await statelessCall(url, 'reader', 'echo')
    expect(response.status).toBe(200)
    await response.text()
    expect(calls).toEqual(['echo'])
  })

  test('an Mcp-Name naming a different tool is rejected 400 before any scope check', async () => {
    const { url, calls } = await start()
    const response = await statelessCall(url, 'reader', 'purge', {
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'echo',
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: number; data: unknown } }
    expect(body.error.code).toBe(-32020)
    expect(body.error.data).toEqual({
      mismatch: { header: 'Mcp-Name', body: expect.stringContaining('"echo"') },
    })
    expect(calls).toEqual([])
  })
})

describe('prompt and resource scopes over HTTP (2026-07-28)', () => {
  test('prompts/get answers 403 without the prompt scope', async () => {
    const { url, calls } = await start()
    const response = await statelessRequest(url, 'reader', 'prompts/get', { name: 'audit' })
    await expectInsufficientScope(response)
    expect(response.headers.get('WWW-Authenticate')).toContain('prompts/get audit requires')
    expect(calls).toEqual([])
    const allowed = await statelessRequest(url, 'admin', 'prompts/get', { name: 'audit' })
    expect(allowed.status).toBe(200)
    await allowed.text()
    expect(calls).toEqual(['audit'])
  })

  test('resources/read answers 403 only for the URIs that need a scope', async () => {
    const { url, calls } = await start()
    await expectInsufficientScope(
      await statelessRequest(url, 'reader', 'resources/read', { uri: 'admin://keys' }),
    )
    const open = await statelessRequest(url, 'reader', 'resources/read', { uri: 'doc://readme' })
    expect(open.status).toBe(200)
    await open.text()
    expect(calls).toEqual(['doc://readme'])
  })
})

describe('per-tool scopes over HTTP (2025-11-25)', () => {
  function sessionHeaders(token: string, sessionID?: string): Record<string, string> {
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
      headers: sessionHeaders(token),
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
    const sessionID = response.headers.get('Mcp-Session-Id') as string
    const initialized = await fetch(url, {
      method: 'POST',
      headers: sessionHeaders(token, sessionID),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
    expect(initialized.status).toBe(202)
    return sessionID
  }

  function sessionCall(url: string, token: string, sessionID: string, name: string) {
    return fetch(url, {
      method: 'POST',
      headers: sessionHeaders(token, sessionID),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name, arguments: {} },
      }),
    })
  }

  test('answers 403 on the session path without any Mcp-Method header', async () => {
    const { url, calls } = await start()
    const sessionID = await initialize(url, 'reader')
    await expectInsufficientScope(await sessionCall(url, 'reader', sessionID, 'purge'))
    expect(calls).toEqual([])
  })

  test('a stepped-up token for the same subject continues the session', async () => {
    const { url, calls } = await start()
    const sessionID = await initialize(url, 'reader')
    await expectInsufficientScope(await sessionCall(url, 'reader', sessionID, 'purge'))
    const retried = await sessionCall(url, 'admin', sessionID, 'purge')
    expect(retried.status).toBe(200)
    const [message] = sseMessages(await retried.text())
    expect(message?.error).toBeUndefined()
    expect(message?.result).toEqual(
      expect.objectContaining({ content: [{ type: 'text', text: 'purged' }] }),
    )
    expect(calls).toEqual(['purge'])
  })
})
