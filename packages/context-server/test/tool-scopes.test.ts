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
  createPrompt,
  createTool,
  type GenericToolDefinition,
  INSUFFICIENT_SCOPE,
  missingScopes,
  SCOPES_META_KEY,
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
      tagged: {
        description: 'Has its own _meta',
        inputSchema: { type: 'object' },
        scopes: ['admin'],
        _meta: { 'example.com/owner': 'ops' },
        handler: () => ({ content: [] }),
      } as GenericToolDefinition,
    },
    prompts: {
      greet: createPrompt({
        description: 'Open prompt',
        handler: () => ({ messages: [] }),
      }),
      secret: createPrompt({
        description: 'Needs prompts:secret',
        scopes: ['prompts:secret'],
        handler: () => {
          calls.push('secret')
          return { messages: [] }
        },
      }),
    },
    resources: {
      list: [],
      scopes: (uri) => (uri.startsWith('private://') ? ['resources:private'] : []),
      read: ({ params }) => {
        calls.push(params.uri)
        return { contents: [{ uri: params.uri, text: 'x' }] }
      },
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
  test('tools/list advertises scopes under _meta, never as a top-level field', async () => {
    const { request } = setup()
    const listed = await request(1, 'tools/list')
    const tools = listed.result?.tools as Array<Record<string, unknown>>
    expect(tools.map((tool) => tool.name)).toEqual(['admin', 'read', 'tagged'])
    for (const tool of tools) expect(tool).not.toHaveProperty('scopes')
    const [admin, read, tagged] = tools
    expect(SCOPES_META_KEY).toBe('dev.mokei/scopes')
    expect(admin?._meta).toEqual({ [SCOPES_META_KEY]: ['admin', 'write'] })
    expect(read).not.toHaveProperty('_meta')
    expect(tagged?._meta).toEqual({ 'example.com/owner': 'ops', [SCOPES_META_KEY]: ['admin'] })
  })

  test('prompts/list advertises prompt scopes the same way', async () => {
    const { request } = setup()
    const listed = await request(1, 'prompts/list')
    const prompts = listed.result?.prompts as Array<Record<string, unknown>>
    expect(prompts.map((prompt) => prompt.name)).toEqual(['greet', 'secret'])
    expect(prompts[0]).not.toHaveProperty('_meta')
    expect(prompts[1]?._meta).toEqual({ [SCOPES_META_KEY]: ['prompts:secret'] })
    for (const prompt of prompts) expect(prompt).not.toHaveProperty('scopes')
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
    expect(server.requiredScopes({ method: 'prompts/get', params: { name: 'secret' } })).toEqual([
      'prompts:secret',
    ])
    expect(server.requiredScopes({ method: 'prompts/get', params: { name: 'greet' } })).toEqual([])
    expect(server.requiredScopes({ method: 'prompts/get', params: { name: 'nope' } })).toEqual([])
    expect(
      server.requiredScopes({ method: 'resources/read', params: { uri: 'private://a' } }),
    ).toEqual(['resources:private'])
    expect(
      server.requiredScopes({ method: 'resources/read', params: { uri: 'public://a' } }),
    ).toEqual([])
  })

  test('prompts/get and resources/read enforce their scopes when auth is present', async () => {
    const { calls, request } = setup({ subject: 'alice', scopes: ['read'] })
    const prompt = await request(1, 'prompts/get', { name: 'secret' })
    expect(prompt.error?.code).toBe(INVALID_REQUEST)
    expect(prompt.error?.data).toEqual({ error: INSUFFICIENT_SCOPE, scopes: ['prompts:secret'] })
    const resource = await request(2, 'resources/read', { uri: 'private://a' })
    expect(resource.error?.code).toBe(INVALID_REQUEST)
    expect(resource.error?.message).toContain('resources/read private://a')
    expect(resource.error?.data).toEqual({
      error: INSUFFICIENT_SCOPE,
      scopes: ['resources:private'],
    })
    expect((await request(3, 'resources/read', { uri: 'public://a' })).error).toBeUndefined()
    expect((await request(4, 'prompts/get', { name: 'greet' })).error).toBeUndefined()
    expect(calls).toEqual(['public://a'])
  })

  test('prompts/get and resources/read run with the scopes held', async () => {
    const { calls, request } = setup({
      subject: 'alice',
      scopes: ['prompts:secret', 'resources:private'],
    })
    expect((await request(1, 'prompts/get', { name: 'secret' })).error).toBeUndefined()
    expect((await request(2, 'resources/read', { uri: 'private://a' })).error).toBeUndefined()
    expect(calls).toEqual(['secret', 'private://a'])
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
