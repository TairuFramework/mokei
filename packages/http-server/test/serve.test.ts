import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { afterEach, describe, expect, test } from 'vitest'

import { serveHTTP } from '../src/serve.js'

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

describe('serveHTTP', () => {
  let server: ReturnType<typeof serveHTTP> | null = null

  afterEach(() => {
    server?.dispose()
    server = null
  })

  test('creates a server with handler and dispose', () => {
    server = serveHTTP({
      createServer: (transport) => new ContextServer({ ...SERVER_CONFIG, transport }),
      port: 0,
      hostname: '127.0.0.1',
    })

    expect(server.handler).toBeDefined()
    expect(server.dispose).toBeTypeOf('function')
  })
})
