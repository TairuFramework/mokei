import { type TransportType, createDirectTransports } from '@enkaku/transport'
import {
  type CallToolResult,
  type ClientMessage,
  type InitializeResult,
  LATEST_PROTOCOL_VERSION,
  type ServerMessage,
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
    const transports = createDirectTransports<ServerMessage, ClientMessage>()

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

  test('calls tool', async () => {
    const transports = createDirectTransports<ServerMessage, ClientMessage>()

    const client = new ContextClient<{
      hello: { name: string }
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
