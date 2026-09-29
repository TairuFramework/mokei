import { DirectTransports } from '@enkaku/transport'
import type { ClientMessage, ElicitRequest, ServerMessage } from '@mokei/context-protocol'
import { ContextServer } from '@mokei/context-server'
import { describe, expect, test } from 'vitest'

import { ContextHost, type CreateContextParams, createHostedContext } from '../src/index.js'

const elicitationParams = {
  message: 'Please provide a value',
  requestedSchema: { type: 'object' as const, properties: {} },
}

function directConfig(protocolVersion: '2025-11-25' | '2026-07-28', results: Array<unknown>) {
  return {
    name: 'elicitation-test',
    version: '1.0.0',
    protocolVersions: [protocolVersion],
    tools: {
      ask: {
        description: 'Ask the client for input',
        inputSchema: { type: 'object' as const, properties: {} },
        handler: async ({
          client,
        }: {
          client: { elicit: (params: ElicitRequest['params']) => Promise<unknown> }
        }) => {
          try {
            const result = await client.elicit(elicitationParams)
            results.push(result)
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
          } catch (error) {
            results.push(error)
            return { content: [{ type: 'text' as const, text: String(error) }], isError: true }
          }
        },
      },
    },
  }
}

function captureWrites(transport: DirectTransports<ServerMessage, ClientMessage>['client']) {
  const messages: Array<unknown> = []
  const write = transport.write.bind(transport)
  transport.write = async (message) => {
    messages.push(message)
    return await write(message)
  }
  return messages
}

async function addDirect(
  host: ContextHost,
  key: string,
  protocolVersion: '2025-11-25' | '2026-07-28',
  elicit?: false,
) {
  const observed: Array<unknown> = []
  const client = host.addDirectContext({
    key,
    config: directConfig(protocolVersion, observed),
    protocolVersion,
    elicit,
  })
  return { client, observed }
}

describe('ContextHost client elicitation', () => {
  test('direct context answers elicitation with its key', async () => {
    const host = new ContextHost({
      elicit: ({ key, params }) => {
        expect(key).toBe('direct')
        expect(params).toEqual(elicitationParams)
        return { action: 'accept', content: { answer: 'yes' } }
      },
    })
    const { observed } = await addDirect(host, 'direct', '2025-11-25')

    const result = await host.callTool({ key: 'direct', name: 'ask', arguments: {} })

    expect(result.isError).not.toBe(true)
    expect(observed).toEqual([{ action: 'accept', content: { answer: 'yes' } }])
    await host.dispose()
  })

  test('createContext false type-checks and declares no capability', async () => {
    const host = new ContextHost({ elicit: true })
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const messages = captureWrites(transports.client)
    const server = new ContextServer({
      name: 'type-test',
      version: '1.0.0',
      protocolVersions: ['2025-11-25'],
      transport: transports.server,
    })
    const params: CreateContextParams = {
      key: 'typed-opt-out',
      transport: transports.client,
      protocolVersion: '2025-11-25',
      elicit: false,
      dispose: () => server.dispose(),
    }
    const client = host.createContext(params)
    await client.initialize()
    const initialize = messages.find(
      (message) => (message as { method?: string }).method === 'initialize',
    ) as { params: { capabilities: { elicitation?: unknown } } }
    expect(initialize.params.capabilities.elicitation).toBeUndefined()
    await host.dispose()
  })

  test('createContext and addDirectContext opt out independently', async () => {
    const host = new ContextHost({ elicit: () => ({ action: 'accept' }) })
    const noCapability: Array<unknown> = []
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const server = new ContextServer({
      ...directConfig('2025-11-25', noCapability),
      transport: transports.server,
    })
    host.createContext({
      key: 'created-opt-out',
      transport: transports.client,
      protocolVersion: '2025-11-25',
      elicit: false,
      dispose: () => server.dispose(),
    })
    const { observed } = await addDirect(host, 'direct-opt-out', '2025-11-25', false)

    const createdResult = await host.callTool({
      key: 'created-opt-out',
      name: 'ask',
      arguments: {},
    })
    const directResult = await host.callTool({ key: 'direct-opt-out', name: 'ask', arguments: {} })

    expect(createdResult.isError).toBe(true)
    expect(directResult.isError).toBe(true)
    expect(noCapability[0]).toBeInstanceOf(Error)
    expect(observed[0]).toBeInstanceOf(Error)
    await host.dispose()
  })

  test('addHTTPContext false declares no capability', async () => {
    const host = new ContextHost({ elicit: true })
    const requests: Array<{
      method?: string
      params?: Record<string, unknown>
      id?: string | number
    }> = []
    const client = await host.addHTTPContext({
      key: 'http-opt-out',
      url: 'https://mcp.example.com/api',
      elicit: false,
      protocolVersion: '2025-11-25',
      fetchMiddleware: (_next) => async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          id: string | number
          method: string
          params?: Record<string, unknown>
        }
        requests.push(request)
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32603, message: 'Stop after capability inspection' },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      },
    })

    await expect(client.initialize()).rejects.toThrow('Stop after capability inspection')
    expect(requests[0]?.method).toBe('initialize')
    const capabilities = requests[0]?.params?.capabilities as Record<string, unknown> | undefined
    expect(capabilities?.elicitation).toBeUndefined()
    await host.dispose()
  })

  test('caller-built context keeps its own capabilities', async () => {
    const host = new ContextHost({ elicit: () => ({ action: 'decline' }) })
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const server = new ContextServer({
      ...directConfig('2025-11-25', []),
      transport: transports.server,
    })
    const context = createHostedContext({
      transport: transports.client,
      protocolVersion: '2025-11-25',
      elicit: () => ({ action: 'accept', content: { source: 'caller' } }),
      dispose: () => server.dispose(),
    })
    host.registerHostedContext({ key: 'caller-built', context })

    const result = await host.callTool({ key: 'caller-built', name: 'ask', arguments: {} })

    expect(result.isError).not.toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ action: 'accept', content: { source: 'caller' } }) },
    ])
    await host.dispose()
  })

  test('no host option leaves capability absent', async () => {
    const host = new ContextHost()
    const { observed } = await addDirect(host, 'disabled', '2025-11-25')
    const result = await host.callTool({ key: 'disabled', name: 'ask', arguments: {} })

    expect(result.isError).toBe(true)
    expect(observed[0]).toBeInstanceOf(Error)
    await host.dispose()
  })

  test('removed key reused by a new context routes to the new client', async () => {
    const seen: Array<string> = []
    const host = new ContextHost({
      elicit: () => {
        seen.push('host')
        return { action: 'accept' }
      },
    })
    await addDirect(host, 'reused', '2025-11-25')
    await host.remove('reused')
    await addDirect(host, 'reused', '2025-11-25')
    await host.callTool({ key: 'reused', name: 'ask', arguments: {} })

    expect(seen).toEqual(['host'])
    await host.dispose()
  })

  test('host capability is declared on both revisions before an agent exists', async () => {
    for (const protocolVersion of ['2025-11-25', '2026-07-28'] as const) {
      const host = new ContextHost({ elicit: true })
      const transports = new DirectTransports<ServerMessage, ClientMessage>()
      const messages = captureWrites(transports.client)
      const server = new ContextServer({
        name: 'capability-test',
        version: '1.0.0',
        protocolVersions: [protocolVersion],
        transport: transports.server,
        tools: {
          ping: {
            description: 'Return a value',
            inputSchema: { type: 'object', properties: {} },
            handler: () => ({ content: [{ type: 'text', text: 'pong' }] }),
          },
        },
      })
      const client = host.createContext({
        key: protocolVersion,
        transport: transports.client,
        protocolVersion,
        dispose: () => server.dispose(),
      })
      await client.listTools()

      if (protocolVersion === '2025-11-25') {
        const initialize = messages.find(
          (message) => (message as { method?: string }).method === 'initialize',
        ) as { params: { capabilities: { elicitation?: unknown } } }
        expect(initialize.params.capabilities.elicitation).toEqual({})
      } else {
        const request = messages.find((message) => {
          const metadata = (message as { params?: { _meta?: Record<string, unknown> } }).params
            ?._meta
          return metadata?.['io.modelcontextprotocol/clientCapabilities'] != null
        }) as { params: { _meta: Record<string, unknown> } }
        expect(
          (
            request.params._meta['io.modelcontextprotocol/clientCapabilities'] as {
              elicitation?: unknown
            }
          ).elicitation,
        ).toEqual({})
      }
      await host.dispose()
    }
  })

  test('URL mode reaches the host handler', async () => {
    const urlParams = {
      mode: 'url' as const,
      elicitationId: 'elicitation-123',
      url: 'https://example.com/continue',
      message: 'Continue in browser',
    }
    let received: unknown
    const host = new ContextHost({
      elicit: (request) => {
        received = request.params
        return { action: 'accept' }
      },
    })
    const observed: Array<unknown> = []
    const config = directConfig('2025-11-25', observed)
    config.tools.ask.handler = async ({ client }) => {
      const result = await client.elicit(urlParams)
      observed.push(result)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
    host.addDirectContext({ key: 'url', config, protocolVersion: '2025-11-25' })

    await host.callTool({ key: 'url', name: 'ask', arguments: {} })

    expect(received).toEqual(urlParams)
    await host.dispose()
  })
})
