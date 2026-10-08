import { randomIdentity, stringifyToken } from '@kokuin/token'
import {
  ContextServer,
  createSubscriptionHub,
  type ServerConfig,
  type ServerEvents,
} from '@mokei/context-server'
import { EventEmitter } from '@sozai/event'
import { createServer, definePlugin, type HTTPServer } from '@sozai/http-server'
import { createDIDVerifier, oauthResourcePlugin } from '@teikyo/oauth'
import { afterEach, describe, expect, test } from 'vitest'

import { type AuthInfo, type MCPPluginParams, MOKEI_MCP, mcpPlugin } from '../src/index.js'
import {
  expectBearerChallenge,
  expectToolsList,
  RESOURCE,
  requestToolsList,
} from './serve-auth-fixture.js'

const AUTHORIZATION_SERVER = 'https://did.example.test'
const SERVER_CONFIG: ServerConfig = {
  name: 'plugin-test-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28'],
  tools: {
    echo: {
      description: 'Echo',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: [] }),
    },
  },
}
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup()
  }
})

async function setup(
  overrides: Partial<MCPPluginParams> = {},
  limits?: {
    bodyBytes?: number
    requestTimeoutMs?: number
  },
): Promise<HTTPServer> {
  const server = await createServer({
    port: 0,
    hostname: '127.0.0.1',
    graceMs: 1000,
    limits,
    plugins: [
      mcpPlugin({
        createServer: ({ transport, subscriptionHub, connectionID }) =>
          new ContextServer({ ...SERVER_CONFIG, transport, subscriptionHub, connectionID }),
        ...overrides,
      }),
      ...(overrides.auth == null
        ? []
        : [
            oauthResourcePlugin({
              resource: RESOURCE,
              authorizationServers: [AUTHORIZATION_SERVER],
              verifier: createDIDVerifier(),
            }),
          ]),
    ],
  })
  cleanups.push(() => server.dispose())
  await server.listen()
  return server
}

async function mintToken(scope = 'read write') {
  const identity = randomIdentity()
  const token = stringifyToken(
    await identity.signToken({
      aud: RESOURCE,
      scope,
      exp: Math.floor(Date.now() / 1000) + 300,
    }),
  )
  return { identity, token }
}

describe('mokei:mcp plugin', () => {
  test('serves MCP requests without auth', async () => {
    const server = await setup()
    await expectToolsList(await requestToolsList(server.url))
  })

  test('routes GET and DELETE to the handler without auth', async () => {
    const server = await setup()
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(`${server.url}/mcp`, { method })
      expect(response.status).toBe(400)
      expect(await response.text()).toBe('Mcp-Session-Id header required')
    }
  })

  test('rejects a bare GET with 401 when auth is on', async () => {
    const server = await setup({ auth: {} })
    expectBearerChallenge(await fetch(`${server.url}/mcp`), 401)
  })

  test('rejects a missing bearer with 401 when auth is on', async () => {
    const server = await setup({ auth: {} })
    expectBearerChallenge(await requestToolsList(server.url), 401)
  })

  test('passes verified auth to the MCP server', async () => {
    let received: AuthInfo | undefined
    const server = await setup({
      auth: {},
      createServer: ({ transport, auth }) => {
        received = auth
        return new ContextServer({ ...SERVER_CONFIG, transport })
      },
    })
    const { identity, token } = await mintToken()
    await expectToolsList(await requestToolsList(server.url, token))
    expect(received).toMatchObject({
      subject: identity.id,
      issuer: identity.id,
      scopes: ['read', 'write'],
    })
  })

  test('enforces configured scopes', async () => {
    const server = await setup({ auth: { scopes: ['write'] } })
    expectBearerChallenge(
      await requestToolsList(server.url, (await mintToken('read')).token),
      403,
      'insufficient_scope',
    )
    await expectToolsList(await requestToolsList(server.url, (await mintToken()).token))
  })

  test('serves protected resource metadata without a token', async () => {
    const server = await setup({ auth: {} })
    const response = await fetch(`${server.url}/.well-known/oauth-protected-resource/mcp`, {
      signal: AbortSignal.timeout(3000),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      resource: RESOURCE,
      authorization_servers: [AUTHORIZATION_SERVER],
    })
  })

  test('mounts a custom path with the handler body limit', async () => {
    const server = await setup({ path: '/rpc', maxBodyBytes: 4096 }, { bodyBytes: 1 })
    const response = await server.app.request('/mcp')
    expect(response.status).toBe(404)
    await expectToolsList(
      await server.app.request('/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
            },
          },
        }),
      }),
    )
    const oversized = await server.app.request('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ' '.repeat(4097),
    })
    expect(oversized.status).toBe(413)
  })

  test('scopes the limits override to the MCP path', async () => {
    const server = await createServer({
      port: 0,
      hostname: '127.0.0.1',
      limits: { bodyBytes: 1 },
      plugins: [
        mcpPlugin({
          path: '/rpc',
          createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
        }),
        definePlugin({
          name: 'test:echo',
          setup(ctx) {
            for (const path of ['/other', '/rpcx']) {
              ctx.route('post', path, async (c) => c.text(await c.req.text()))
            }
          },
        }),
      ],
    })
    cleanups.push(() => server.dispose())
    for (const path of ['/other', '/rpcx']) {
      const response = await server.app.request(path, { method: 'POST', body: '12' })
      expect(response.status).toBe(413)
    }
  })

  test('requires the OAuth resource plugin when auth is configured', async () => {
    await expect(
      createServer({
        plugins: [
          mcpPlugin({
            auth: {},
            createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
          }),
        ],
      }),
    ).rejects.toThrow('oauth:resource')
  })

  test('exports the handler for dependent plugins', async () => {
    let available = false
    const server = await createServer({
      plugins: [
        definePlugin({
          name: 'probe',
          dependsOn: [MOKEI_MCP],
          setup(ctx) {
            available = typeof ctx.use(MOKEI_MCP).handler.shutdown === 'function'
          },
        }),
        mcpPlugin({
          createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
        }),
      ],
    })
    cleanups.push(() => server.dispose())
    expect(available).toBe(true)
  })

  test('closes a handshake-session GET stream without forcing server shutdown', async () => {
    const server = await setup({
      createServer: ({ transport }) =>
        new ContextServer({ ...SERVER_CONFIG, protocolVersions: ['2025-11-25'], transport }),
    })
    const initialized = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    })
    expect(initialized.status).toBe(200)
    await initialized.json()
    const sessionID = initialized.headers.get('Mcp-Session-Id')
    if (sessionID == null) throw new Error('Missing handshake session')
    const response = await fetch(`${server.url}/mcp`, {
      signal: AbortSignal.timeout(3000),
      headers: {
        Accept: 'text/event-stream',
        'Mcp-Session-Id': sessionID,
        'MCP-Protocol-Version': '2025-11-25',
      },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    if (response.body == null) throw new Error('Missing session stream')
    const reader = response.body.getReader()
    try {
      expect((await reader.read()).done).toBe(false)
      const draining = (async () => {
        while (!(await reader.read()).done) {}
      })()
      await server.dispose()
      await draining
      expect(server.shutdownReport?.forced).toBe(false)
    } finally {
      reader.releaseLock()
    }
  })

  test('ends subscriptions during server shutdown', async () => {
    const hub = createSubscriptionHub({ events: new EventEmitter<ServerEvents>() })
    cleanups.push(() => hub.dispose())
    const server = await setup({ subscriptionHub: hub }, { requestTimeoutMs: 20 })
    const response = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'subscriptions/listen',
        params: {
          notifications: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
          },
        },
      }),
    })
    expect(response.status).toBe(200)
    if (response.body == null) throw new Error('Missing subscription stream')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let text = decoder.decode((await reader.read()).value, { stream: true })
    expect(text).toContain('notifications/subscriptions/acknowledged')
    const draining = (async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        text += decoder.decode(value, { stream: true })
      }
    })()
    await new Promise((resolve) => setTimeout(resolve, 40))
    await server.dispose()
    await draining
    const messages = text
      .split('\n')
      .filter((line) => line.startsWith('data: ') && line.slice(6).trim() !== '')
      .map((line) => JSON.parse(line.slice(6)))
    expect(messages.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: { _meta: { 'io.modelcontextprotocol/subscriptionId': 2 } },
    })
    expect(server.shutdownReport?.forced).toBe(false)
    expect(server.shutdownReport?.hooks).toEqual([
      { plugin: 'mokei:mcp', phase: 'shutdown', outcome: 'completed' },
      { plugin: 'mokei:mcp', phase: 'close', outcome: 'completed' },
    ])
  })
})
