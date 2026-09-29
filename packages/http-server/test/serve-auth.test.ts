import { META_CLIENT_CAPABILITIES, META_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { afterEach, describe, expect, test } from 'vitest'

import type { OAuthTokenVerifier } from '../src/auth/verifier.js'
import { TokenVerificationError } from '../src/auth/verifier.js'
import { serveHTTP } from '../src/serve.js'

const SERVER_CONFIG: ServerConfig = {
  name: 'test',
  version: '1.0.0',
  protocolVersions: ['2025-11-25'],
  tools: {
    echo: {
      description: 'e',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: [] }),
    },
  },
}

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    if (token !== 'good') throw new TokenVerificationError({ code: 'invalid_token', message: 'no' })
    return { subject: 'u', scopes: ['read'] }
  },
}

/**
 * `server.address()` is `null` until the underlying TCP socket finishes binding, which is
 * asynchronous even for an IP-literal hostname on port 0 -- so callers must wait for the
 * `listening` event before reading the assigned port.
 */
async function getPort(server: ReturnType<typeof serveHTTP>['server']): Promise<number> {
  const addr = server.address()
  if (addr && typeof addr !== 'string') return addr.port
  return new Promise((resolve) => {
    server.once('listening', () => {
      const listening = server.address()
      resolve((listening as { port: number }).port)
    })
  })
}

describe('serveHTTP auth', () => {
  test('passes verified auth to the stateless server', async () => {
    const received: Array<unknown> = []
    server = serveHTTP({
      createServer: ({ transport, auth }) => {
        received.push(auth)
        return new ContextServer({ ...SERVER_CONFIG, protocolVersions: ['2026-07-28'], transport })
      },
      port: 0,
      hostname: '127.0.0.1',
      auth: {
        verifier,
        resource: 'http://127.0.0.1/mcp',
        resourceMetadataURL: 'http://127.0.0.1/.well-known/oauth-protected-resource/mcp',
        authorizationServers: ['https://as.example'],
      },
    })
    const port = await getPort(server.server)
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer good',
        'Content-Type': 'application/json',
        'X-User-Id': 'attacker',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: {
          _meta: {
            [META_PROTOCOL_VERSION]: '2026-07-28',
            [META_CLIENT_CAPABILITIES]: {},
          },
        },
      }),
    })
    expect(response.status).toBe(200)
    expect(received).toEqual([{ subject: 'u', scopes: ['read'] }])
    await response.body?.cancel()
  })

  let server: ReturnType<typeof serveHTTP> | null = null
  afterEach(async () => {
    await server?.dispose()
    server = null
  })

  test('rejects unauthenticated MCP POST with 401', async () => {
    server = serveHTTP({
      createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0,
      hostname: '127.0.0.1',
      auth: {
        verifier,
        resource: 'http://127.0.0.1/mcp',
        resourceMetadataURL: 'http://127.0.0.1/.well-known/oauth-protected-resource/mcp',
        authorizationServers: ['https://as.example'],
      },
    })
    const addr = await getPort(server.server)
    const res = await fetch(`http://127.0.0.1:${addr}/mcp`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })

  test('serves protected-resource metadata unauthenticated', async () => {
    server = serveHTTP({
      createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0,
      hostname: '127.0.0.1',
      auth: {
        verifier,
        resource: 'http://127.0.0.1/mcp',
        resourceMetadataURL: 'http://127.0.0.1/.well-known/oauth-protected-resource/mcp',
        authorizationServers: ['https://as.example'],
      },
    })
    const addr = await getPort(server.server)
    const res = await fetch(`http://127.0.0.1:${addr}/.well-known/oauth-protected-resource/mcp`)
    expect(res.status).toBe(200)
    expect(
      ((await res.json()) as { authorization_servers: Array<string> }).authorization_servers,
    ).toEqual(['https://as.example'])
  })

  test('accepts authenticated MCP POST (reaches handler, not 401)', async () => {
    server = serveHTTP({
      createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0,
      hostname: '127.0.0.1',
      auth: {
        verifier,
        resource: 'http://127.0.0.1/mcp',
        resourceMetadataURL: 'http://127.0.0.1/.well-known/oauth-protected-resource/mcp',
        authorizationServers: ['https://as.example'],
      },
    })
    const addr = await getPort(server.server)
    const res = await fetch(`http://127.0.0.1:${addr}/mcp`, {
      method: 'POST',
      headers: { Authorization: 'Bearer good' },
      body: '{}',
    })
    expect(res.status).not.toBe(401)
  })
})
