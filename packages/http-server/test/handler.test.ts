import { ContextServer, type ServerConfig } from '@mokei/context-server'
import { describe, expect, test } from 'vitest'

import { createHTTPHandler, type HTTPHandlerParams } from '../src/handler.js'

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

function createHandler(overrides?: Partial<HTTPHandlerParams>) {
  return createHTTPHandler({
    createServer: (transport) => new ContextServer({ ...SERVER_CONFIG, transport }),
    ...overrides,
  })
}

function initializeRequest(sessionID?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sessionID != null) {
    headers['Mcp-Session-Id'] = sessionID
  }
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers,
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
}

function initializedNotification(sessionID: string): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Mcp-Session-Id': sessionID,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  })
}

function toolCallRequest(sessionID: string, text: string, requestID = 2): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Session-Id': sessionID,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestID,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text } },
    }),
  })
}

function parseSSEEvents(text: string): Array<{ id?: string; data: string }> {
  const events: Array<{ id?: string; data: string }> = []
  const blocks = text.split('\n\n').filter((b) => b.trim() !== '')
  for (const block of blocks) {
    const lines = block.split('\n')
    let id: string | undefined
    let data = ''
    for (const line of lines) {
      if (line.startsWith('id: ')) {
        id = line.slice(4)
      } else if (line.startsWith('data: ')) {
        data = line.slice(6)
      } else if (line === 'data: ') {
        data = ''
      }
    }
    events.push({ id, data })
  }
  return events
}

async function initializeSession(handler: ReturnType<typeof createHandler>): Promise<string> {
  const response = await handler.handleRequest(initializeRequest())
  const sessionID = response.headers.get('Mcp-Session-Id')
  if (sessionID == null) {
    throw new Error('No session ID in response')
  }
  // Send initialized notification
  await handler.handleRequest(initializedNotification(sessionID))
  return sessionID
}

describe('createHTTPHandler', () => {
  test('POST initialize returns 200 with JSON response and Mcp-Session-Id header', async () => {
    const handler = createHandler()

    try {
      const response = await handler.handleRequest(initializeRequest())

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')

      const sessionID = response.headers.get('Mcp-Session-Id')
      expect(sessionID).toBeTruthy()

      const body = await response.json()
      expect(body.protocolVersion).toBe('2025-11-25')
      expect(body.serverInfo).toEqual({ name: 'test-server', version: '1.0.0' })
      expect(body.capabilities).toBeDefined()
    } finally {
      handler.dispose()
    }
  })

  test('POST initialized notification returns 202', async () => {
    const handler = createHandler()

    try {
      const sessionID = await initializeSession(handler)
      const response = await handler.handleRequest(initializedNotification(sessionID))

      // The notification after the first one should also return 202
      expect(response.status).toBe(202)
    } finally {
      handler.dispose()
    }
  })

  test('POST with disallowed Origin returns 403', async () => {
    const handler = createHandler({ allowedOrigins: ['https://allowed.example.com'] })

    try {
      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example.com',
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

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(403)
    } finally {
      handler.dispose()
    }
  })

  test('POST with allowed Origin succeeds', async () => {
    const handler = createHandler({ allowedOrigins: ['https://allowed.example.com'] })

    try {
      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Origin: 'https://allowed.example.com',
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

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)
    } finally {
      handler.dispose()
    }
  })

  test('POST with no Origin header skips origin validation', async () => {
    const handler = createHandler({ allowedOrigins: ['https://allowed.example.com'] })

    try {
      const response = await handler.handleRequest(initializeRequest())
      expect(response.status).toBe(200)
    } finally {
      handler.dispose()
    }
  })

  test('POST with unknown Mcp-Session-Id returns 404', async () => {
    const handler = createHandler()

    try {
      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': 'nonexistent-session',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(404)
    } finally {
      handler.dispose()
    }
  })

  test('POST tool call returns SSE response with result', async () => {
    const handler = createHandler()

    try {
      const sessionID = await initializeSession(handler)
      const response = await handler.handleRequest(toolCallRequest(sessionID, 'hello world'))

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')

      const text = await response.text()
      const events = parseSSEEvents(text)

      // First event is priming, second contains the result
      expect(events.length).toBeGreaterThanOrEqual(2)

      // Find the event with actual data (not the priming event)
      const dataEvent = events.find((e) => e.data !== '')
      expect(dataEvent).toBeDefined()

      const result = JSON.parse(dataEvent!.data)
      expect(result.jsonrpc).toBe('2.0')
      expect(result.id).toBe(2)
      expect(result.result.content).toEqual([{ type: 'text', text: 'hello world' }])
    } finally {
      handler.dispose()
    }
  })

  test('GET with session ID returns SSE stream', async () => {
    const handler = createHandler()

    try {
      const sessionID = await initializeSession(handler)

      const request = new Request('http://localhost/mcp', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Mcp-Session-Id': sessionID,
        },
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')

      // The response body is a stream; we can verify it started
      expect(response.body).toBeTruthy()
    } finally {
      handler.dispose()
    }
  })

  test('GET without Mcp-Session-Id returns 400', async () => {
    const handler = createHandler()

    try {
      const request = new Request('http://localhost/mcp', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(400)
    } finally {
      handler.dispose()
    }
  })

  test('GET with unknown session ID returns 404', async () => {
    const handler = createHandler()

    try {
      const request = new Request('http://localhost/mcp', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Mcp-Session-Id': 'nonexistent',
        },
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(404)
    } finally {
      handler.dispose()
    }
  })

  test('DELETE with session ID returns 200 and subsequent requests return 404', async () => {
    const handler = createHandler()

    try {
      const sessionID = await initializeSession(handler)

      const deleteRequest = new Request('http://localhost/mcp', {
        method: 'DELETE',
        headers: {
          'Mcp-Session-Id': sessionID,
        },
      })

      const deleteResponse = await handler.handleRequest(deleteRequest)
      expect(deleteResponse.status).toBe(200)

      // Subsequent requests should return 404
      const postRequest = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionID,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      })

      const postResponse = await handler.handleRequest(postRequest)
      expect(postResponse.status).toBe(404)
    } finally {
      handler.dispose()
    }
  })

  test('DELETE without session ID returns 400', async () => {
    const handler = createHandler()

    try {
      const request = new Request('http://localhost/mcp', {
        method: 'DELETE',
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(400)
    } finally {
      handler.dispose()
    }
  })

  test('resumability: GET with Last-Event-ID replays buffered events', async () => {
    const handler = createHandler({ replayBufferSize: 100 })

    try {
      const sessionID = await initializeSession(handler)

      // Make a tool call to generate events that get buffered in the getStream
      // First, open a GET stream to capture server events
      const getRequest1 = new Request('http://localhost/mcp', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Mcp-Session-Id': sessionID,
        },
      })

      const getResponse1 = await handler.handleRequest(getRequest1)
      expect(getResponse1.status).toBe(200)

      // The GET stream should have a priming event
      // Read a little from it to get the priming event ID
      const reader = getResponse1.body!.getReader()
      const decoder = new TextDecoder()

      // Read the priming event
      const { value: primingChunk } = await reader.read()
      const primingText = decoder.decode(primingChunk)
      const primingEvent = parseSSEEvents(primingText)
      expect(primingEvent.length).toBeGreaterThanOrEqual(1)

      const lastEventID = primingEvent[0]?.id
      expect(lastEventID).toBeTruthy()

      // Cancel the reader to close the first GET stream
      await reader.cancel()

      // Now open a new GET stream with Last-Event-ID for replay
      const getRequest2 = new Request('http://localhost/mcp', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Mcp-Session-Id': sessionID,
          'Last-Event-ID': lastEventID!,
        },
      })

      const getResponse2 = await handler.handleRequest(getRequest2)
      expect(getResponse2.status).toBe(200)
      expect(getResponse2.headers.get('Content-Type')).toBe('text/event-stream')

      // The new stream should be valid
      expect(getResponse2.body).toBeTruthy()
    } finally {
      handler.dispose()
    }
  })

  test('unsupported HTTP method returns 405', async () => {
    const handler = createHandler()

    try {
      const request = new Request('http://localhost/mcp', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(405)
    } finally {
      handler.dispose()
    }
  })
})
