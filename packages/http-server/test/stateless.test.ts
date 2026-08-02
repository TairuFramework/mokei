import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { describe, expect, test, vi } from 'vitest'

import {
  createHTTPHandler,
  DEFAULT_MAX_STATELESS_EXCHANGES,
  type HTTPHandler,
  type HTTPHandlerParams,
} from '../src/handler.js'

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
  signal?: AbortSignal,
): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    signal,
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

/** The same, for a notification: stamped `_meta`, no `id`, so no reply is expected. */
function statelessNotification(method: string, params: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2026-07-28',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
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

type BlockingHarness = {
  handler: HTTPHandler
  /** Every throwaway server the handler built, in construction order. */
  servers: Array<ContextServer>
  /** Resolves once the first server has been constructed. */
  created: Promise<void>
  releaseTool: () => void
}

/**
 * A handler whose only tool blocks until the test releases it, so an exchange can be
 * inspected while it is unambiguously still in flight with nothing written back yet.
 */
function createBlockingHandler(overrides?: Partial<HTTPHandlerParams>): BlockingHarness {
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
    ...overrides,
  })

  return { handler, servers, created, releaseTool }
}

/** A `2026-07-28` `tools/call` against the blocking tool. */
function blockingRequest(signal?: AbortSignal): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    signal,
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
  })
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
    const { handler, servers, created, releaseTool } = createBlockingHandler()
    try {
      const abort = new AbortController()
      const responsePromise = handler.handleRequest(blockingRequest(abort.signal))
      // Only hang up once the exchange has really started, so the abort cannot race the
      // body read.
      await created
      abort.abort()

      // Without the disconnect wiring this promise stays pending until the 30s timeout, so
      // the assertions below hang rather than fail.
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

  test('disposing the handler ends an in-flight exchange', async () => {
    // A short stateless timeout keeps the failure fast if the shutdown drain is missing:
    // the exchange then settles 504 on its own instead of leaving the assertion to hang
    // out to the 30s default.
    const { handler, servers, created, releaseTool } = createBlockingHandler({
      statelessTimeoutMs: 200,
    })
    try {
      const responsePromise = handler.handleRequest(blockingRequest())
      await created

      handler.dispose()

      const response = await responsePromise
      expect(response.status).toBe(503)
      expect(servers).toHaveLength(1)
      // The throwaway server must go down with the handler, not linger until its client
      // disconnects or its timer expires.
      await servers[0].disposed
      expect(servers[0].signal.aborted).toBe(true)
    } finally {
      releaseTool()
    }
  })

  describe('concurrency cap', () => {
    // The blocking tool writes nothing until released, so its exchange never opens an SSE
    // response — `handleRequest` stays pending. What marks it as in flight is the throwaway
    // server being built, which is the same synchronous step that registers its teardown, so
    // counting `servers` is how these tests wait for the cap to be occupied.
    const untilInFlight = (servers: Array<ContextServer>, count: number): Promise<void> => {
      return vi.waitFor(() => {
        expect(servers).toHaveLength(count)
      })
    }

    // `maxSessions` does not reach a stateless exchange, and `statelessTimeoutMs` is no
    // substitute: its timer is cleared by the first thing the server writes, so a tool that
    // streams once and then blocks holds its throwaway `ContextServer` for as long as the
    // caller keeps reading. Without a cap, that is unbounded.
    test('refuses past the cap and admits again once an exchange completes', async () => {
      const { handler, servers, releaseTool } = createBlockingHandler({
        maxStatelessExchanges: 1,
      })
      try {
        const inFlight = handler.handleRequest(blockingRequest())
        await untilInFlight(servers, 1)

        const refused = await handler.handleRequest(blockingRequest())
        expect(refused.status).toBe(503)
        expect(refused.headers.get('Retry-After')).toBe('1')
        expect(await refused.text()).toBe('Too many stateless exchanges')
        // Refused *before* dispatch: no second throwaway server was stood up for it.
        expect(servers).toHaveLength(1)

        // Releasing the tool lets the first exchange answer and free its slot.
        releaseTool()
        await (await inFlight).text()

        const admitted = await handler.handleRequest(statelessRequest('tools/list'))
        expect(admitted.status).toBe(200)
        await admitted.text()
      } finally {
        releaseTool()
        handler.dispose()
      }
    })

    test('the default cap applies when the option is omitted', async () => {
      // The default has to be wired, not merely exported: a handler built without the option
      // must still refuse past it.
      expect(DEFAULT_MAX_STATELESS_EXCHANGES).toBe(100)
      const { handler, servers, releaseTool } = createBlockingHandler()
      const pending: Array<Promise<Response>> = []
      try {
        for (let index = 0; index < DEFAULT_MAX_STATELESS_EXCHANGES; index++) {
          pending.push(handler.handleRequest(blockingRequest()))
        }
        await untilInFlight(servers, DEFAULT_MAX_STATELESS_EXCHANGES)

        const refused = await handler.handleRequest(blockingRequest())
        expect(refused.status).toBe(503)
        expect(refused.headers.get('Retry-After')).toBe('1')
        expect(servers).toHaveLength(DEFAULT_MAX_STATELESS_EXCHANGES)
      } finally {
        releaseTool()
        await Promise.all(pending.map(async (response) => await (await response).text()))
        handler.dispose()
      }
    })
  })

  // A client on this revision stamps its outgoing notifications with the protocol version, so a
  // sessionless `notifications/cancelled` POST routes statelessly and is acknowledged instead of
  // falling through to `400` the way an unstamped one does. That is server-observable behaviour,
  // and the `requestID == null` branch it lands on had no coverage of its own.
  test('acknowledges a stamped notification on a sessionless POST without dispatching it', async () => {
    const servers: Array<ContextServer> = []
    const handler = createHTTPHandler({
      createServer: (transport) => {
        const server = new ContextServer({ ...SERVER_CONFIG, transport })
        servers.push(server)
        return server
      },
    })
    try {
      const response = await handler.handleRequest(
        statelessNotification('notifications/cancelled', { requestId: 1 }),
      )

      expect(response.status).toBe(202)
      expect(await response.text()).toBe('')
      // The exchange is stood up before the missing id is noticed, so one throwaway server is
      // still built — and it is torn down with the acknowledgement rather than left holding
      // the connection open for a reply that is never coming.
      expect(servers).toHaveLength(1)
      await servers[0].disposed
      expect(servers[0].signal.aborted).toBe(true)
    } finally {
      handler.dispose()
    }
  })

  test('an already-aborted request short-circuits before anything is built', async () => {
    let serversCreated = 0
    const handler = createHTTPHandler({
      createServer: (transport) => {
        serversCreated++
        return new ContextServer({ ...SERVER_CONFIG, transport })
      },
    })
    try {
      const abort = new AbortController()
      abort.abort()

      const response = await handler.handleRequest(
        statelessRequest('tools/list', {}, 1, '2026-07-28', abort.signal),
      )

      expect(response.status).toBe(499)
      // Load-bearing: the point of the short-circuit is that no server, transport or timer
      // is stood up for a client that has already gone.
      expect(serversCreated).toBe(0)
    } finally {
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

  test('rejects a header that contradicts the request _meta', async () => {
    const handler = createHandler()
    try {
      const body = await statelessRequest('tools/list').json()
      const response = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // The body's `_meta` says 2026-07-28; the header says otherwise.
            'MCP-Protocol-Version': '2025-11-25',
          },
          body: JSON.stringify(body),
        }),
      )
      expect(response.status).toBe(400)
      // Asserted on the mismatch wording, not on the header name: the neighbouring
      // `Unsupported MCP-Protocol-Version` rejection is also a `400` naming the header, so a
      // looser assertion would pass even if the wrong one of the two answered.
      expect(await response.text()).toContain('does not match')
    } finally {
      handler.dispose()
    }
  })

  test('accepts a request whose _meta version is present and header absent', async () => {
    const handler = createHandler()
    try {
      const body = await statelessRequest('tools/list').json()
      const response = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
      expect(response.status).toBe(200)
    } finally {
      handler.dispose()
    }
  })

  test('surfaces an unsupported revision as 400 with the JSON-RPC error body', async () => {
    // A server that serves only 2025-11-25, asked for 2026-07-28.
    const handler = createHTTPHandler({
      createServer: (transport) =>
        new ContextServer({ ...SERVER_CONFIG, protocolVersions: ['2025-11-25'], transport }),
    })
    try {
      const response = await handler.handleRequest(statelessRequest('tools/list'))

      expect(response.status).toBe(400)
      expect(response.headers.get('Content-Type')).toContain('application/json')
      const body = (await response.json()) as {
        id: number
        error: { code: number; data: { supported: Array<string>; requested: string } }
      }
      expect(body.id).toBe(1)
      expect(body.error.code).toBe(-32022)
      expect(body.error.data.supported).toEqual(['2025-11-25'])
      expect(body.error.data.requested).toBe('2026-07-28')
    } finally {
      handler.dispose()
    }
  })

  test('surfaces missing required _meta as 400 with the JSON-RPC error body', async () => {
    const handler = createHandler()
    try {
      const response = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'MCP-Protocol-Version': '2026-07-28',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/list',
            params: {
              // Declares the revision but omits the required client capabilities.
              _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
            },
          }),
        }),
      )

      expect(response.status).toBe(400)
      const body = (await response.json()) as { error: { code: number; message: string } }
      expect(body.error.code).toBe(-32602)
      expect(body.error.message).toContain('clientCapabilities')
    } finally {
      handler.dispose()
    }
  })

  test('a tool error still comes back as 200 on the SSE stream', async () => {
    const handler = createHandler()
    try {
      const response = await handler.handleRequest(
        statelessRequest('tools/call', { name: 'nope', arguments: {} }, 9),
      )
      // Only the specification's `400` codes get an HTTP status; everything else is a
      // normal JSON-RPC error inside a normal response.
      expect(response.status).toBe(200)
      const messages = await readSSEData(response)
      expect((messages[0].error as { code: number }).code).toBe(-32602)
    } finally {
      handler.dispose()
    }
  })

  test('a tool named like a _meta key does not buy itself a 400', async () => {
    const handler = createHandler()
    try {
      const response = await handler.handleRequest(
        statelessRequest(
          'tools/call',
          // The unknown tool's name is echoed into the error message verbatim. Classifying
          // on a substring would let this request choose its own HTTP status.
          { name: 'io.modelcontextprotocol/x', arguments: {} },
          11,
        ),
      )
      expect(response.status).toBe(200)
      const messages = await readSSEData(response)
      expect((messages[0].error as { code: number }).code).toBe(-32602)
    } finally {
      handler.dispose()
    }
  })

  test('GET is 405 for 2026-07-28', async () => {
    const handler = createHandler()
    try {
      const response = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'MCP-Protocol-Version': '2026-07-28',
          },
        }),
      )
      expect(response.status).toBe(405)
    } finally {
      handler.dispose()
    }
  })

  test('DELETE is 405 for 2026-07-28', async () => {
    const handler = createHandler()
    try {
      const response = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'DELETE',
          headers: { 'MCP-Protocol-Version': '2026-07-28' },
        }),
      )
      expect(response.status).toBe(405)
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
