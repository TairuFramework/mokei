import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import {
  type ExtensionDefinition,
  INVALID_PARAMS,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  TASKS,
  TASKS_EXTENSION,
} from '@mokei/context-protocol'
import { RPCError } from '@mokei/context-rpc'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { applyCacheHints } from '../src/cache.js'
import type { ServerExtension } from '../src/extension.js'
import { ContextServer, type ServerConfig } from '../src/server.js'
import { createTaskManager } from '../src/task-manager.js'

type Response = {
  error?: { code: number; message: string; data?: unknown }
  // biome-ignore lint/suspicious/noExplicitAny: test helper reads arbitrary result shapes
  result?: Record<string, any>
}

/** Claims real `2026-07-28` wire methods the core `switch` leaves to an extension. */
const TEST_EXT: ExtensionDefinition = {
  id: 'test/ext',
  protocolVersions: new Set(['2026-07-28']),
  clientMethods: new Set(['skills/list', 'skills/get']),
  serverMethods: new Set(),
  clientDeclaration: 'none',
}

const META = {
  _meta: { [META_PROTOCOL_VERSION]: '2026-07-28', [META_CLIENT_CAPABILITIES]: {} },
}

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

type Setup = Partial<Omit<ServerConfig, 'name' | 'version'>>

function create(config: Setup = {}): ContextServer {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  cleanup.push(() => transports.dispose())
  const server = new ContextServer({
    name: 'extension-hook-test',
    version: '1.0.0',
    protocolVersions: ['2026-07-28'],
    _registry: [TEST_EXT],
    ...config,
    transport: transports.server,
  })
  cleanup.push(() => server.dispose())
  let nextID = 0
  requesters.set(server, async (method, params = {}) => {
    transports.client.write({ jsonrpc: '2.0', id: ++nextID, method, params } as ClientRequest)
    const frame = await transports.client.read()
    return frame.value as Response
  })
  return server
}

type Request = (method: string, params?: Record<string, unknown>) => Promise<Response>
const requesters = new WeakMap<ContextServer, Request>()

function setup(config: Setup = {}): Request {
  return requesters.get(create(config)) as Request
}

function extension(overrides: Partial<ServerExtension> = {}): ServerExtension {
  return {
    definition: TEST_EXT,
    handlers: { 'skills/list': () => ({ skills: [{ name: 'from-handler' }] }) },
    ...overrides,
  }
}

const provider = {
  owns: (uri: string) => uri.startsWith('test://'),
  read: (uri: string) => {
    if (uri !== 'test://a') {
      throw new RPCError({ code: INVALID_PARAMS, message: `Resource not found: ${uri}` })
    }
    return { uri, text: 'from-provider' }
  },
}

describe('server extension hook', () => {
  test('dispatches an extension method to its handler', async () => {
    const handler = vi.fn(() => ({ skills: [] }))
    const request = setup({ extensions: [extension({ handlers: { 'skills/list': handler } })] })
    const response = await request('skills/list', META)
    expect(response.error).toBeUndefined()
    expect(response.result).toMatchObject({ skills: [], ttlMs: 0, cacheScope: 'private' })
    expect(handler).toHaveBeenCalledOnce()
  })

  test('extension method without handler is METHOD_NOT_FOUND', async () => {
    const request = setup({ extensions: [extension()] })
    const response = await request('skills/get', { uri: 'skill://x/SKILL.md', ...META })
    expect(response.error?.code).toBe(METHOD_NOT_FOUND)
  })

  test('extension method with an undefined handler is METHOD_NOT_FOUND', async () => {
    const request = setup({
      extensions: [
        extension({
          handlers: { 'skills/list': () => ({ skills: [] }), 'skills/get': undefined },
        }),
      ],
    })
    const response = await request('skills/get', { uri: 'skill://x/SKILL.md', ...META })
    expect(response.error?.code).toBe(METHOD_NOT_FOUND)
  })

  test('applyCacheHints caches extra methods', () => {
    expect(applyCacheHints('x/y', {}, undefined)).toEqual({})
    expect(applyCacheHints('x/y', {}, { ttlMs: 5 }, new Set(['x/y']))).toEqual({
      ttlMs: 5,
      cacheScope: 'private',
    })
  })

  test('declares the extension with its settings', async () => {
    const settings = { flavour: 'vanilla' }
    const request = setup({ extensions: [extension({ settings })] })
    const response = await request('server/discover', META)
    expect(response.result?.capabilities.extensions['test/ext']).toEqual(settings)
  })

  test('capabilities.resources gives resources: {} without a resources param', async () => {
    const request = setup({
      extensions: [extension({ capabilities: { resources: true }, resources: provider })],
    })
    const discover = await request('server/discover', META)
    expect(discover.result?.capabilities.resources).toEqual({})
    const list = await request('resources/list', META)
    expect(list.result).toMatchObject({ resources: [] })
    const templates = await request('resources/templates/list', META)
    expect(templates.result).toMatchObject({ resourceTemplates: [] })
    const read = await request('resources/read', { uri: 'file:///x', ...META })
    expect(read.error).toMatchObject({
      code: INVALID_PARAMS,
      message: 'Resource not found: file:///x',
    })
  })

  test('provider owns its URIs and leaves others to resources handler', async () => {
    const read = vi.fn(({ params }: { params: { uri: string } }) => ({
      contents: [{ uri: params.uri, text: 'user' }],
    }))
    const request = setup({
      resources: { list: [{ uri: 'file:///x', name: 'x' }], read },
      extensions: [extension({ resources: provider })],
    })
    const owned = await request('resources/read', { uri: 'test://a', ...META })
    expect(owned.result?.contents).toEqual([{ uri: 'test://a', text: 'from-provider' }])
    const other = await request('resources/read', { uri: 'file:///x', ...META })
    expect(other.result?.contents).toEqual([{ uri: 'file:///x', text: 'user' }])
    expect(read).toHaveBeenCalledOnce()
    const list = await request('resources/list', META)
    expect(list.result?.resources).toEqual([{ uri: 'file:///x', name: 'x' }])
  })

  test('scopes and cache replace the server’s for extension requests', async () => {
    const scoped = create({
      resources: { scopes: ['server'], read: () => ({ contents: [] }) },
      cache: { ttlMs: 10, cacheScope: 'public' },
      extensions: [extension({ scopes: ['ext'], resources: provider, cache: { ttlMs: 99 } })],
    })
    expect(scoped.requiredScopes({ method: 'skills/list' })).toEqual(['ext'])
    expect(
      scoped.requiredScopes({ method: 'resources/read', params: { uri: 'test://a' } }),
    ).toEqual(['ext'])
    expect(
      scoped.requiredScopes({ method: 'resources/read', params: { uri: 'file:///x' } }),
    ).toEqual(['server'])
    const response = await (requesters.get(scoped) as Request)('skills/list', META)
    expect(response.result).toMatchObject({ ttlMs: 99, cacheScope: 'public' })

    const unscoped = create({
      resources: { scopes: ['server'], read: () => ({ contents: [] }) },
      extensions: [extension({ resources: provider })],
    })
    expect(unscoped.requiredScopes({ method: 'skills/list' })).toEqual([])
    expect(
      unscoped.requiredScopes({ method: 'resources/read', params: { uri: 'test://a' } }),
    ).toEqual([])
  })

  test('matches extensions by id', async () => {
    const request = setup({ extensions: [extension({ definition: { ...TEST_EXT } })] })
    const response = await request('skills/list', META)
    expect(response.error).toBeUndefined()
    expect(response.result?.skills).toEqual([{ name: 'from-handler' }])
  })

  test('rejects duplicate extension ids', () => {
    expect(() => create({ extensions: [extension(), extension()] })).toThrow(/test\/ext/)
  })

  test('tasks keep core handling', async () => {
    const tasks = createTaskManager()
    cleanup.push(() => tasks.dispose())
    const request = setup({ tasks, _registry: [TEST_EXT, TASKS], extensions: [extension()] })
    const response = await request('tasks/get', {
      taskId: 'unknown',
      _meta: {
        [META_PROTOCOL_VERSION]: '2026-07-28',
        [META_CLIENT_CAPABILITIES]: { extensions: { [TASKS_EXTENSION]: {} } },
      },
    })
    expect(response.error).toMatchObject({ code: INVALID_PARAMS, message: 'Task not found' })
  })
})
