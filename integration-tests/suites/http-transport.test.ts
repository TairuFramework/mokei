import { HTTPTransport } from '@mokei/http-client'
import type { ClientTransport } from '@mokei/context-client'
import { ContextClient } from '@mokei/context-client'
import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { serveHTTP } from '@mokei/http-server'
import { afterEach, describe, expect, test } from 'vitest'

const SERVER_CONFIG: ServerConfig = {
  name: 'integration-test',
  version: '1.0.0',
  tools: {
    echo: {
      description: 'Echo input',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
      },
      handler: async ({ arguments: args }) => ({
        content: [{ type: 'text', text: (args as { text: string }).text }],
      }),
    },
  },
}

describe('HTTP transport end-to-end', () => {
  let serverResult: ReturnType<typeof serveHTTP> | null = null
  let client: ContextClient | null = null

  afterEach(async () => {
    if (client != null) {
      await client.dispose()
      client = null
    }
    if (serverResult != null) {
      serverResult.dispose()
      serverResult = null
    }
  })

  test('full session lifecycle over HTTP', async () => {
    serverResult = serveHTTP({
      createServer: (transport) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0,
      hostname: '127.0.0.1',
    })

    // Wait for the server to start listening
    await new Promise<void>((resolve) => {
      if (serverResult!.server.listening) {
        resolve()
      } else {
        serverResult!.server.on('listening', resolve)
      }
    })

    const address = serverResult.server.address() as { port: number }
    const url = `http://127.0.0.1:${address.port}/mcp`

    const transport = new HTTPTransport({ url })
    client = new ContextClient({ transport: transport as ClientTransport })

    // Initialize
    const initResult = await client.initialize()
    expect(initResult.serverInfo.name).toBe('integration-test')
    expect(initResult.serverInfo.version).toBe('1.0.0')

    // List tools
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('echo')

    // Call tool
    const result = await client.callTool({ name: 'echo', arguments: { text: 'hello world' } })
    expect(result.content).toEqual([{ type: 'text', text: 'hello world' }])
  })
})
