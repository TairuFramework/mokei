import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { afterEach, describe, expect, test } from 'vitest'

import { serveHTTP } from '../src/serve.js'

const SERVER_CONFIG: ServerConfig = {
  name: 'test-server',
  version: '1.0.0',
  protocolVersions: ['2025-11-25'],
  tools: {
    echo: {
      description: 'Echo input',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
      },
      handler: async ({ input: args }) => ({
        content: [{ type: 'text', text: (args as { text: string }).text }],
      }),
    },
  },
}

describe('serveHTTP', () => {
  let server: Awaited<ReturnType<typeof serveHTTP>> | null = null

  afterEach(async () => {
    await server?.dispose()
    server = null
  })

  test('creates a server with handler and dispose', async () => {
    server = await serveHTTP({
      createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0,
      hostname: '127.0.0.1',
    })

    expect(Number(new URL(server.server.url).port)).toBeGreaterThan(0)
    expect((await fetch(`${server.server.url}/mcp`)).status).toBe(400)
    expect(server.handler).toBeDefined()
    expect(server.dispose).toBeTypeOf('function')
  })

  test('routes GET and DELETE to the handler', async () => {
    server = await serveHTTP({
      createServer: ({ transport }) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0,
    })

    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(`${server.server.url}/mcp`, { method })
      expect(response.status).toBe(400)
      expect(await response.text()).toBe('Mcp-Session-Id header required')
    }
  })
})
