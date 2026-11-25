import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ExtensionDefinition, ServerMessage } from '@mokei/context-protocol'
import { TASKS, TASKS_EXTENSION } from '@mokei/context-protocol'
import { afterEach, expect, test } from 'vitest'

import { ContextServer, createTaskManager, createTool } from '../../context-server/lib/index.js'
import { ContextClient, ExtensionNotDeclaredError, MethodNotInRevisionError } from '../src/index.js'

const TEST_EXT: ExtensionDefinition = {
  id: 'dev.mokei/test-ext',
  revision: '1',
  protocolVersions: new Set(['2025-11-25']),
  clientMethods: new Set(),
  serverMethods: new Set(),
}

const transports: Array<DirectTransports<ServerMessage, ClientMessage>> = []
afterEach(async () => {
  await Promise.all(transports.splice(0).map((pair) => pair.dispose()))
})

type Options = {
  version?: '2025-11-25' | '2026-07-28'
  tasks?: boolean
  clientExtensions?: ConstructorParameters<typeof ContextClient>[0]['_extensions']
  serverExtensions?: ConstructorParameters<typeof ContextServer>[0]['_extensions']
  serverTasks?: boolean
}

function setup(options: Options = {}) {
  const pair = new DirectTransports<ServerMessage, ClientMessage>()
  transports.push(pair)
  const sent: Array<ClientMessage> = []
  const clientWrite = pair.client.write.bind(pair.client)
  pair.client.write = ((message: ClientMessage) => {
    sent.push(message)
    return clientWrite(message)
  }) as typeof pair.client.write
  const server = new ContextServer({
    transport: pair.server,
    protocolVersions: ['2025-11-25', '2026-07-28'],
    serverInfo: { name: 'test', version: '1' },
    tools: {
      echo: createTool({
        description: 'echo',
        inputSchema: { type: 'object' },
        handler: () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
      }),
    },
    tasks: options.serverTasks === false ? undefined : createTaskManager(),
    _extensions: options.serverExtensions,
  } as never)
  const client = new ContextClient({
    protocolVersion: options.version ?? '2026-07-28',
    transport: pair.client,
    tasks: options.tasks,
    _extensions: options.clientExtensions,
    _registry: [TASKS, TEST_EXT],
  })
  return { client, server, sent }
}

const methods = (sent: Array<ClientMessage>) => sent.map((m) => (m as { method?: string }).method)

test('default client declares no extensions on 2026-07-28', async () => {
  const { client, sent } = setup()
  const result = await client.callTool({ name: 'echo', arguments: {} })
  expect(result.content).toEqual([{ type: 'text', text: 'ok' }])
  const call = sent.find((m) => (m as { method?: string }).method === 'tools/call') as {
    params: { _meta: Record<string, Record<string, unknown>> }
  }
  expect(call.params._meta['io.modelcontextprotocol/clientCapabilities']).not.toHaveProperty(
    'extensions',
  )
})

test('tasks: true declares tasks on 2026-07-28', async () => {
  const { client, sent } = setup({ tasks: true })
  await client.callTool({ name: 'echo', arguments: {} })
  const call = sent.find((m) => (m as { method?: string }).method === 'tools/call') as {
    params: { _meta: Record<string, unknown> }
  }
  expect(call.params._meta['io.modelcontextprotocol/clientCapabilities']).toMatchObject({
    extensions: { [TASKS_EXTENSION]: {} },
  })
})

test('2025-11-25 initialize carries registered extensions only', async () => {
  const bare = setup({ version: '2025-11-25', tasks: true })
  await bare.client.initialize()
  const bareInit = bare.sent.find((m) => (m as { method?: string }).method === 'initialize') as {
    params: { capabilities: Record<string, unknown> }
  }
  expect(bareInit.params.capabilities).not.toHaveProperty('extensions')

  const ext = setup({
    version: '2025-11-25',
    tasks: true,
    clientExtensions: [{ definition: TEST_EXT }],
  })
  await ext.client.initialize()
  const init = ext.sent.find((m) => (m as { method?: string }).method === 'initialize') as {
    params: { capabilities: Record<string, unknown> }
  }
  expect(init.params.capabilities).toMatchObject({
    extensions: { 'dev.mokei/test-ext': { revision: '1' } },
  })
})

test('default client refuses tasks methods locally', async () => {
  const { client, sent } = setup()
  await client.listTools()
  const before = sent.length
  await expect(client.tasks.get('t1')).rejects.toBeInstanceOf(MethodNotInRevisionError)
  await expect(client.waitForTask({ taskID: 't1' })).rejects.toBeInstanceOf(
    MethodNotInRevisionError,
  )
  await expect(
    (client.request as (method: string, params: unknown) => Promise<unknown>).call(
      client,
      'subscriptions/listen',
      { notifications: { taskIds: ['t1'] } },
    ),
  ).rejects.toBeInstanceOf(MethodNotInRevisionError)
  expect(sent.length).toBe(before)
  expect(methods(sent)).not.toContain('tasks/get')
  expect(methods(sent)).not.toContain('subscriptions/listen')
})

test('getServerExtension reads discover once on 2026-07-28', async () => {
  const { client, sent } = setup()
  expect(await client.getServerExtension(TASKS)).toEqual({})
  await client.listTools()
  expect(methods(sent).filter((m) => m === 'server/discover')).toHaveLength(1)
})

test('getServerExtension is null on revision mismatch', async () => {
  const { client } = setup({
    serverExtensions: [{ definition: { ...TASKS, revision: '9' } }],
    serverTasks: false,
  })
  expect(await client.getServerExtension(TASKS)).toBeNull()
})

test('getServerExtension reads the initialize result on 2025-11-25', async () => {
  const { client } = setup({
    version: '2025-11-25',
    serverExtensions: [{ definition: TEST_EXT }],
  })
  expect(await client.getServerExtension(TEST_EXT)).toEqual({ revision: '1' })
})

test('ExtensionNotDeclaredError carries the id', () => {
  const error = new ExtensionNotDeclaredError({ extension: 'x/y' })
  expect(error.message).toBe('Server did not declare the x/y extension')
  expect(error.extension).toBe('x/y')
})
