import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { describe, expect, test } from 'vitest'

import { createHTTPHandler, type HTTPHandlerParams } from '../src/handler.js'

const SERVER_CONFIG: ServerConfig = {
  name: 'stateless-test-server',
  version: '1.0.0',
  protocolVersions: ['2026-07-28', '2025-11-25'],
  tools: {
    echo: {
      description: 'Echo input',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      handler: async ({ input }) => ({
        content: [{ type: 'text', text: (input as { text: string }).text }],
      }),
    },
  },
}

function createHandler(overrides?: Partial<HTTPHandlerParams>) {
  return createHTTPHandler({
    createServer: (transport) => new ContextServer({ ...SERVER_CONFIG, transport }),
    ...overrides,
  })
}

/** A `2026-07-28` request: protocol `_meta` on the params, no session header. */
function statelessRequest(
  method: string,
  params: Record<string, unknown> = {},
  requestID: string | number = 1,
  version = '2026-07-28',
): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': version,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestID,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': version,
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
        },
      },
    }),
  })
}

/** Collect the `data:` payloads of an SSE response body, ignoring priming events. */
async function readSSEData(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text()
  const out: Array<Record<string, unknown>> = []
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6)
        if (payload.trim() !== '') {
          out.push(JSON.parse(payload) as Record<string, unknown>)
        }
      }
    }
  }
  return out
}

describe('stateless 2026-07-28 POST path', () => {
  test('answers tools/list without a session', async () => {
    const handler = createHandler()
    try {
      const response = await handler.handleRequest(statelessRequest('tools/list'))

      expect(response.status).toBe(200)
      expect(response.headers.get('Mcp-Session-Id')).toBeNull()
      expect(response.headers.get('Content-Type')).toContain('text/event-stream')

      const messages = await readSSEData(response)
      expect(messages).toHaveLength(1)
      const result = messages[0].result as Record<string, unknown>
      expect(result.resultType).toBe('complete')
      expect(result.tools).toEqual([expect.objectContaining({ name: 'echo' })])
    } finally {
      handler.dispose()
    }
  })

  test('answers tools/call without a session', async () => {
    const handler = createHandler()
    try {
      const response = await handler.handleRequest(
        statelessRequest('tools/call', { name: 'echo', arguments: { text: 'hi' } }, 7),
      )

      expect(response.status).toBe(200)
      const messages = await readSSEData(response)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(7)
      const result = messages[0].result as Record<string, unknown>
      expect(result.content).toEqual([{ type: 'text', text: 'hi' }])
    } finally {
      handler.dispose()
    }
  })

  test('two concurrent exchanges reusing the same request id do not cross', async () => {
    const handler = createHandler()
    try {
      const [first, second] = await Promise.all([
        handler.handleRequest(
          statelessRequest('tools/call', { name: 'echo', arguments: { text: 'first' } }, 1),
        ),
        handler.handleRequest(
          statelessRequest('tools/call', { name: 'echo', arguments: { text: 'second' } }, 1),
        ),
      ])

      const [firstMessages, secondMessages] = await Promise.all([
        readSSEData(first),
        readSSEData(second),
      ])
      const texts = [firstMessages, secondMessages].map(
        (messages) => (messages[0].result as { content: Array<{ text: string }> }).content[0].text,
      )
      expect(texts.sort()).toEqual(['first', 'second'])
    } finally {
      handler.dispose()
    }
  })

  test('a client disconnect tears the exchange down', async () => {
    // The tool blocks until the test releases it, so the exchange is unambiguously still in
    // flight — nothing has been written back — when the client hangs up.
    let releaseTool!: () => void
    const toolGate = new Promise<void>((resolve) => {
      releaseTool = resolve
    })
    const servers: Array<ContextServer> = []
    let serverCreated!: () => void
    const created = new Promise<void>((resolve) => {
      serverCreated = resolve
    })

    const handler = createHTTPHandler({
      createServer: (transport) => {
        const server = new ContextServer({
          ...SERVER_CONFIG,
          tools: {
            block: {
              description: 'Block until released',
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              handler: async () => {
                await toolGate
                return { content: [{ type: 'text', text: 'released' }] }
              },
            },
          },
          transport,
        })
        servers.push(server)
        serverCreated()
        return server
      },
    })

    try {
      const abort = new AbortController()
      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'block',
            arguments: {},
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
        signal: abort.signal,
      })

      const responsePromise = handler.handleRequest(request)
      // Only hang up once the exchange has really started, so the abort cannot race the
      // body read.
      await created
      abort.abort()

      // Without the disconnect wiring this promise stays pending until the 30s timeout, so
      // both assertions below hang rather than fail.
      const response = await responsePromise
      expect(response.status).toBe(503)
      expect(servers).toHaveLength(1)
      await servers[0].disposed
      expect(servers[0].signal.aborted).toBe(true)
    } finally {
      releaseTool()
      handler.dispose()
    }
  })

  test('a 2025-11-25 request stamped with protocol _meta stays on its session', async () => {
    // Counting server constructions is what makes this test decisive: the session path
    // builds exactly one server, at initialize, and reuses it. The stateless path builds a
    // throwaway one per request, so routing this request statelessly would make it two.
    let serversCreated = 0
    const handler = createHTTPHandler({
      createServer: (transport) => {
        serversCreated++
        return new ContextServer({ ...SERVER_CONFIG, transport })
      },
    })
    try {
      const initialize = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        }),
      )
      const sessionID = initialize.headers.get('Mcp-Session-Id')
      expect(sessionID).not.toBeNull()

      // `2025-11-25` does not require per-request `_meta`, but nothing stops a client from
      // stamping the key. Such a request must keep being served by its session rather than
      // being pulled onto a throwaway server that knows nothing about it.
      const response = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'Mcp-Session-Id': sessionID as string,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'echo',
              arguments: { text: 'session' },
              _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-11-25' },
            },
          }),
        }),
      )

      expect(response.status).toBe(200)
      const messages = await readSSEData(response)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(2)
      const result = messages[0].result as Record<string, unknown>
      expect(result.content).toEqual([{ type: 'text', text: 'session' }])
      expect(serversCreated).toBe(1)
    } finally {
      handler.dispose()
    }
  })

  test('leaves the 2025-11-25 session path alone', async () => {
    const handler = createHandler()
    try {
      // No protocol `_meta`, method `initialize`: must still mint a session.
      const response = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        }),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('Mcp-Session-Id')).not.toBeNull()
    } finally {
      handler.dispose()
    }
  })
})
