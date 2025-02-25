import { DirectTransports, type TransportType } from '@enkaku/transport'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import type {
  CallToolResult,
  ClientMessage,
  ClientRequest,
  InitializeResult,
  ServerMessage,
} from '@mokei/context-protocol'

import { ContextClient, type ClientRequest as Request } from '../src/index.js'

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

  // Initialize the client
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

describe('ContextClient', () => {
  test('initializes', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()

    const client = new ContextClient({ transport: transports.client })
    const initializedPromise = client.initialize()

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
    await expect(initializedPromise).resolves.toEqual(DEFAULT_INITIALIZE_RESULT)
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
