import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ClientRequest, ServerMessage } from '@mokei/context-protocol'
import {
  type ExtensionDefinition,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  OAUTH_CLIENT_CREDENTIALS,
  TASKS,
  TASKS_EXTENSION,
} from '@mokei/context-protocol'
import { afterEach, describe, expect, test } from 'vitest'

import { ContextServer } from '../src/server.js'
import { createTaskManager } from '../src/task-manager.js'
import type { GenericToolDefinition } from '../src/types.js'

const TEST_EXT: ExtensionDefinition = {
  id: 'dev.mokei/test-ext',
  revision: '1',
  protocolVersions: new Set(['2025-11-25', '2026-07-28']),
  clientMethods: new Set(),
  serverMethods: new Set(),
}

type Response = {
  error?: { code: number; message: string; data?: unknown }
  // biome-ignore lint/suspicious/noExplicitAny: test helper reads arbitrary result shapes
  result?: Record<string, any>
}

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

type Setup = {
  protocolVersions?: Array<'2025-11-25' | '2026-07-28'>
  tasks?: boolean
  oauthClientCredentials?: boolean
  tool?: GenericToolDefinition
  /** Replaces the default `[TEST_EXT]` declared by the server. */
  declared?: Array<ExtensionDefinition>
  /** Replaces the default `[TEST_EXT, TASKS]` registry. */
  registry?: Array<ExtensionDefinition>
}

function setup(options: Setup = {}) {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const tasks = options.tasks ? createTaskManager() : undefined
  const server = new ContextServer({
    name: 'extensions-test',
    version: '1.0.0',
    protocolVersions: options.protocolVersions ?? ['2025-11-25', '2026-07-28'],
    tasks,
    oauthClientCredentials: options.oauthClientCredentials,
    subscriptions: options.tasks,
    tools: options.tool ? { probe: options.tool } : undefined,
    transport: transports.server,
    _extensions: (options.declared ?? [TEST_EXT]).map((definition) => ({ definition })),
    _registry: options.registry ?? [TEST_EXT, TASKS],
  })
  cleanup.push(() => transports.dispose())
  if (tasks != null) cleanup.push(() => tasks.dispose())
  cleanup.push(() => server.dispose())
  let nextID = 0
  return async (method: string, params: Record<string, unknown>): Promise<Response> => {
    transports.client.write({ jsonrpc: '2.0', id: ++nextID, method, params } as ClientRequest)
    const frame = await transports.client.read()
    return frame.value as Response
  }
}

const meta = (capabilities: Record<string, unknown>) => ({
  [META_PROTOCOL_VERSION]: '2026-07-28',
  [META_CLIENT_CAPABILITIES]: capabilities,
})

function probeTool(
  seen: Array<unknown>,
  field: 'clientCapabilities' | 'task',
): GenericToolDefinition {
  return {
    description: 'probe',
    inputSchema: { type: 'object' },
    handler: (request) => {
      seen.push(request[field])
      return { content: [] }
    },
  }
}

describe('extension advertising', () => {
  test('2025-11-25 initialize advertises only revision-supporting extensions', async () => {
    const request = setup({ tasks: true })
    const response = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'c', version: '1' },
    })
    expect(response.result?.capabilities.extensions).toEqual({
      'dev.mokei/test-ext': { revision: '1' },
    })
  })

  test('2026-07-28 server/discover advertises both extensions', async () => {
    const request = setup({ tasks: true })
    const response = await request('server/discover', { _meta: meta({}) })
    expect(Object.keys(response.result?.capabilities.extensions).sort()).toEqual([
      'dev.mokei/test-ext',
      TASKS_EXTENSION,
    ])
  })
})

describe('client capabilities accessor', () => {
  test('2025-11-25 reads capabilities from initialize', async () => {
    const seen: Array<unknown> = []
    const request = setup({ tool: probeTool(seen, 'clientCapabilities') })
    await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: { extensions: { 'dev.mokei/test-ext': { revision: '1' } } },
      clientInfo: { name: 'c', version: '1' },
    })
    await request('tools/call', { name: 'probe', arguments: {} })
    expect(seen[0]).toEqual({ extensions: { 'dev.mokei/test-ext': { revision: '1' } } })
  })

  test('2026-07-28 reads capabilities from request _meta', async () => {
    const seen: Array<unknown> = []
    const request = setup({ tool: probeTool(seen, 'clientCapabilities') })
    const caps = { extensions: { 'dev.mokei/test-ext': { revision: '1' } } }
    await request('tools/call', { name: 'probe', arguments: {}, _meta: meta(caps) })
    expect(seen[0]).toEqual(caps)
  })
})

describe('registry gating', () => {
  const wrongRevision = { extensions: { [TASKS_EXTENSION]: { revision: '9' } } }

  test('tasks/get with a mismatched revision is refused', async () => {
    const request = setup({ tasks: true, protocolVersions: ['2026-07-28'] })
    const response = await request('tasks/get', { taskId: 'x', _meta: meta(wrongRevision) })
    expect(response.error?.message).toBe('Client did not declare the tasks extension')
    expect(response.error?.data).toEqual({
      requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } },
    })
  })

  test('tools/call with a mismatched revision gets no task context', async () => {
    const seen: Array<unknown> = []
    const request = setup({
      tasks: true,
      protocolVersions: ['2026-07-28'],
      tool: probeTool(seen, 'task'),
    })
    await request('tools/call', { name: 'probe', arguments: {}, _meta: meta(wrongRevision) })
    expect(seen).toEqual([undefined])
  })

  test('tasks/get without tasks is method-not-found', async () => {
    const request = setup({ protocolVersions: ['2026-07-28'] })
    const response = await request('tasks/get', { taskId: 'x', _meta: meta({}) })
    expect(response.error?.code).toBe(-32601)
    expect(response.error?.message).toBe('Unsupported method: tasks/get')
  })

  test('subscriptions/listen taskIds without Tasks declaration is refused', async () => {
    const request = setup({ tasks: true, protocolVersions: ['2026-07-28'] })
    const response = await request('subscriptions/listen', {
      notifications: { taskIds: ['x'] },
      _meta: meta({}),
    })
    expect(response.error?.message).toBe('Client did not declare the tasks extension')
  })
})

describe('registry gating on 2025-11-25', () => {
  // Claims a core 2025-11-25 method so the gate runs on the stateful revision.
  const CoreExt: ExtensionDefinition = {
    id: 'dev.mokei/core-ext',
    revision: '1',
    protocolVersions: new Set(['2025-11-25']),
    clientMethods: new Set(['logging/setLevel']),
    serverMethods: new Set(),
  }
  const initialize = (capabilities: Record<string, unknown>) => ({
    protocolVersion: '2025-11-25',
    capabilities,
    clientInfo: { name: 'c', version: '1' },
  })

  test('is method-not-found when the server does not enable the extension', async () => {
    const request = setup({
      protocolVersions: ['2025-11-25'],
      declared: [],
      registry: [CoreExt],
    })
    await request('initialize', initialize({}))
    const response = await request('logging/setLevel', { level: 'info' })
    expect(response.error?.code).toBe(-32601)
  })

  test('is refused when the client did not declare the extension', async () => {
    const request = setup({
      protocolVersions: ['2025-11-25'],
      declared: [CoreExt],
      registry: [CoreExt],
    })
    await request('initialize', initialize({}))
    const response = await request('logging/setLevel', { level: 'info' })
    expect(response.error?.code).toBe(-32021)
  })

  test('succeeds when the client declared the extension', async () => {
    const request = setup({
      protocolVersions: ['2025-11-25'],
      declared: [CoreExt],
      registry: [CoreExt],
    })
    await request(
      'initialize',
      initialize({ extensions: { 'dev.mokei/core-ext': { revision: '1' } } }),
    )
    const response = await request('logging/setLevel', { level: 'info' })
    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({})
  })
})

describe('oauth client credentials advertising', () => {
  const id = OAUTH_CLIENT_CREDENTIALS.id

  test('flagged server advertises it as {} on initialize and server/discover', async () => {
    const request = setup({
      oauthClientCredentials: true,
      declared: [],
      registry: [OAUTH_CLIENT_CREDENTIALS],
    })
    const init = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'c', version: '1' },
    })
    expect(init.result?.capabilities.extensions).toEqual({ [id]: {} })
    const discover = await request('server/discover', { _meta: meta({}) })
    expect(discover.result?.capabilities.extensions).toEqual({ [id]: {} })
  })

  test('unflagged server advertises nothing', async () => {
    const request = setup({ declared: [], registry: [OAUTH_CLIENT_CREDENTIALS] })
    const init = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'c', version: '1' },
    })
    expect(init.result?.capabilities).not.toHaveProperty('extensions')
    const discover = await request('server/discover', { _meta: meta({}) })
    expect(discover.result?.capabilities).not.toHaveProperty('extensions')
  })
})
