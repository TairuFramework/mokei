import {
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  TASKS_EXTENSION,
} from '@mokei/context-protocol'
import { ContextServer, createTaskManager, type ServerConfig } from '@mokei/context-server'
import type { OAuthTokenVerifier } from '@teikyo/oauth'
import { TokenVerificationError } from '@teikyo/oauth'
import { afterEach, describe, expect, test } from 'vitest'

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

describe('serveHTTP auth', () => {
  test('passes verified auth to the stateless server', async () => {
    const received: Array<unknown> = []
    server = await serveHTTP({
      createServer: ({ transport, auth }) => {
        received.push(auth)
        return new ContextServer({ ...SERVER_CONFIG, protocolVersions: ['2026-07-28'], transport })
      },
      port: 0,
      hostname: '127.0.0.1',
      auth: {
        verifier,
        resource: 'http://127.0.0.1/mcp',
        authorizationServers: ['https://as.example'],
      },
    })
    const port = Number(new URL(server.server.url).port)
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

  test('hides a task from a different verified HTTP subject', async () => {
    const manager = createTaskManager()
    const identityVerifier: OAuthTokenVerifier = {
      async verifyAccessToken(token) {
        if (token !== 'alice' && token !== 'bob') {
          throw new TokenVerificationError({ code: 'invalid_token', message: 'no' })
        }
        return { issuer: 'https://issuer.example', subject: token, scopes: ['read'] }
      },
    }
    try {
      server = await serveHTTP({
        tasks: manager,
        createServer: ({ transport, auth, tasks }) =>
          new ContextServer({
            ...SERVER_CONFIG,
            protocolVersions: ['2026-07-28'],
            tools: {
              start: {
                description: 'Create a task',
                inputSchema: { type: 'object' },
                handler: ({ task }) => {
                  if (task == null) throw new Error('Expected task context')
                  return task.run(() => ({ content: [] }))
                },
              },
            },
            transport,
            auth,
            tasks,
          }),
        port: 0,
        hostname: '127.0.0.1',
        auth: {
          verifier: identityVerifier,
          resource: 'http://127.0.0.1/mcp',
          authorizationServers: ['https://as.example'],
        },
      })
      const port = Number(new URL(server.server.url).port)
      async function call(token: string, method: string, params: Record<string, unknown>) {
        const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-User-Id': 'alice',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params: {
              ...params,
              _meta: {
                [META_PROTOCOL_VERSION]: '2026-07-28',
                [META_CLIENT_CAPABILITIES]: { extensions: { [TASKS_EXTENSION]: {} } },
              },
            },
          }),
        })
        expect(response.status).toBe(200)
        const data = (await response.text())
          .split('\n')
          .find((line) => line.startsWith('data: ') && line.slice(6).trim() !== '')
        if (data == null) throw new Error('Missing SSE response')
        return JSON.parse(data.slice(6)) as {
          result?: { resultType?: string; taskId?: string }
          error?: { code: number; message: string }
        }
      }

      const created = await call('alice', 'tools/call', { name: 'start', arguments: {} })
      expect(created.result?.resultType).toBe('task')
      const taskId = created.result?.taskId
      expect(taskId).toBeDefined()
      const owned = await call('alice', 'tasks/get', { taskId })
      expect(owned.result?.taskId).toBe(taskId)
      const hidden = await call('bob', 'tasks/get', { taskId })
      expect(hidden.error).toMatchObject({ code: -32602, message: 'Task not found' })
    } finally {
      await server?.dispose()
      server = null
      await manager.dispose()
    }
  })

  let server: Awaited<ReturnType<typeof serveHTTP>> | null = null
  afterEach(async () => {
    await server?.dispose()
    server = null
  })

  test('rejects unauthenticated MCP POST with 401', async () => {
    server = await serveHTTP({
      createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0,
      hostname: '127.0.0.1',
      auth: {
        verifier,
        resource: 'http://127.0.0.1/mcp',
        authorizationServers: ['https://as.example'],
      },
    })
    const addr = Number(new URL(server.server.url).port)
    const res = await fetch(`http://127.0.0.1:${addr}/mcp`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
  })

  test('serves protected-resource metadata unauthenticated', async () => {
    server = await serveHTTP({
      createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0,
      hostname: '127.0.0.1',
      auth: {
        verifier,
        resource: 'http://127.0.0.1/mcp',
        authorizationServers: ['https://as.example'],
      },
    })
    const addr = Number(new URL(server.server.url).port)
    const res = await fetch(`http://127.0.0.1:${addr}/.well-known/oauth-protected-resource/mcp`)
    expect(res.status).toBe(200)
    expect(
      ((await res.json()) as { authorization_servers: Array<string> }).authorization_servers,
    ).toEqual(['https://as.example'])
  })

  test('accepts authenticated MCP POST (reaches handler, not 401)', async () => {
    server = await serveHTTP({
      createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0,
      hostname: '127.0.0.1',
      auth: {
        verifier,
        resource: 'http://127.0.0.1/mcp',
        authorizationServers: ['https://as.example'],
      },
    })
    const addr = Number(new URL(server.server.url).port)
    const res = await fetch(`http://127.0.0.1:${addr}/mcp`, {
      method: 'POST',
      headers: { Authorization: 'Bearer good' },
      body: '{}',
    })
    expect(res.status).not.toBe(401)
  })
})
