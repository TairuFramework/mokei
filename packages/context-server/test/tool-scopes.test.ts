import { DirectTransports } from '@enkaku/transport'
import {
  type ClientMessage,
  type ClientRequest,
  INVALID_REQUEST,
  type ServerMessage,
} from '@mokei/context-protocol'
import { afterEach, describe, expect, test } from 'vitest'

import {
  ContextServer,
  createTool,
  INSUFFICIENT_SCOPE,
  missingScopes,
  type ServerAuth,
} from '../src/index.js'

const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
}

const servers: Array<ContextServer> = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.dispose()
})

function setup(auth?: ServerAuth) {
  const calls: Array<string> = []
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const server = new ContextServer({
    name: 'test',
    version: '1.0.0',
    protocolVersions: ['2026-07-28'],
    transport: transports.server,
    auth,
    tools: {
      read: createTool({
        description: 'Needs no extra scope',
        inputSchema: { type: 'object' } as const,
        handler: () => {
          calls.push('read')
          return { content: [] }
        },
      }),
      admin: createTool({
        description: 'Needs admin',
        inputSchema: { type: 'object' } as const,
        scopes: ['admin', 'write'],
        handler: () => {
          calls.push('admin')
          return { content: [] }
        },
      }),
    },
  })
  servers.push(server)
  async function request(id: number, method: string, params: Record<string, unknown> = {}) {
    transports.client.write({
      jsonrpc: '2.0',
      id,
      method,
      params: { ...params, _meta: meta },
    } as ClientRequest)
    return (await transports.client.read()).value as {
      result?: Record<string, unknown>
      error?: { code: number; message: string; data?: unknown }
    }
  }
  return { server, calls, request }
}

describe('per-tool scopes', () => {
  test('createTool keeps scopes on the definition, never in tools/list', async () => {
    const { request } = setup()
    const listed = await request(1, 'tools/list')
    const tools = listed.result?.tools as Array<Record<string, unknown>>
    expect(tools.map((tool) => tool.name)).toEqual(['admin', 'read'])
    for (const tool of tools) expect(tool).not.toHaveProperty('scopes')
  })

  test('requiredScopes names the called tool scopes and nothing else', () => {
    const { server } = setup()
    expect(server.requiredScopes({ method: 'tools/call', params: { name: 'admin' } })).toEqual([
      'admin',
      'write',
    ])
    expect(server.requiredScopes({ method: 'tools/call', params: { name: 'read' } })).toEqual([])
    expect(server.requiredScopes({ method: 'tools/call', params: { name: 'nope' } })).toEqual([])
    expect(server.requiredScopes({ method: 'tools/call', params: { name: 'toString' } })).toEqual(
      [],
    )
    expect(server.requiredScopes({ method: 'tools/call' })).toEqual([])
    expect(server.requiredScopes({ method: 'tools/list', params: { name: 'admin' } })).toEqual([])
  })

  test('rejects a call whose auth lacks the tool scopes before the handler runs', async () => {
    const { calls, request } = setup({ subject: 'alice', scopes: ['admin'] })
    const response = await request(1, 'tools/call', { name: 'admin', arguments: {} })
    expect(response.error?.code).toBe(INVALID_REQUEST)
    expect(response.error?.message).toContain('write')
    expect(response.error?.data).toEqual({
      error: INSUFFICIENT_SCOPE,
      scopes: ['admin', 'write'],
    })
    expect(calls).toEqual([])
  })

  test('runs the call when auth holds every tool scope', async () => {
    const { calls, request } = setup({ subject: 'alice', scopes: ['write', 'admin', 'read'] })
    const response = await request(1, 'tools/call', { name: 'admin', arguments: {} })
    expect(response.error).toBeUndefined()
    expect(calls).toEqual(['admin'])
  })

  test('does not enforce scopes without auth', async () => {
    const { calls, request } = setup()
    const response = await request(1, 'tools/call', { name: 'admin', arguments: {} })
    expect(response.error).toBeUndefined()
    expect(calls).toEqual(['admin'])
  })

  test('missingScopes keeps required order and drops duplicates', () => {
    expect(missingScopes(['b', 'a', 'b', 'c'], ['c'])).toEqual(['b', 'a'])
    expect(missingScopes([], ['a'])).toEqual([])
  })
})
