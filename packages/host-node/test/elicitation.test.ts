import { describe, expect, test, vi } from 'vitest'

import { runDaemon } from '../src/daemon.js'
import { NodeContextHost, spawnHostedContext } from '../src/node-host.js'
import { ProxyHost } from '../src/proxy.js'

vi.mock('../src/daemon.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/daemon.js')>()
  return { ...original, runDaemon: vi.fn() }
})

function fixture(name: string): string {
  return new URL(`./fixtures/${name}`, import.meta.url).pathname
}

function resultData(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content.find((item) => item.type === 'text')?.text
  if (text == null) throw new Error('Expected text result')
  return JSON.parse(text) as { elicitationCapability: boolean; response: Record<string, unknown> }
}

describe('Node host elicitation', () => {
  test('standalone spawnHostedContext uses its own handler', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [fixture('elicitation-server.mjs')],
      protocolVersion: '2025-11-25',
      elicit: ({ params }) => {
        expect(params.message).toBe('Please provide a value')
        return { action: 'accept', content: { answer: 'standalone' } }
      },
    })

    const result = await context.client.callTool({ name: 'ask', arguments: {} })

    expect(resultData(result)).toEqual({
      elicitationCapability: true,
      response: { action: 'accept', content: { answer: 'standalone' } },
    })
    await context.disposer.dispose()
  })

  test('standalone spawnHostedContext without handler declares no capability', async () => {
    const context = await spawnHostedContext({
      command: process.execPath,
      args: [fixture('elicitation-server.mjs')],
      protocolVersion: '2025-11-25',
    })

    const result = await context.client.callTool({ name: 'ask', arguments: {} })

    expect(resultData(result).elicitationCapability).toBe(false)
    await context.disposer.dispose()
  })

  test('NodeContextHost stdio uses its key-bound handler', async () => {
    const host = new NodeContextHost({
      elicit: ({ key }) => {
        expect(key).toBe('stdio')
        return { action: 'accept', content: { answer: key } }
      },
    })
    await host.addLocalContext({
      key: 'stdio',
      command: process.execPath,
      args: [fixture('elicitation-server.mjs')],
      protocolVersion: '2025-11-25',
    })

    const result = await host.callTool({ key: 'stdio', name: 'ask', arguments: {} })

    expect(resultData(result).response).toEqual({
      action: 'accept',
      content: { answer: 'stdio' },
    })
    await host.dispose()
  })

  test('NodeContextHost stdio opts out', async () => {
    const host = new NodeContextHost({ elicit: true })
    await host.addLocalContext({
      key: 'stdio-opt-out',
      command: process.execPath,
      args: [fixture('elicitation-server.mjs')],
      protocolVersion: '2025-11-25',
      elicit: false,
    })

    const result = await host.callTool({ key: 'stdio-opt-out', name: 'ask', arguments: {} })

    expect(resultData(result).elicitationCapability).toBe(false)
    await host.dispose()
  })

  test('ProxyHost forDaemon installs the host handler', async () => {
    let server: ReadableStreamDefaultController<unknown>
    let toolCallID: string | number
    const channel = {
      readable: new ReadableStream<unknown>({
        start(controller) {
          server = controller
        },
      }),
      writable: new WritableStream<unknown>({
        write(value) {
          const message = value as { id?: string | number; method?: string; result?: unknown }
          if (message.method === 'initialize') {
            server.enqueue({
              jsonrpc: '2.0',
              id: message.id,
              result: {
                protocolVersion: '2025-11-25',
                capabilities: { tools: {} },
                serverInfo: { name: 'daemon-fixture', version: '1.0.0' },
              },
            })
          } else if (message.method === 'tools/call') {
            toolCallID = message.id as string | number
            server.enqueue({
              jsonrpc: '2.0',
              id: 'elicitation-1',
              method: 'elicitation/create',
              params: {
                message: 'Please provide a value',
                requestedSchema: { type: 'object', properties: { answer: { type: 'string' } } },
              },
            })
          } else if (message.id === 'elicitation-1') {
            server.enqueue({
              jsonrpc: '2.0',
              id: toolCallID,
              result: {
                content: [{ type: 'text', text: JSON.stringify({ response: message.result }) }],
              },
            })
          }
        },
      }),
      close: vi.fn(),
    }
    const client = { dispose: vi.fn(), createChannel: vi.fn(() => channel) }
    vi.mocked(runDaemon).mockResolvedValue(client as never)
    const requests: Array<string> = []

    const host = await ProxyHost.forDaemon({
      socketPath: '/tmp/mokei-elicitation.sock',
      elicit: ({ key }) => {
        requests.push(key)
        return { action: 'accept', content: { answer: key } }
      },
    })

    expect(runDaemon).toHaveBeenCalledWith({ socketPath: '/tmp/mokei-elicitation.sock' })
    expect(host.elicitationEnabled).toBe(true)
    const context = await host.spawn({
      key: 'daemon-context',
      command: process.execPath,
      protocolVersion: '2025-11-25',
    })
    await context.initialize()
    const result = await context.callTool({ name: 'ask', arguments: {} })
    expect(requests).toEqual(['daemon-context'])
    expect(resultData(result).response).toEqual({
      action: 'accept',
      content: { answer: 'daemon-context' },
    })
    await host.dispose()
  })

  test('ProxyHost spawn false omits capability and daemon payload', async () => {
    let capturedParam: Record<string, unknown> | undefined
    const writes: Array<unknown> = []
    const pair = {
      readable: new ReadableStream<unknown>({ start: (controller) => controller.close() }),
      writable: new WritableStream<unknown>({
        write: (message) => {
          writes.push(message)
        },
      }),
    }
    const channel = Object.assign(pair, { close: vi.fn() })
    const client = {
      dispose: vi.fn(),
      createChannel: vi.fn((_procedure: string, config: { param: Record<string, unknown> }) => {
        capturedParam = config.param
        return channel
      }),
    }
    const host = new ProxyHost({ client: client as never, elicit: true })

    const context = await host.spawn({
      key: 'daemon-context',
      command: process.execPath,
      elicit: false,
      protocolVersion: '2025-11-25',
    })

    expect(capturedParam?.command).toBe(process.execPath)
    expect(capturedParam).not.toHaveProperty('elicit')
    await expect(context.initialize()).rejects.toThrow()
    const initialize = writes.find(
      (message) => (message as { method?: string }).method === 'initialize',
    ) as { params: { capabilities: { elicitation?: unknown } } } | undefined
    expect(initialize?.params.capabilities.elicitation).toBeUndefined()
    await host.dispose()
  })
})
