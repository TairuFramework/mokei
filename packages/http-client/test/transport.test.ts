import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { HTTPTransport } from '../src/transport.js'

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

const initializeRequest: ClientMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0' },
  },
} as ClientMessage

const initializeResult: ServerMessage = {
  jsonrpc: '2.0',
  id: 1,
  result: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
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

  // Task 3: Basic POST with JSON response

  describe('POST sends correct headers and body', () => {
    test('sends Content-Type, Accept, and MCP-Protocol-Version headers', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(initializeResult))

      const transport = new HTTPTransport({ url: TEST_URL })
      await transport.write(initializeRequest)

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe(TEST_URL)
      expect(options.method).toBe('POST')
      expect(options.headers['Content-Type']).toBe('application/json')
      expect(options.headers.Accept).toBe('application/json, text/event-stream')
      expect(options.headers['MCP-Protocol-Version']).toBe(LATEST_PROTOCOL_VERSION)
      expect(JSON.parse(options.body)).toEqual(initializeRequest)

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
    test('throws on error status', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'))

      const transport = new HTTPTransport({ url: TEST_URL })
      await expect(transport.write(initializeRequest)).rejects.toThrow('HTTP 500')

      await transport.dispose()
    })

    test('throws on 404 with session expired indication', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(404, 'Session not found'))

      const transport = new HTTPTransport({ url: TEST_URL })
      await expect(transport.write(initializeRequest)).rejects.toThrow('HTTP 404')

      await transport.dispose()
    })
  })

  // Task 4: Session management

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

  // Task 5: SSE response handling

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

  // Task 6: GET stream for server-initiated messages

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
      expect(getCall[1].headers['MCP-Protocol-Version']).toBe(LATEST_PROTOCOL_VERSION)
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
  })
})
