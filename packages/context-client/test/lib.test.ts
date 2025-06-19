import { DirectTransports, type TransportType } from '@enkaku/transport'
import { jest } from '@jest/globals'
import type {
  CallToolResult,
  ClientMessage,
  ClientRequest,
  CreateMessageRequest,
  CreateMessageResult,
  InitializeResult,
  Log,
  Root,
  ServerMessage,
  ServerRequest,
} from '@mokei/context-protocol'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import type { SentRequest as Request } from '@mokei/context-rpc'

import { type ClientParams, ContextClient } from '../src/index.js'

const DEFAULT_INITIALIZE_RESULT: InitializeResult = {
  capabilities: {},
  protocolVersion: LATEST_PROTOCOL_VERSION,
  serverInfo: { name: 'Mokei', version: '0.1.0' },
}

async function handleServerInitialize(
  transport: TransportType<ClientMessage, ServerMessage>,
  result: InitializeResult = DEFAULT_INITIALIZE_RESULT,
): Promise<ClientMessage> {
  // Server receives initialize request
  const request = await transport.read()
  if (request.done) {
    throw new Error('Server did not receive initialize request')
  }
  // Server sends back initialize response
  transport.write({ jsonrpc: '2.0', id: 0, result })
  // Server receives initialized notification
  await transport.read()
  // Return initialize request
  return request.value
}

type RunClientRequest<T> = (client: ContextClient) => Request<T>

async function executeClientRequest<T>(
  runRequest: RunClientRequest<T>,
  expectedRequest: Omit<ClientRequest, 'jsonrpc' | 'id'>,
  result: unknown,
): Promise<T> {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({ transport: transports.client })

  client.initialize()
  await handleServerInitialize(transports.server)

  const request = runRequest(client)
  const incomingRequest = await transports.server.read()
  expect(incomingRequest).toEqual({
    done: false,
    value: { jsonrpc: '2.0', id: 1, ...expectedRequest },
  })
  transports.server.write({ jsonrpc: '2.0', id: 1, result } as ServerMessage)

  return request
}

async function expectClientResponse(
  params: Omit<ClientParams, 'transport'>,
  request: Omit<ServerRequest, 'jsonrpc' | 'id'>,
  response: Record<string, unknown>,
): Promise<void> {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({ ...params, transport: transports.client })
  client.initialize()
  await handleServerInitialize(transports.server)
  transports.server.write({ jsonrpc: '2.0' as const, id: 1, ...request } as ServerRequest)
  await expect(transports.server.read()).resolves.toEqual({
    done: false,
    value: { jsonrpc: '2.0', id: 1, ...response },
  })
  await transports.dispose()
}

describe('ContextClient', () => {
  test('initializes', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()

    const client = new ContextClient({ transport: transports.client })
    const initializedPromise = client.initialize()

    const initializedEvent = client.events.once('initialized')

    await expect(handleServerInitialize(transports.server)).resolves.toEqual({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: {
          name: 'Mokei',
          version: '0.1.0',
        },
        protocolVersion: LATEST_PROTOCOL_VERSION,
      },
    })

    await expect(initializedEvent).resolves.toEqual(DEFAULT_INITIALIZE_RESULT)
    await expect(initializedPromise).resolves.toEqual(DEFAULT_INITIALIZE_RESULT)
  })

  test('supports logs', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({ transport: transports.client })

    const logs: Array<Log> = []
    client.events.on('log', (log) => {
      logs.push(log)
    })

    client.initialize()
    await handleServerInitialize(transports.server)

    await transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'info', data: { message: 'test' } },
    })
    await transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { level: 'error', data: { message: 'test' } },
    })

    await transports.dispose()
    expect(logs).toEqual([
      { level: 'info', data: { message: 'test' } },
      { level: 'error', data: { message: 'test' } },
    ])
  })

  test('supports roots list requests', async () => {
    const roots: Array<Root> = [{ name: 'test', uri: 'test://test' }]
    await expectClientResponse(
      { listRoots: roots },
      { method: 'roots/list' },
      { result: { roots } },
    )
  })

  test('supports sampling messages requests', async () => {
    const params: CreateMessageRequest['params'] = {
      messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
      maxTokens: 100,
    }
    const result: CreateMessageResult = {
      role: 'assistant',
      model: 'foo',
      content: { type: 'text', text: 'test' },
    }
    const createMessage = jest.fn(() => result)

    await expectClientResponse(
      { createMessage },
      { method: 'sampling/createMessage', params },
      { result },
    )
    expect(createMessage).toHaveBeenCalledWith(params, expect.any(AbortSignal))
  })

  test('supports completion calls', async () => {
    const params = {
      ref: { type: 'ref/prompt', name: 'test' },
      argument: { name: 'test', value: 'one' },
    } as const
    const completion = { values: ['one', 'two'] }

    const request = executeClientRequest(
      (client) => client.complete(params),
      { method: 'completion/complete', params },
      { completion },
    )
    await expect(request).resolves.toEqual(completion)
  })

  describe('supports prompt calls', () => {
    test('lists available prompts', async () => {
      const prompts = [
        { name: 'first', description: 'test', arguments: { type: 'object' } },
        { name: 'second', description: 'test' },
      ]
      const request = executeClientRequest(
        (client) => client.listPrompts(),
        { method: 'prompts/list', params: {} },
        { prompts },
      )
      await expect(request).resolves.toEqual(prompts)
    })

    test('gets a prompt', async () => {
      const result = {
        messages: [{ role: 'assistant', content: { type: 'text', text: 'Hello World!' } }],
      }
      const request = executeClientRequest(
        (client) => client.getPrompt('hello', { name: 'World' }),
        {
          method: 'prompts/get',
          params: {
            name: 'hello',
            arguments: { name: 'World' },
          },
        },
        result,
      )
      await expect(request).resolves.toEqual(result)
    })
  })

  describe('supports resource calls', () => {
    test('lists available resources', async () => {
      const resources = [
        { name: 'foo', uri: 'test://foo' },
        { name: 'bar', uri: 'test://bar' },
      ]
      const request = executeClientRequest(
        (client) => client.listResources(),
        { method: 'resources/list', params: {} },
        { resources },
      )
      await expect(request).resolves.toEqual(resources)
    })

    test('lists available resource templates', async () => {
      const resourceTemplates = [
        { name: 'foo', uriTemplate: 'test://foo/{name}' },
        { name: 'bar', uriTemplate: 'test://bar/{name}' },
      ]
      const request = executeClientRequest(
        (client) => client.listResourceTemplates(),
        { method: 'resources/templates/list', params: {} },
        { resourceTemplates },
      )
      await expect(request).resolves.toEqual(resourceTemplates)
    })

    test('reads a resource', async () => {
      const result = { contents: [{ uri: 'test://foo', text: 'test resource' }] }
      const request = executeClientRequest(
        (client) => client.readResource({ uri: 'test://foo' }),
        { method: 'resources/read', params: { uri: 'test://foo' } },
        result,
      )
      await expect(request).resolves.toEqual(result)
    })
  })

  describe('supports tool calls', () => {
    test('lists available tools', async () => {
      const tools = [
        { name: 'first', description: 'test', inputSchema: { type: 'object' } },
        { name: 'second', description: 'test', inputSchema: { type: 'object' } },
      ]
      const request = executeClientRequest(
        (client) => client.listTools(),
        { method: 'tools/list', params: {} },
        { tools },
      )
      await expect(request).resolves.toEqual(tools)
    })

    test('calls a tool', async () => {
      const result: CallToolResult = {
        content: [{ type: 'text', text: 'hello World' }],
      }
      const request = executeClientRequest(
        (client) => client.callTool('hello', { name: 'World' }),
        {
          method: 'tools/call',
          params: {
            name: 'hello',
            arguments: { name: 'World' },
          },
        },
        result,
      )
      await expect(request).resolves.toEqual(result)
    })
  })
})
