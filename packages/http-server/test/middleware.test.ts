import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { Hono } from 'hono'
import { describe, expect, test } from 'vitest'

import { mcpHTTPMiddleware } from '../src/middleware.js'

const SERVER_CONFIG: ServerConfig = {
  name: 'test-server',
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

describe('mcpHTTPMiddleware', () => {
  test('handles MCP initialize through Hono app', async () => {
    const { middleware, dispose } = mcpHTTPMiddleware({
      createServer: (transport) => new ContextServer({ ...SERVER_CONFIG, transport }),
    })

    try {
      const app = new Hono()
      app.all('/mcp/*', middleware)

      const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(response.headers.get('Mcp-Session-Id')).toBeTruthy()
    } finally {
      dispose()
    }
  })
})
