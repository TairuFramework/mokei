import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { META_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { isSessionExpiredCode, SESSION_EXPIRED_CODE } from '../src/errors.js'
import { HTTPTransport } from '../src/transport.js'

type ErrorFrame = { id?: string | number; error?: { code?: number; message?: string } }

// --- Test helpers ---

function jsonResponse(body: unknown, headers?: Record<string, string>): Response {
  const responseHeaders = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  })
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: responseHeaders,
  })
}

function acceptedResponse(): Response {
  return new Response(null, { status: 202 })
}

function sseResponse(
  events: Array<{ data: string; id?: string; retry?: number }>,
  headers?: Record<string, string>,
): Response {
  let body = ''
  for (const event of events) {
    if (event.id != null) {
      body += `id: ${event.id}\n`
    }
    if (event.retry != null) {
      body += `retry: ${event.retry}\n`
    }
    body += `data: ${event.data}\n\n`
  }

  const responseHeaders = new Headers({
    'Content-Type': 'text/event-stream',
    ...headers,
  })

  return new Response(body, {
    status: 200,
    headers: responseHeaders,
  })
}

function errorResponse(status: number, text: string): Response {
  return new Response(text, { status })
}

// --- Fixtures ---

const TEST_URL = 'http://localhost:3000/mcp'

// The shared handshake fixtures name `2025-11-25` explicitly rather than tracking
// `LATEST_PROTOCOL_VERSION`. Sessions, the GET notification stream and the terminating DELETE
// all belong to the revision that keeps the `initialize`/`initialized` handshake, so a suite
// that negotiates the latest revision and then exercises them would encode a connection no
// server can serve.
const initializeRequest: ClientMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0' },
  },
} as ClientMessage

const initializeResult: ServerMessage = {
  jsonrpc: '2.0',
  id: 1,
  result: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    serverInfo: { name: 'test-server', version: '1.0' },
  },
} as ServerMessage

const initializedNotification: ClientMessage = {
  jsonrpc: '2.0',
  method: 'notifications/initialized',
} as ClientMessage

const pingRequest: ClientMessage = {
  jsonrpc: '2.0',
  id: 2,
  method: 'ping',
} as ClientMessage

const pingResult: ServerMessage = {
  jsonrpc: '2.0',
  id: 2,
  result: {},
} as ServerMessage

/** Protocol `_meta` a `2026-07-28` client puts on every request. */
const requestMeta20260728 = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
}

function request20260728(id: number): ClientMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/list',
    params: { _meta: { ...requestMeta20260728 } },
  } as ClientMessage
}

const progressNotification: ClientMessage = {
  jsonrpc: '2.0',
  method: 'notifications/progress',
  params: {
    progressToken: 'tok',
    progress: 50,
    total: 100,
  },
} as ClientMessage

// --- Fetch call helpers ---

type FetchCall = [
  string,
  { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
]

function findCallByMethod(calls: Array<Array<unknown>>, method: string): FetchCall | undefined {
  return calls.find((call) => (call[1] as RequestInit).method === method) as FetchCall | undefined
}

function getCallByMethod(calls: Array<Array<unknown>>, method: string): FetchCall {
  const call = findCallByMethod(calls, method)
  if (!call) {
    throw new Error(`No ${method} call found`)
  }
  return call
}

// --- Tests ---

describe('HTTPTransport', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST sends correct headers and body', () => {
    test('sends Content-Type and Accept headers', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(initializeResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe(TEST_URL)
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Type']).toBe('application/json')
      expect(options.headers.Accept).toBe('application/json, text/event-stream')
      expect(JSON.parse(options.body)).toEqual(initializeRequest)

      await transport.dispose()
    })
  })

  describe('negotiated MCP-Protocol-Version header', () => {
    test('after initialize, requests send the negotiated MCP-Protocol-Version', async () => {
      // A version no fixture and no constant in this file mentions, so the header can only
      // have come from the initialize response.
      const negotiatedVersion = '2024-11-05'
      const negotiatedInitResult: ServerMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: negotiatedVersion,
          capabilities: {},
          serverInfo: { name: 'test-server', version: '1.0' },
        },
      } as ServerMessage

      fetchMock.mockResolvedValueOnce(
        jsonResponse(negotiatedInitResult, { 'Mcp-Session-Id': 'session-neg' }),
      )
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })

      // The initialize POST carries no version: nothing has told the transport which
      // revision it speaks yet, and the request itself does not declare one.
      await transport.write(initializeRequest)
      await transport.read()
      expect(fetchMock.mock.calls[0][1].headers['MCP-Protocol-Version']).toBeUndefined()

      // A subsequent request must use the negotiated version captured from the initialize response
      await transport.write(pingRequest)
      expect(fetchMock.mock.calls[1][1].headers['MCP-Protocol-Version']).toBe(negotiatedVersion)

      await transport.dispose()
    })
  })

  describe('MCP-Protocol-Version header', () => {
    test('is omitted before any revision is known', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(initializeResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)

      expect(fetchMock.mock.calls[0][1].headers['MCP-Protocol-Version']).toBeUndefined()

      await transport.dispose()
    })

    test('uses the constructor seed before any revision is known', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(initializeResult))

      const transport = new HTTPTransport({ url: TEST_URL, protocolVersionHeader: '2024-11-05' })
      await transport.write(initializeRequest)

      expect(fetchMock.mock.calls[0][1].headers['MCP-Protocol-Version']).toBe('2024-11-05')

      await transport.dispose()
    })

    test('is taken from the request _meta on 2026-07-28', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))

      expect(fetchMock.mock.calls[0][1].headers['MCP-Protocol-Version']).toBe('2026-07-28')

      await transport.dispose()
    })

    test('the request _meta wins over the negotiated version', async () => {
      // A single transport may carry both revisions. The version a message declares must
      // describe that message, never the last handshake the transport happened to see.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            serverInfo: { name: 'test-server', version: '1.0' },
          },
        }),
      )
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()
      await transport.write(request20260728(2))

      expect(fetchMock.mock.calls[1][1].headers['MCP-Protocol-Version']).toBe('2026-07-28')

      await transport.dispose()
    })

    test('no session header is sent on a 2026-07-28 request', async () => {
      // The server hands back a session id anyway; the transport must not echo it on a
      // request that declares a revision without sessions.
      fetchMock.mockResolvedValueOnce(
        jsonResponse(pingResult, { 'Mcp-Session-Id': 'leaked-session' }),
      )
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))
      await transport.write(request20260728(2))

      expect(fetchMock.mock.calls[1][1].headers['Mcp-Session-Id']).toBeUndefined()

      await transport.dispose()
    })

    test('a 2025-11-25 request on the same transport keeps its session header', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            jsonrpc: '2.0',
            id: 1,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              serverInfo: { name: 'test-server', version: '1.0' },
            },
          },
          { 'Mcp-Session-Id': 'session-kept' },
        ),
      )
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()
      await transport.write(request20260728(3))
      await transport.write(pingRequest)

      expect(fetchMock.mock.calls[1][1].headers['Mcp-Session-Id']).toBeUndefined()
      expect(fetchMock.mock.calls[2][1].headers['Mcp-Session-Id']).toBe('session-kept')

      await transport.dispose()
    })

    test('never opens a GET stream or sends Last-Event-ID on 2026-07-28', async () => {
      // The first response is an SSE stream carrying an event id, so the transport really
      // does hold a `#lastEventID` by the time the later requests go out. Without it the
      // `Last-Event-ID` assertion below would be vacuous: there would be nothing to resume
      // from, and any resumption code added to the POST path would still find nothing to send.
      fetchMock.mockImplementationOnce(async () =>
        sseResponse([{ data: JSON.stringify(pingResult), id: 'evt-1' }]),
      )
      fetchMock.mockImplementation(async () => jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))
      // Reading the streamed message proves the SSE handler ran, which is what records the
      // event id — it does so before enqueuing.
      await transport.read()
      expect(transport.lastEventID).toBe('evt-1')
      for (const id of [2, 3]) {
        await transport.write(request20260728(id))
      }

      // The GET reconnect loop and `Last-Event-ID` resumption belong to a session, which
      // this revision never has. Nothing should have opened one.
      const calls = fetchMock.mock.calls as Array<FetchCall>
      // `every` is vacuously true over an empty list; pin the count so a transport that
      // stopped sending altogether cannot pass.
      expect(calls.length).toBe(3)
      expect(calls.every((call) => call[1].method === 'POST')).toBe(true)
      expect(calls.every((call) => call[1].headers['Last-Event-ID'] == null)).toBe(true)

      await transport.dispose()
    })
  })

  describe('JSON response handling', () => {
    test('enqueues parsed JSON response to readable stream', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(initializeResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)

      const { value } = await transport.read()
      expect(value).toEqual(initializeResult)

      await transport.dispose()
    })
  })

  describe('202 Accepted response', () => {
    test('does not enqueue anything for 202 responses', async () => {
      // First send initialize to set things up
      fetchMock.mockResolvedValueOnce(
        jsonResponse(initializeResult, { 'Mcp-Session-Id': 'session-1' }),
      )
      // Then send a notification that returns 202
      fetchMock.mockResolvedValueOnce(acceptedResponse())

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      const { value } = await transport.read()
      expect(value).toEqual(initializeResult)

      // Write a notification - should get 202 back, no enqueue
      await transport.write(progressNotification)

      // Verify no additional message was enqueued by writing another request
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))
      await transport.write(pingRequest)
      const { value: value2 } = await transport.read()
      expect(value2).toEqual(pingResult)

      await transport.dispose()
    })
  })

  describe('HTTP error handling', () => {
    test('routes an HTTP error to an error frame without killing the transport', async () => {
      // The failed POST must reject only its own request, not poison the writable
      // stream — a subsequent request must still succeed.
      fetchMock.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'))
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      // write() resolves now; the failure surfaces as a correlated error frame.
      await transport.write(initializeRequest)

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(1)
      expect(frame.error?.message).toContain('HTTP 500')

      // Transport is still usable.
      await transport.write(pingRequest)
      const { value: value2 } = await transport.read()
      expect(value2).toEqual(pingResult)

      await transport.dispose()
    })

    test('a network failure surfaces as a correlated error frame', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(1)
      expect(frame.error?.message).toContain('ECONNREFUSED')

      // Stream survived the rejected send.
      await transport.write(pingRequest)
      const { value: value2 } = await transport.read()
      expect(value2).toEqual(pingResult)

      await transport.dispose()
    })

    test('404 without an active session surfaces an HTTP 404 error frame', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(404, 'Session not found'))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(1)
      expect(frame.error?.message).toContain('HTTP 404')

      await transport.dispose()
    })

    test('404 with an active session clears it and emits a session-expired error frame', async () => {
      // Arrange: initialize so #sessionID is set
      fetchMock.mockResolvedValueOnce(
        jsonResponse(initializeResult, { 'Mcp-Session-Id': 'session-expired' }),
      )
      // Next POST returns 404 (session gone on server)
      fetchMock.mockResolvedValueOnce(errorResponse(404, 'Session not found'))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()
      expect(transport.sessionID).toBe('session-expired')

      // The post-init request is rejected via a coded error frame, not a thrown write.
      await transport.write(pingRequest)
      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(2)
      expect(frame.error?.code).toBe(SESSION_EXPIRED_CODE)
      expect(isSessionExpiredCode(frame.error?.code)).toBe(true)
      // And: transport.sessionID is now null
      expect(transport.sessionID).toBeNull()

      await transport.dispose()
    })
  })

  describe('non-OK responses carrying a JSON-RPC error', () => {
    test('a 400 with a matching JSON-RPC error is surfaced with its own code and data', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {
              code: -32022,
              message: 'Unsupported protocol version',
              data: { supported: ['2025-11-25'], requested: '2026-07-28' },
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))

      const { value } = await transport.read()
      const frame = value as {
        id?: number
        error?: { code?: number; message?: string; data?: { supported?: Array<string> } }
      }
      expect(frame.id).toBe(1)
      expect(frame.error?.code).toBe(-32022)
      expect(frame.error?.message).toBe('Unsupported protocol version')
      expect(frame.error?.data?.supported).toEqual(['2025-11-25'])

      // The carried error rejects only its own request; the transport stays usable.
      await transport.write(pingRequest)
      const { value: value2 } = await transport.read()
      expect(value2).toEqual(pingResult)

      await transport.dispose()
    })

    // `error.data` is whatever the answering server chose to put there — the SDK types it as
    // `unknown` and JSON-RPC constrains it not at all. `parseJSONRPCError` must therefore accept
    // every shape the RPC layer's inbound validator does, or the frame is *dropped* there rather
    // than rejected and the caller of a `2026-07-28` `tools/call` waits forever, because nothing
    // times an ordinary request out. This half asserts the transport passes the frame through
    // verbatim; that the validator admits the same shapes is asserted in
    // `packages/context-protocol/test/lib.test.ts`, and that the pair does not strand a caller
    // in `packages/context-client/test/lib.test.ts`.
    test.each([
      ['a string', 'only 2025-11-25'],
      ['null', null],
      ['an array', ['2025-11-25']],
      ['a number', 1],
    ])('a 400 whose error.data is %s reaches the caller', async (_label, data) => {
      const carried = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32022, message: 'Unsupported protocol version', data },
      }
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(carried), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))

      const { value } = await transport.read()
      expect(value).toEqual(carried)

      await transport.dispose()
    })

    test('a 400 with an unparseable body still fails the request', async () => {
      // Several of a server's `400` bodies are plain text, not JSON. Parsing must not throw
      // and must not leave the request hanging.
      fetchMock.mockResolvedValueOnce(errorResponse(400, 'Mcp-Session-Id header required'))
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(1)
      expect(frame.error?.code).toBe(-32603)
      expect(frame.error?.message).toContain('HTTP 400')
      expect(frame.error?.message).toContain('Mcp-Session-Id header required')

      await transport.write(pingRequest)
      const { value: value2 } = await transport.read()
      expect(value2).toEqual(pingResult)

      await transport.dispose()
    })

    test('a 400 naming a different request is not routed to this one', async () => {
      // Passing through an error frame whose id belongs to another request would reject the
      // wrong caller and leave this one waiting forever.
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 99,
            error: { code: -32022, message: 'Unsupported protocol version' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(1)
      expect(frame.error?.code).toBe(-32603)
      expect(frame.error?.message).toContain('HTTP 400')

      await transport.dispose()
    })

    // A frame the RPC layer's inbound validator would reject is dropped there, not rejected,
    // and no timeout covers an ordinary request — so enqueuing one strands its caller. Each of
    // these bodies is a valid-looking error frame missing exactly one member that validator
    // requires, and each must come back as the synthesized fallback instead.
    test('a 400 whose error carries no code falls back', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'x' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(1)
      expect(frame.error?.code).toBe(-32603)
      expect(frame.error?.message).toContain('HTTP 400')

      await transport.dispose()
    })

    test('a 400 whose error carries no message falls back', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32022 } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(1)
      expect(frame.error?.code).toBe(-32603)
      expect(frame.error?.message).toContain('HTTP 400')

      await transport.dispose()
    })

    test('a 400 whose body omits jsonrpc falls back', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, error: { code: -32022, message: 'x' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(1)
      expect(frame.error?.code).toBe(-32603)
      expect(frame.error?.message).toContain('HTTP 400')

      await transport.dispose()
    })

    test('a 400 whose JSON body carries no error member falls back', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(request20260728(1))

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(1)
      expect(frame.error?.code).toBe(-32603)
      expect(frame.error?.message).toContain('HTTP 400')

      await transport.dispose()
    })
  })

  describe('session ID management', () => {
    test('captures Mcp-Session-Id from response and sends on subsequent requests', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(initializeResult, { 'Mcp-Session-Id': 'session-abc' }),
      )
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })

      // First request - no session ID yet
      await transport.write(initializeRequest)
      const firstCall = fetchMock.mock.calls[0]
      expect(firstCall[1].headers['Mcp-Session-Id']).toBeUndefined()
      expect(transport.sessionID).toBe('session-abc')

      // Second request - should include session ID
      await transport.write(pingRequest)
      const secondCall = fetchMock.mock.calls[1]
      expect(secondCall[1].headers['Mcp-Session-Id']).toBe('session-abc')

      await transport.dispose()
    })
  })

  describe('dispose sends DELETE', () => {
    test('sends DELETE request with session ID on dispose', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(initializeResult, { 'Mcp-Session-Id': 'session-del' }),
      )
      // DELETE response
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()

      await transport.dispose()

      // Find the DELETE call
      const deleteCall = getCallByMethod(fetchMock.mock.calls, 'DELETE')
      expect(deleteCall[0]).toBe(TEST_URL)
      expect(deleteCall[1].method).toBe('DELETE')
      expect(deleteCall[1].headers['Mcp-Session-Id']).toBe('session-del')
    })

    test('does not send DELETE when no session ID exists', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(initializeResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()

      await transport.dispose()

      // Only the POST call, no DELETE
      const deleteCall = findCallByMethod(fetchMock.mock.calls, 'DELETE')
      expect(deleteCall).toBeUndefined()
    })
  })

  describe('SSE response parsing', () => {
    test('parses SSE events and enqueues messages', async () => {
      const msg1: ServerMessage = { jsonrpc: '2.0', id: 10, result: { tools: [] } } as ServerMessage
      const msg2: ServerMessage = { jsonrpc: '2.0', id: 11, result: { tools: [] } } as ServerMessage

      fetchMock.mockResolvedValueOnce(
        sseResponse([{ data: JSON.stringify(msg1) }, { data: JSON.stringify(msg2) }]),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)

      const { value: v1 } = await transport.read()
      expect(v1).toEqual(msg1)

      const { value: v2 } = await transport.read()
      expect(v2).toEqual(msg2)

      await transport.dispose()
    })

    test('skips empty data in SSE events', async () => {
      const msg1: ServerMessage = { jsonrpc: '2.0', id: 10, result: {} } as ServerMessage

      // Create SSE with an empty data event mixed in
      const body = `data: \n\ndata: ${JSON.stringify(msg1)}\n\n`
      const response = new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
      fetchMock.mockResolvedValueOnce(response)

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)

      const { value } = await transport.read()
      expect(value).toEqual(msg1)

      await transport.dispose()
    })
  })

  describe('streamEvents.closed signal', () => {
    test('emits closed when a POST SSE body ends without a terminal response', async () => {
      const notif: ServerMessage = {
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progressToken: 'tok', progress: 1 },
      } as ServerMessage
      fetchMock.mockResolvedValueOnce(sseResponse([{ data: JSON.stringify(notif) }]))

      const transport = new HTTPTransport({ url: TEST_URL })
      const closed = vi.fn()
      transport.streamEvents.on('closed', closed)

      await transport.write(request20260728(7))
      // The notification itself, correlated to nothing since it carries no matching id.
      await transport.read()

      await vi.waitFor(() => {
        expect(closed).toHaveBeenCalledWith({ requestID: 7 })
      })

      await transport.dispose()
    })

    test('does not emit closed when the SSE body ends right after a terminal response', async () => {
      const result: ServerMessage = { jsonrpc: '2.0', id: 7, result: {} } as ServerMessage
      fetchMock.mockResolvedValueOnce(sseResponse([{ data: JSON.stringify(result) }]))

      const transport = new HTTPTransport({ url: TEST_URL })
      const closed = vi.fn()
      transport.streamEvents.on('closed', closed)

      await transport.write(request20260728(7))
      // The terminal response itself.
      await transport.read()

      // Give the backgrounded SSE consumption a chance to finish (and, incorrectly, emit).
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(closed).not.toHaveBeenCalled()

      await transport.dispose()
    })

    test('does not emit closed for a cancelled exchange whose body then ends', async () => {
      const transport = new HTTPTransport({ url: TEST_URL })
      let sseController!: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sseController = controller
        },
      })
      fetchMock.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        }),
      )
      // The cancellation notification's own POST.
      fetchMock.mockResolvedValueOnce(acceptedResponse())

      const closed = vi.fn()
      transport.streamEvents.on('closed', closed)

      await transport.write(request20260728(7))
      await transport.write({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 7, _meta: { ...requestMeta20260728 } },
      } as ClientMessage)

      // A real server closes the connection once it reads the disconnect this cancel caused.
      sseController.close()

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(closed).not.toHaveBeenCalled()

      await transport.dispose()
    })

    test('does not emit closed for an in-flight exchange when the transport disposes', async () => {
      const transport = new HTTPTransport({ url: TEST_URL })
      let sseController!: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sseController = controller
        },
      })
      fetchMock.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        }),
      )

      const closed = vi.fn()
      transport.streamEvents.on('closed', closed)

      await transport.write(request20260728(7))
      await transport.dispose()

      // Simulate the peer observing dispose's abort and closing its side of the connection.
      sseController.close()

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(closed).not.toHaveBeenCalled()
    })
  })

  describe('SSE response does not serialize outgoing traffic', () => {
    test('a still-streaming SSE response does not block subsequent sends', async () => {
      // First POST returns a long-lived SSE stream that never completes on its own.
      let sseController!: ReadableStreamDefaultController<Uint8Array>
      const sseBody = new ReadableStream<Uint8Array>({
        start(c) {
          sseController = c
        },
      })
      fetchMock.mockResolvedValueOnce(
        new Response(sseBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )
      // Second POST: a 202 for the follow-up cancellation notification.
      fetchMock.mockResolvedValueOnce(acceptedResponse())

      const transport = new HTTPTransport({ url: TEST_URL })

      // A streamed tools/call. With the old await-in-sink behavior this write would
      // not resolve until the SSE stream closed.
      await transport.write({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'x' },
      } as ClientMessage)

      // The cancellation must go out even though the SSE stream is still open.
      await transport.write({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 7 },
      } as ClientMessage)

      expect(fetchMock.mock.calls.length).toBe(2)

      sseController.close()
      await transport.dispose()
    })
  })

  describe('cancellation aborts an in-flight fetch', () => {
    test('a cancellation aborts the in-flight fetch on a stateless revision', async () => {
      const transport = new HTTPTransport({ url: TEST_URL })
      // An SSE body that never ends, so the exchange is still open when the cancel arrives.
      const stream = new ReadableStream<Uint8Array>({ start() {} })
      fetchMock.mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        }),
      )

      await transport.write(request20260728(7))
      const post = getCallByMethod(fetchMock.mock.calls, 'POST')

      await transport.write({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 7, _meta: { ...requestMeta20260728 } },
      } as ClientMessage)

      expect(post[1].signal?.aborted).toBe(true)

      await transport.dispose()
    })

    test('a cancellation does not abort the fetch on a session revision', async () => {
      const transport = new HTTPTransport({ url: TEST_URL })
      const stream = new ReadableStream<Uint8Array>({ start() {} })
      fetchMock.mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        }),
      )

      await transport.write({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/list',
        params: {},
      } as ClientMessage)
      const post = getCallByMethod(fetchMock.mock.calls, 'POST')

      await transport.write({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 8 },
      } as ClientMessage)

      expect(post[1].signal?.aborted).toBe(false)

      await transport.dispose()
    })

    test('cancelling one exchange does not abort a sibling in-flight exchange', async () => {
      const transport = new HTTPTransport({ url: TEST_URL })
      const streamA = new ReadableStream<Uint8Array>({ start() {} })
      const streamB = new ReadableStream<Uint8Array>({ start() {} })
      fetchMock.mockResolvedValueOnce(
        new Response(streamA, {
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        }),
      )
      fetchMock.mockResolvedValueOnce(
        new Response(streamB, {
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        }),
      )
      // The cancellation notification's own POST.
      fetchMock.mockResolvedValueOnce(acceptedResponse())

      await transport.write(request20260728(7))
      await transport.write(request20260728(9))
      const postA = fetchMock.mock.calls[0] as FetchCall
      const postB = fetchMock.mock.calls[1] as FetchCall

      await transport.write({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 9, _meta: { ...requestMeta20260728 } },
      } as ClientMessage)

      expect(postB[1].signal?.aborted).toBe(true)
      expect(postA[1].signal?.aborted).toBe(false)

      await transport.dispose()
    })

    test('a cancellation reclaims its tracking entry once the exchange settles', async () => {
      const transport = new HTTPTransport({ url: TEST_URL })
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

      let sseController!: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sseController = controller
        },
      })
      fetchMock.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        }),
      )
      // Every notifications/cancelled POST below, including the polled retries.
      fetchMock.mockResolvedValue(acceptedResponse())

      await transport.write(request20260728(7))

      await transport.write({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 7, _meta: { ...requestMeta20260728 } },
      } as ClientMessage)
      expect(abortSpy).toHaveBeenCalledTimes(1)

      // A real server closes the connection once it reads the disconnect. Simulate that so the
      // backgrounded SSE consumption settles and reclaims its tracking entry via the same path
      // a normal stream end takes.
      sseController.close()

      // Once reclaimed, a second cancellation naming the same id finds nothing to abort and is
      // a no-op. The reclaim runs on the backgrounded consumption promise, not synchronously
      // with the close() above, so poll for it: each retry resends the cancellation and
      // compares the call count against the previous attempt. A reclaimed entry stops growing
      // the count after at most one race against the in-flight reclaim; a leaked entry (the
      // regression this guards) calls abort() again on every single retry and never stabilizes,
      // so vi.waitFor times out instead of falsely passing.
      let previousCount = abortSpy.mock.calls.length
      await vi.waitFor(async () => {
        await transport.write({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: 7, _meta: { ...requestMeta20260728 } },
        } as ClientMessage)
        const count = abortSpy.mock.calls.length
        const stable = count === previousCount
        previousCount = count
        expect(stable).toBe(true)
      })

      await transport.dispose()
    })

    test('an outgoing response does not clobber a pending request sharing its id', async () => {
      // Both the client's own request ids and a server-initiated request's ids start at 0, so
      // a client *response* to server request 0 must not register (or clear) the exchange
      // tracking entry for the client's own pending request 0.
      const transport = new HTTPTransport({ url: TEST_URL })
      const stream = new ReadableStream<Uint8Array>({ start() {} })
      fetchMock.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        }),
      )
      // The outgoing response's own POST — a 202 with no body, like a real server's ack.
      fetchMock.mockResolvedValueOnce(acceptedResponse())
      // The cancellation notification's own POST.
      fetchMock.mockResolvedValueOnce(acceptedResponse())

      await transport.write(request20260728(0))
      const requestPost = fetchMock.mock.calls[0] as FetchCall

      // The client answering a server-initiated request that happens to reuse id 0, from the
      // server's own id space.
      await transport.write({ jsonrpc: '2.0', id: 0, result: {} } as ClientMessage)

      await transport.write({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 0, _meta: { ...requestMeta20260728 } },
      } as ClientMessage)

      expect(requestPost[1].signal?.aborted).toBe(true)

      await transport.dispose()
    })
  })

  describe('an inbound request does not clobber a pending client request sharing its id', () => {
    test('a server-initiated request whose id collides with a pending client request leaves that request cancellable', async () => {
      const transport = new HTTPTransport({ url: TEST_URL })

      // The client's own pending request (id 0), answered on a still-open SSE stream so the
      // exchange stays tracked while the server pushes its own request on the same stream —
      // both id spaces start at 0, so this collision is the realistic case.
      const encoder = new TextEncoder()
      let sseController!: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sseController = controller
        },
      })
      fetchMock.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        }),
      )
      // The cancellation notification's own POST.
      fetchMock.mockResolvedValueOnce(acceptedResponse())

      await transport.write(request20260728(0))
      const post = getCallByMethod(fetchMock.mock.calls, 'POST')
      expect(post[1].signal?.aborted).toBe(false)

      // A server-initiated request reusing id 0, from the server's own id space, arrives on
      // the same stream before the client's own request has a response.
      const serverRequest: ServerMessage = {
        jsonrpc: '2.0',
        id: 0,
        method: 'sampling/createMessage',
        params: {},
      } as ServerMessage
      sseController.enqueue(encoder.encode(`data: ${JSON.stringify(serverRequest)}\n\n`))

      // Read it off the transport, proving #handleIncoming processed it.
      const { value } = await transport.read()
      expect(value).toEqual(serverRequest)

      // The client's own pending request 0 must still be cancellable: the collision above
      // must not have cleared its exchange-tracking entry.
      await transport.write({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 0, _meta: { ...requestMeta20260728 } },
      } as ClientMessage)

      expect(post[1].signal?.aborted).toBe(true)

      sseController.close()
      await transport.dispose()
    })
  })

  describe('dispose aborts in-flight exchanges', () => {
    test('dispose aborts a POST whose SSE body never ends', async () => {
      const transport = new HTTPTransport({ url: TEST_URL })
      const stream = new ReadableStream<Uint8Array>({ start() {} })
      fetchMock.mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        }),
      )

      await transport.write(request20260728(7))
      const post = getCallByMethod(fetchMock.mock.calls, 'POST')

      await transport.dispose()

      expect(post[1].signal?.aborted).toBe(true)
    })
  })

  describe('dispose aborts untracked outgoing POSTs', () => {
    test('dispose aborts an in-flight outgoing notification POST', async () => {
      const transport = new HTTPTransport({ url: TEST_URL })

      // The notification's POST hangs until its signal aborts, so it is still in flight when
      // dispose() runs — like the connect-timeout test's abort-on-signal fetch mock.
      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
      })

      const writePromise = transport.write(progressNotification)

      await vi.waitFor(() => {
        expect(fetchMock.mock.calls.length).toBe(1)
      })
      const post = fetchMock.mock.calls[0] as FetchCall
      expect(post[1].signal?.aborted).toBe(false)

      await transport.dispose()

      expect(post[1].signal?.aborted).toBe(true)
      await writePromise
    })

    test('dispose only aborts still-open untracked exchanges, not ones that already settled', async () => {
      const transport = new HTTPTransport({ url: TEST_URL })

      // Two notifications complete normally: their untracked-controller bookkeeping must be
      // reclaimed on completion, same as a tracked exchange reclaims its entry.
      fetchMock.mockResolvedValueOnce(acceptedResponse())
      fetchMock.mockResolvedValueOnce(acceptedResponse())
      await transport.write(progressNotification)
      await transport.write(progressNotification)

      // A third notification's POST hangs, still in flight when dispose runs.
      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
      })
      const writePromise = transport.write(progressNotification)
      await vi.waitFor(() => {
        expect(fetchMock.mock.calls.length).toBe(3)
      })

      const [firstPost, secondPost, thirdPost] = fetchMock.mock.calls as Array<FetchCall>
      expect(firstPost[1].signal?.aborted).toBe(false)
      expect(secondPost[1].signal?.aborted).toBe(false)

      await transport.dispose()

      // The still-open exchange is aborted...
      expect(thirdPost[1].signal?.aborted).toBe(true)
      // ...but the two that already completed are not touched a second time. If their
      // untracked controllers had leaked into the set instead of being reclaimed on
      // completion, dispose's loop would call abort() on them too, flipping these back to
      // true — proof the set does not grow for the life of the transport.
      expect(firstPost[1].signal?.aborted).toBe(false)
      expect(secondPost[1].signal?.aborted).toBe(false)
      await writePromise
    })
  })

  describe('connect timeout', () => {
    test('a connection that never returns headers fails with a timeout error frame', async () => {
      vi.useFakeTimers()
      try {
        // fetch rejects when the AbortController fires (mimicking a real abort).
        fetchMock.mockImplementationOnce((_url, init: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          })
        })

        const transport = new HTTPTransport({ url: TEST_URL, timeout: 1000 })
        const write = transport.write(initializeRequest)
        await vi.advanceTimersByTimeAsync(1000)
        await write

        const { value } = await transport.read()
        const frame = value as ErrorFrame
        expect(frame.id).toBe(1)
        expect(frame.error?.message).toContain('timed out')

        await transport.dispose()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('SSE lastEventId tracking', () => {
    test('tracks lastEventId from SSE events', async () => {
      const msg: ServerMessage = { jsonrpc: '2.0', id: 10, result: {} } as ServerMessage

      fetchMock.mockResolvedValueOnce(
        sseResponse([{ data: JSON.stringify(msg), id: 'evt-42' }], {
          'Mcp-Session-Id': 'session-sse',
        }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()

      expect(transport.lastEventID).toBe('evt-42')

      await transport.dispose()
    })
  })

  describe('SSE retry tracking', () => {
    test('tracks retry field from SSE events', async () => {
      const msg: ServerMessage = { jsonrpc: '2.0', id: 10, result: {} } as ServerMessage

      fetchMock.mockResolvedValueOnce(
        sseResponse([{ data: JSON.stringify(msg), id: 'evt-1', retry: 5000 }], {
          'Mcp-Session-Id': 'session-retry',
        }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()

      expect(transport.retryMs).toBe(5000)

      await transport.dispose()
    })
  })

  test('POST includes Mcp-Method and Mcp-Name headers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [] } }),
    )
    const transport = new HTTPTransport({ url: TEST_URL })
    await transport.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search' },
    } as ClientMessage)
    const [, init] = getCallByMethod(fetchMock.mock.calls, 'POST')
    expect(init.headers['Mcp-Method']).toBe('tools/call')
    expect(init.headers['Mcp-Name']).toBe('search')
    await transport.dispose()
  })

  test('POST derives Mcp-Name from each method’s own source field', async () => {
    // `resources/read` names its subject in `uri`, not `name`. A client reading `params.name`
    // for every method sends no header at all here, which a conformant peer rejects outright.
    const cases: Array<{ method: string; params: Record<string, unknown>; expected: string }> = [
      { method: 'prompts/get', params: { name: 'greet' }, expected: 'greet' },
      { method: 'resources/read', params: { uri: 'test://greeting' }, expected: 'test://greeting' },
    ]
    for (const [index, { method, params, expected }] of cases.entries()) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: index, result: {} }))
      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write({ jsonrpc: '2.0', id: index, method, params } as ClientMessage)
      const [, init] = getCallByMethod(fetchMock.mock.calls, 'POST')
      expect(init.headers['Mcp-Method']).toBe(method)
      expect(init.headers['Mcp-Name']).toBe(expected)
      await transport.dispose()
      fetchMock.mockClear()
    }
  })

  test('POST Base64-wraps an Mcp-Name a header value cannot carry raw', async () => {
    // A resource URI is unconstrained text, but an HTTP header value is a ByteString: assigning
    // one raw makes the `new Headers()` that `fetch` builds internally throw, and the read comes
    // back as an opaque send failure instead of the resource. `fetchMock` never constructs a
    // `Headers`, so this test builds one itself — without that, an ASCII-only fixture and a
    // mocked `fetch` between them can assert the header's *value* while never exercising the one
    // constraint that makes the raw form illegal.
    const uri = 'file:///Users/paul/文档/notes.md'
    const contents = [{ uri, mimeType: 'text/plain', text: 'notes' }]
    fetchMock.mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: { contents } }))

    const transport = new HTTPTransport({ url: TEST_URL })
    await transport.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri },
    } as ClientMessage)

    const [, init] = getCallByMethod(fetchMock.mock.calls, 'POST')
    const headerValue = new Headers(init.headers).get('Mcp-Name') as string
    expect(headerValue).toMatch(/^=\?base64\?.+\?=$/)
    // What a conformant peer compares against `params.uri` is the *decoded* value, so the round
    // trip is the assertion that matters, not the wrapper's shape alone. Decoded the way the
    // SDK's own `decodeMcpParamValue` does: Base64 to bytes, bytes to UTF-8.
    const bytes = Uint8Array.from(atob(headerValue.slice(9, -2)), (char) => char.charCodeAt(0))
    expect(new TextDecoder().decode(bytes)).toBe(uri)

    // And the read itself succeeds rather than failing inside the send.
    const { value } = await transport.read()
    expect(value).toEqual({ jsonrpc: '2.0', id: 1, result: { contents } })

    await transport.dispose()
  })

  test('POST omits Mcp-Name for a method that does not require it', async () => {
    // Only the three methods the specification lists carry the header. A `name` in the params
    // of any other method is an ordinary argument and must not be mirrored into a header a
    // peer would then cross-check.
    fetchMock.mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [] } }))
    const transport = new HTTPTransport({ url: TEST_URL })
    await transport.write({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { name: 'search' },
    } as ClientMessage)
    const [, init] = getCallByMethod(fetchMock.mock.calls, 'POST')
    expect(init.headers['Mcp-Method']).toBe('tools/list')
    expect(init.headers['Mcp-Name']).toBeUndefined()
    await transport.dispose()
  })

  describe('x-mcp-header param injection', () => {
    const listRequest: ClientMessage = {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/list',
      params: {},
    } as ClientMessage

    function listResult(tools: Array<unknown>): ServerMessage {
      return { jsonrpc: '2.0', id: 5, result: { tools } } as ServerMessage
    }

    test('injects Mcp-Param-* headers on tools/call after caching the schema', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          listResult([
            {
              name: 'search',
              inputSchema: {
                type: 'object',
                properties: { region: { type: 'string', 'x-mcp-header': 'Region' } },
              },
            },
          ]),
        ),
      )
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 6, result: { content: [] } }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      await transport.read()

      await transport.write({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'search', arguments: { region: 'us-east-1' } },
      } as ClientMessage)

      const calls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === 'POST')
      const callPost = calls[calls.length - 1]
      expect(callPost[1].headers['Mcp-Param-Region']).toBe('us-east-1')

      await transport.dispose()
    })

    test('a header-encoding failure surfaces as an error frame without killing the transport', async () => {
      // Cache a schema with an integer-annotated x-mcp-header param.
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          listResult([
            {
              name: 'counter',
              inputSchema: {
                type: 'object',
                properties: { count: { type: 'integer', 'x-mcp-header': 'Count' } },
              },
            },
          ]),
        ),
      )
      // A subsequent good request proves the writable stream survived the throw.
      fetchMock.mockResolvedValueOnce(jsonResponse(pingResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      await transport.read()

      // A non-integer value for the integer param makes encodeHeaderValue throw — before
      // fetch, in the header-building block. It must not escape the sink.
      await transport.write({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'counter', arguments: { count: 2.5 } },
      } as ClientMessage)

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(8)
      expect(frame.error?.message).toContain('headers')

      // The failed call never reached fetch; the transport is still usable.
      await transport.write(pingRequest)
      const { value: value2 } = await transport.read()
      expect(value2).toEqual(pingResult)

      await transport.dispose()
    })

    test('omits Mcp-Param-* when no schema has been cached', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 6, result: { content: [] } }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'search', arguments: { region: 'us-east-1' } },
      } as ClientMessage)

      const [, init] = getCallByMethod(fetchMock.mock.calls, 'POST')
      expect(init.headers['Mcp-Param-Region']).toBeUndefined()

      await transport.dispose()
    })

    test('excludes tools with invalid x-mcp-header from the tools/list result', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          listResult([
            { name: 'good', inputSchema: { type: 'object', properties: {} } },
            {
              name: 'bad',
              inputSchema: {
                type: 'object',
                properties: { region: { type: 'string', 'x-mcp-header': 'bad space' } },
              },
            },
          ]),
        ),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      const { value } = await transport.read()

      const names = (value as { result: { tools: Array<{ name: string }> } }).result.tools.map(
        (t) => t.name,
      )
      expect(names).toEqual(['good'])

      await transport.dispose()
    })
  })

  describe('stale-schema retry on -32020', () => {
    const listRequest: ClientMessage = {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/list',
      params: {},
    } as ClientMessage

    const callRequest: ClientMessage = {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'search', arguments: { region: 'us-east-1' } },
    } as ClientMessage

    function listResult(tools: Array<unknown>): ServerMessage {
      return { jsonrpc: '2.0', id: 5, result: { tools } } as ServerMessage
    }

    function searchTool(annotated: boolean): unknown {
      return {
        name: 'search',
        inputSchema: {
          type: 'object',
          properties: {
            region: annotated ? { type: 'string', 'x-mcp-header': 'Region' } : { type: 'string' },
          },
        },
      }
    }

    /** The peer's `-32020`, shaped as SDK 2.0.0's `paramHeaderMismatchRejection` builds it. */
    function mismatchResponse(id: number, header: string, data?: unknown): Response {
      return errorResponse(
        400,
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32020,
            message: 'Bad Request: the request headers and body disagree',
            data:
              data === undefined
                ? { mismatch: { header, body: 'the body carries region="us-east-1"' } }
                : data,
          },
        }),
      )
    }

    function posts(calls: Array<Array<unknown>>): Array<FetchCall> {
      return calls.filter((call) => (call[1] as RequestInit).method === 'POST') as Array<FetchCall>
    }

    test('refreshes the annotations and retries a tools/call the peer rejected', async () => {
      // The client's first list carries no annotation, so the call goes out bare...
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(false)])))
      // ...and the peer, whose schema now declares one, rejects it.
      fetchMock.mockResolvedValueOnce(mismatchResponse(6, 'Mcp-Param-Region'))
      // The transport's own tools/list sees the annotation. Its request id is internal and the
      // response is read from the fetch rather than enqueued, so the id here is not correlated.
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(true)])))
      // The retry carries the header and succeeds.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 6, result: { content: [] } }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      await transport.read()
      await transport.write(callRequest)

      const { value } = await transport.read()
      expect(value).toEqual({ jsonrpc: '2.0', id: 6, result: { content: [] } })

      const sent = posts(fetchMock.mock.calls)
      expect(sent).toHaveLength(4)
      expect(sent[1][1].headers['Mcp-Param-Region']).toBeUndefined()
      expect(sent[2][1].headers['Mcp-Method']).toBe('tools/list')
      expect(sent[2][1].headers.Accept).toBe('application/json, text/event-stream')
      expect(sent[3][1].headers['Mcp-Param-Region']).toBe('us-east-1')

      await transport.dispose()
    })

    test('passes a -32020 through on a method other than tools/call', async () => {
      fetchMock.mockResolvedValueOnce(mismatchResponse(7, 'Mcp-Param-Region'))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write({
        jsonrpc: '2.0',
        id: 7,
        method: 'prompts/get',
        params: { name: 'greet' },
      } as ClientMessage)

      const { value } = await transport.read()
      expect((value as ErrorFrame).error?.code).toBe(-32020)
      expect(posts(fetchMock.mock.calls)).toHaveLength(1)

      await transport.dispose()
    })

    test('passes a -32020 through when the disagreeing header is not an Mcp-Param-*', async () => {
      // The inbound classifier's standard-header cross-check uses the same code. No schema
      // refresh can affect it, so it must not cost a tools/list.
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(true)])))
      fetchMock.mockResolvedValueOnce(mismatchResponse(6, 'Mcp-Name'))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      await transport.read()
      await transport.write(callRequest)

      const { value } = await transport.read()
      expect((value as ErrorFrame).error?.code).toBe(-32020)
      expect(posts(fetchMock.mock.calls)).toHaveLength(2)

      await transport.dispose()
    })

    test('passes a -32020 through when error.data carries no mismatch', async () => {
      // JSON-RPC leaves `data` entirely to the server, so an absent or differently-shaped one
      // must fail the gate rather than throw or trigger a blind refresh.
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(true)])))
      fetchMock.mockResolvedValueOnce(mismatchResponse(6, '', { detail: 'no mismatch key' }))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      await transport.read()
      await transport.write(callRequest)

      const { value } = await transport.read()
      expect((value as ErrorFrame).error?.code).toBe(-32020)
      expect(posts(fetchMock.mock.calls)).toHaveLength(2)

      await transport.dispose()
    })

    test('does not retry a second time when the retry is rejected too', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(false)])))
      fetchMock.mockResolvedValueOnce(mismatchResponse(6, 'Mcp-Param-Region'))
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(true)])))
      fetchMock.mockResolvedValueOnce(mismatchResponse(6, 'Mcp-Param-Region'))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      await transport.read()
      await transport.write(callRequest)

      const { value } = await transport.read()
      expect((value as ErrorFrame).error?.code).toBe(-32020)
      expect(posts(fetchMock.mock.calls)).toHaveLength(4)

      await transport.dispose()
    })

    test('surfaces the original error when the refresh fails', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(false)])))
      fetchMock.mockResolvedValueOnce(mismatchResponse(6, 'Mcp-Param-Region'))
      // A refresh that answers HTML, or anything but a JSON tools/list result, is a failed
      // refresh — not an error the caller ever hears about.
      fetchMock.mockResolvedValueOnce(errorResponse(500, '<html>gateway</html>'))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      await transport.read()
      await transport.write(callRequest)

      const { value } = await transport.read()
      const frame = value as ErrorFrame
      expect(frame.id).toBe(6)
      expect(frame.error?.code).toBe(-32020)
      expect(posts(fetchMock.mock.calls)).toHaveLength(3)

      await transport.dispose()
    })

    test('skips the retry when the refreshed annotations produce the same headers', async () => {
      // Already annotated, and the refresh says the same. The retry would send byte-identical
      // headers and fail identically, so it is not worth a round trip.
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(true)])))
      fetchMock.mockResolvedValueOnce(mismatchResponse(6, 'Mcp-Param-Region'))
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(true)])))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      await transport.read()
      await transport.write(callRequest)

      const { value } = await transport.read()
      expect((value as ErrorFrame).error?.code).toBe(-32020)
      expect(posts(fetchMock.mock.calls)).toHaveLength(3)

      await transport.dispose()
    })

    test('carries the revision envelope through the refresh', async () => {
      // A `2026-07-28` request has no `initialize` handshake to seed `#protocolVersion` from —
      // the refresh must derive its revision from the message's own `_meta`, same as an
      // ordinary send, or its own envelope goes out revision-less. And the envelope is more than
      // the version: `2026-07-28` also requires client capabilities, which only the layer above
      // the transport knows, so the refresh must copy the originating request's own `_meta`
      // rather than rebuild it — a conformant peer rejects an envelope missing either key.
      const requestMeta = {
        [META_PROTOCOL_VERSION]: '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
      }
      const versionedCallRequest: ClientMessage = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'search',
          arguments: { region: 'us-east-1' },
          _meta: requestMeta,
        },
      } as ClientMessage

      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(false)])))
      fetchMock.mockResolvedValueOnce(mismatchResponse(6, 'Mcp-Param-Region'))
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(true)])))
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ jsonrpc: '2.0', id: 6, result: { content: [] } }),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      await transport.read()
      await transport.write(versionedCallRequest)

      const { value } = await transport.read()
      expect(value).toEqual({ jsonrpc: '2.0', id: 6, result: { content: [] } })

      const sent = posts(fetchMock.mock.calls)
      expect(sent[2][1].headers['MCP-Protocol-Version']).toBe('2026-07-28')
      const refreshBody = JSON.parse(sent[2][1].body as string) as {
        params: { _meta: Record<string, unknown> }
      }
      expect(refreshBody.params._meta).toEqual(requestMeta)

      await transport.dispose()
    })

    test('a re-encode that throws during the retry decision surfaces the original error', async () => {
      // The peer's schema, once refreshed, types the param as an integer this call's argument
      // cannot satisfy — the retry's own re-encode throws, and that must not become the
      // caller's error in place of the peer's `-32020`.
      function integerSearchTool(): unknown {
        return {
          name: 'search',
          inputSchema: {
            type: 'object',
            properties: { region: { type: 'integer', 'x-mcp-header': 'Region' } },
          },
        }
      }

      const nonIntegerCallRequest: ClientMessage = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'search', arguments: { region: 3.5 } },
      } as ClientMessage

      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([searchTool(false)])))
      fetchMock.mockResolvedValueOnce(mismatchResponse(6, 'Mcp-Param-Region'))
      fetchMock.mockResolvedValueOnce(jsonResponse(listResult([integerSearchTool()])))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(listRequest)
      await transport.read()
      await transport.write(nonIntegerCallRequest)

      const { value } = await transport.read()
      expect((value as ErrorFrame).error?.code).toBe(-32020)
      expect(posts(fetchMock.mock.calls)).toHaveLength(3)

      await transport.dispose()
    })
  })

  describe('GET stream for server-initiated messages', () => {
    test('opens GET stream after initialized notification when session exists', async () => {
      // Initialize response with session ID
      fetchMock.mockResolvedValueOnce(
        jsonResponse(initializeResult, { 'Mcp-Session-Id': 'session-get' }),
      )
      // The initialized notification gets 202
      fetchMock.mockResolvedValueOnce(acceptedResponse())
      // The GET stream response
      const serverNotification: ServerMessage = {
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed',
      } as ServerMessage
      fetchMock.mockResolvedValueOnce(sseResponse([{ data: JSON.stringify(serverNotification) }]))

      const transport = new HTTPTransport({ url: TEST_URL })

      // Step 1: initialize
      await transport.write(initializeRequest)
      await transport.read()

      // Step 2: send initialized notification - triggers GET stream
      await transport.write(initializedNotification)

      // Allow the GET stream to be opened (async)
      await vi.waitFor(() => {
        expect(findCallByMethod(fetchMock.mock.calls, 'GET')).toBeDefined()
      })

      // Read the server-initiated notification from the GET stream
      const { value } = await transport.read()
      expect(value).toEqual(serverNotification)

      await transport.dispose()
    })

    test('GET stream includes correct headers', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(initializeResult, { 'Mcp-Session-Id': 'session-hdr' }),
      )
      fetchMock.mockResolvedValueOnce(acceptedResponse())
      fetchMock.mockResolvedValueOnce(sseResponse([]))

      const transport = new HTTPTransport({ url: TEST_URL })

      await transport.write(initializeRequest)
      await transport.read()
      await transport.write(initializedNotification)

      await vi.waitFor(() => {
        expect(findCallByMethod(fetchMock.mock.calls, 'GET')).toBeDefined()
      })

      const getCall = getCallByMethod(fetchMock.mock.calls, 'GET')
      expect(getCall[1].headers.Accept).toBe('text/event-stream')
      expect(getCall[1].headers['MCP-Protocol-Version']).toBe('2025-11-25')
      expect(getCall[1].headers['Mcp-Session-Id']).toBe('session-hdr')

      await transport.dispose()
    })

    test('GET stream includes Last-Event-ID when available', async () => {
      const msg: ServerMessage = { jsonrpc: '2.0', id: 10, result: {} } as ServerMessage

      // Initialize with SSE response that sets lastEventId
      fetchMock.mockResolvedValueOnce(
        sseResponse([{ data: JSON.stringify(msg), id: 'evt-99' }], {
          'Mcp-Session-Id': 'session-lei',
        }),
      )
      // The initialized notification gets 202
      fetchMock.mockResolvedValueOnce(acceptedResponse())
      // The GET stream
      fetchMock.mockResolvedValueOnce(sseResponse([]))

      const transport = new HTTPTransport({ url: TEST_URL })

      await transport.write(initializeRequest)
      await transport.read()
      await transport.write(initializedNotification)

      await vi.waitFor(() => {
        expect(findCallByMethod(fetchMock.mock.calls, 'GET')).toBeDefined()
      })

      const getCall = getCallByMethod(fetchMock.mock.calls, 'GET')
      expect(getCall[1].headers['Last-Event-ID']).toBe('evt-99')

      await transport.dispose()
    })

    test('GET stream is cancelled on dispose', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(initializeResult, { 'Mcp-Session-Id': 'session-cancel' }),
      )
      fetchMock.mockResolvedValueOnce(acceptedResponse())

      // Create a long-lived SSE stream using a never-resolving readable
      const getResponse = new Response(
        new ReadableStream({
          // Intentionally never push data - simulates a long-lived connection
          start() {},
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      )
      fetchMock.mockResolvedValueOnce(getResponse)

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()
      await transport.write(initializedNotification)

      await vi.waitFor(() => {
        expect(findCallByMethod(fetchMock.mock.calls, 'GET')).toBeDefined()
      })

      // Verify an AbortSignal was passed to the GET request
      const getCall = getCallByMethod(fetchMock.mock.calls, 'GET')
      const signal = getCall[1].signal
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal?.aborted).toBe(false)

      await transport.dispose()

      expect(signal?.aborted).toBe(true)
    })

    test('reconnects the GET stream after it ends, resuming from Last-Event-ID', async () => {
      const notif: ServerMessage = {
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed',
      } as ServerMessage

      fetchMock.mockResolvedValueOnce(
        jsonResponse(initializeResult, { 'Mcp-Session-Id': 'session-rc' }),
      )
      fetchMock.mockResolvedValueOnce(acceptedResponse())
      // First GET: a finite stream with a small retry hint, then it ends.
      fetchMock.mockResolvedValueOnce(
        sseResponse([{ data: JSON.stringify(notif), id: 'e1', retry: 5 }]),
      )
      // Second GET (after reconnect): ends as well.
      fetchMock.mockResolvedValueOnce(sseResponse([{ data: JSON.stringify(notif), id: 'e2' }]))
      // Any further GETs park on a never-ending stream so the loop stops spinning.
      fetchMock.mockResolvedValue(
        new Response(
          new ReadableStream({
            start() {},
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()
      await transport.write(initializedNotification)

      // The loop should reconnect on its own after the first stream ends.
      await vi.waitFor(() => {
        const gets = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === 'GET')
        expect(gets.length).toBeGreaterThanOrEqual(2)
      })

      const gets = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === 'GET')
      expect(gets[1][1].headers['Last-Event-ID']).toBe('e1')

      await transport.dispose()
    })

    test('does not reconnect when the server returns 405 (no GET stream support)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(initializeResult, { 'Mcp-Session-Id': 'session-405' }),
      )
      fetchMock.mockResolvedValueOnce(acceptedResponse())
      fetchMock.mockResolvedValueOnce(errorResponse(405, 'Method Not Allowed'))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()
      await transport.write(initializedNotification)

      await vi.waitFor(() => {
        expect(findCallByMethod(fetchMock.mock.calls, 'GET')).toBeDefined()
      })

      // Give the loop room to (not) reconnect, then assert it stopped at one GET.
      await new Promise((r) => setTimeout(r, 50))
      const gets = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === 'GET')
      expect(gets.length).toBe(1)

      await transport.dispose()
    })
  })

  describe('dispose DELETE is bounded', () => {
    test('the session-termination DELETE carries an abort signal', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(initializeResult, { 'Mcp-Session-Id': 'session-del2' }),
      )
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)
      await transport.read()
      await transport.dispose()

      const del = getCallByMethod(fetchMock.mock.calls, 'DELETE')
      expect(del[1].signal).toBeInstanceOf(AbortSignal)
    })
  })
})
