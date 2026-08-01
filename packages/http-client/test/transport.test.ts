import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
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

      const transport = new HTTPTransport({ url: TEST_URL, protocolVersion: '2024-11-05' })
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
