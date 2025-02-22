import { DirectTransports, type TransportType } from '@enkaku/transport'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import type {
  CallToolResult,
  ClientMessage,
  GetPromptResult,
  InitializeResult,
  ServerMessage,
} from '@mokei/context-protocol'

import { ContextClient } from '../src/index.js'

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

  describe('supports prompt calls', () => {
    test('lists available prompts', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()
      const client = new ContextClient({ transport: transports.client })

      // Initialize the client
      client.initialize()
      await handleServerInitialize(transports.server)

      const callRequest = client.listPrompts()
      const incomingRequest = await transports.server.read()
      expect(incomingRequest).toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          method: 'prompts/list',
          params: {},
        },
      })

      const prompts = [
        { name: 'first', description: 'test', arguments: { type: 'object' } },
        { name: 'second', description: 'test' },
      ]
      transports.server.write({ jsonrpc: '2.0', id: 1, result: { prompts } })
      await expect(callRequest).resolves.toEqual(prompts)
    })

    test('gets a prompt', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()

      const client = new ContextClient<{
        Prompts: { hello: { name: string } }
      }>({ transport: transports.client })

      // Initialize the client
      client.initialize()
      await handleServerInitialize(transports.server)

      const callRequest = client.getPrompt('hello', { name: 'World' })
      const incomingRequest = await transports.server.read()
      expect(incomingRequest).toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          method: 'prompts/get',
          params: {
            name: 'hello',
            arguments: { name: 'World' },
          },
        },
      })

      const result: GetPromptResult = {
        messages: [{ role: 'assistant', content: { type: 'text', text: 'Hello World!' } }],
      }
      transports.server.write({ jsonrpc: '2.0', id: 1, result })
      await expect(callRequest).resolves.toEqual(result)
    })
  })

  describe('supports resource calls', () => {
    test('lists available resources', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()
      const client = new ContextClient({ transport: transports.client })

      // Initialize the client
      client.initialize()
      await handleServerInitialize(transports.server)

      const callRequest = client.listResources()
      const incomingRequest = await transports.server.read()
      expect(incomingRequest).toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/list',
          params: {},
        },
      })

      const resources = [
        { name: 'foo', uri: 'test://foo' },
        { name: 'bar', uri: 'test://bar' },
      ]
      transports.server.write({ jsonrpc: '2.0', id: 1, result: { resources } })
      await expect(callRequest).resolves.toEqual(resources)
    })

    test('lists available resource templates', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()
      const client = new ContextClient({ transport: transports.client })

      // Initialize the client
      client.initialize()
      await handleServerInitialize(transports.server)

      const callRequest = client.listResourceTemplates()
      const incomingRequest = await transports.server.read()
      expect(incomingRequest).toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/templates/list',
          params: {},
        },
      })

      const resourceTemplates = [
        { name: 'foo', uriTemplate: 'test://foo/{name}' },
        { name: 'bar', uriTemplate: 'test://bar/{name}' },
      ]
      transports.server.write({ jsonrpc: '2.0', id: 1, result: { resourceTemplates } })
      await expect(callRequest).resolves.toEqual(resourceTemplates)
    })

    test('reads a resource', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()
      const client = new ContextClient({ transport: transports.client })

      // Initialize the client
      client.initialize()
      await handleServerInitialize(transports.server)

      const callRequest = client.readResource({ uri: 'test://foo' })
      const incomingRequest = await transports.server.read()
      expect(incomingRequest).toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/read',
          params: { uri: 'test://foo' },
        },
      })

      const result = { contents: [{ uri: 'test://foo', text: 'test resource' }] }
      transports.server.write({ jsonrpc: '2.0', id: 1, result })
      await expect(callRequest).resolves.toEqual(result)
    })
  })

  describe('supports tool calls', () => {
    test('lists available tools', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()
      const client = new ContextClient({ transport: transports.client })

      // Initialize the client
      client.initialize()
      await handleServerInitialize(transports.server)

      const callRequest = client.listTools()
      const incomingRequest = await transports.server.read()
      expect(incomingRequest).toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        },
      })

      const tools = [
        { name: 'first', description: 'test', inputSchema: { type: 'object' } },
        { name: 'second', description: 'test', inputSchema: { type: 'object' } },
      ]
      transports.server.write({ jsonrpc: '2.0', id: 1, result: { tools } })
      await expect(callRequest).resolves.toEqual(tools)
    })

    test('calls a tool', async () => {
      const transports = new DirectTransports<ServerMessage, ClientMessage>()

      const client = new ContextClient<{
        Tools: { hello: { name: string } }
      }>({ transport: transports.client })

      // Initialize the client
      client.initialize()
      await handleServerInitialize(transports.server)

      const callRequest = client.callTool('hello', { name: 'World' })
      const incomingRequest = await transports.server.read()
      expect(incomingRequest).toEqual({
        done: false,
        value: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'hello',
            arguments: { name: 'World' },
          },
        },
      })

      const result: CallToolResult = {
        content: [{ type: 'text', text: 'hello World' }],
      }
      transports.server.write({ jsonrpc: '2.0', id: 1, result })
      await expect(callRequest).resolves.toEqual(result)
    })
  })
})
