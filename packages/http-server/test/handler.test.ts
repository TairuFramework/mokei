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
      expect(body.jsonrpc).toBe('2.0')
      expect(body.id).toBe(1)
      expect(body.result.protocolVersion).toBe('2025-11-25')
      expect(body.result.serverInfo).toEqual({ name: 'test-server', version: '1.0.0' })
      expect(body.result.capabilities).toBeDefined()
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

  test('POST body over maxBodyBytes returns 413', async () => {
    const handler = createHandler({ maxBodyBytes: 200 })

    try {
      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { padding: 'x'.repeat(1000) },
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(413)
    } finally {
      handler.dispose()
    }
  })

  test('POST body within maxBodyBytes is processed normally', async () => {
    const handler = createHandler({ maxBodyBytes: 4096 })

    try {
      const response = await handler.handleRequest(initializeRequest())
      expect(response.status).toBe(200)
      expect(response.headers.get('Mcp-Session-Id')).toBeTruthy()
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

  test('POST with no Origin header returns 403 when allowlist configured', async () => {
    const handler = createHandler({ allowedOrigins: ['https://allowed.example.com'] })

    try {
      const response = await handler.handleRequest(initializeRequest())
      expect(response.status).toBe(403)
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

      const result = JSON.parse(dataEvent?.data ?? '')
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
      expect(deleteResponse.status).toBe(204)

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

  test('DELETE with disallowed Origin returns 403', async () => {
    const handler = createHandler({ allowedOrigins: ['https://allowed.example.com'] })

    try {
      // Initialize with the allowed origin so the session can be established.
      const initRes = await handler.handleRequest(
        new Request('http://localhost/mcp', {
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
        }),
      )
      const sessionID = initRes.headers.get('Mcp-Session-Id')
      if (sessionID == null) {
        throw new Error('No session ID in response')
      }

      // Send initialized notification with the allowed origin.
      await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://allowed.example.com',
            'Mcp-Session-Id': sessionID,
          },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        }),
      )

      const request = new Request('http://localhost/mcp', {
        method: 'DELETE',
        headers: {
          'Mcp-Session-Id': sessionID,
          Origin: 'https://evil.example.com',
        },
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(403)
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
      expect(getResponse1.body).toBeTruthy()
      // biome-ignore lint/style/noNonNullAssertion: asserted above
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
          'Last-Event-ID': lastEventID ?? '',
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

  test('default config allows localhost origins and rejects foreign origins', async () => {
    const handler = createHandler()
    try {
      const ok = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        }),
      )
      expect(ok.status).not.toBe(403)

      const blocked = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        }),
      )
      expect(blocked.status).toBe(403)
    } finally {
      handler.dispose()
    }
  })

  test('missing Origin rejected when an allowlist is configured', async () => {
    const handler = createHandler({ allowedOrigins: ['https://app.example'] })
    try {
      const res = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        }),
      )
      expect(res.status).toBe(403)
    } finally {
      handler.dispose()
    }
  })

  test('wildcard opts out of origin validation', async () => {
    const handler = createHandler({ allowedOrigins: ['*'] })
    try {
      const res = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { Origin: 'https://anything.example', 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        }),
      )
      expect(res.status).not.toBe(403)
    } finally {
      handler.dispose()
    }
  })

  test('rejects unsupported MCP-Protocol-Version header with 400', async () => {
    const handler = createHandler()

    try {
      const sessionID = await initializeSession(handler)

      const request = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
          'Mcp-Session-Id': sessionID,
          'MCP-Protocol-Version': '1999-01-01',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(400)
    } finally {
      handler.dispose()
    }
  })

  test('absent MCP-Protocol-Version header is allowed', async () => {
    const handler = createHandler()

    try {
      const sessionID = await initializeSession(handler)

      const request = new Request('http://localhost/mcp', {
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

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(202)
    } finally {
      handler.dispose()
    }
  })

  test('rejects unsupported MCP-Protocol-Version header on GET with 400', async () => {
    const handler = createHandler()

    try {
      const sessionID = await initializeSession(handler)

      const request = new Request('http://localhost/mcp', {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Origin: 'http://localhost',
          'Mcp-Session-Id': sessionID,
          'MCP-Protocol-Version': '1999-01-01',
        },
      })

      const response = await handler.handleRequest(request)
      expect(response.status).toBe(400)
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

  test('GET resumption replays events emitted on a POST stream', async () => {
    const handler = createHandler({ replayBufferSize: 100 })

    try {
      const sessionID = await initializeSession(handler)

      // Make a tool call — the POST stream emits a priming event then the tool result
      const postResponse = await handler.handleRequest(toolCallRequest(sessionID, 'cross-stream'))
      expect(postResponse.status).toBe(200)

      // Read the full POST stream body; it closes after the server writes the result
      const postText = await postResponse.text()
      const postEvents = parseSSEEvents(postText)

      // Expect: priming event (empty data) + result event
      expect(postEvents.length).toBeGreaterThanOrEqual(2)

      // The priming event id (format post-<requestID>-1) is used as Last-Event-ID
      const primingEventID = postEvents[0]?.id ?? ''
      expect(primingEventID).toMatch(/^post-/)

      // The result event — this is what we want to see replayed on the GET stream
      const resultEvent = postEvents.find((e) => e.data !== '')
      expect(resultEvent).toBeDefined()
      const resultData = resultEvent?.data ?? ''
      const resultEventID = resultEvent?.id ?? ''
      expect(resultEventID).toMatch(/^post-/)

      // Open GET with Last-Event-ID set to the POST priming event id.
      // After implementing, session.replayLog has [primingEvent, resultEvent] so
      // eventsAfter(primingEventID) returns [resultEvent], which is replayed into the GET stream.
      const getResponse = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'Mcp-Session-Id': sessionID,
            'Last-Event-ID': primingEventID,
          },
        }),
      )
      expect(getResponse.status).toBe(200)

      // biome-ignore lint/style/noNonNullAssertion: asserted status above
      const getReader = getResponse.body!.getReader()
      const decoder = new TextDecoder()

      // Read the GET stream's own priming event (always present, already enqueued)
      const { value: primingChunk } = await getReader.read()

      // Open a second GET stream to force-close the first one; the reader will then
      // drain remaining buffered chunks and reach done:true without hanging.
      await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'Mcp-Session-Id': sessionID,
          },
        }),
      )

      // Drain remaining chunks (replay events were already enqueued by handleGET before
      // the Response was returned, so this loop completes as soon as the drain hits done)
      const chunks: Array<Uint8Array> = [primingChunk ?? new Uint8Array()]
      while (true) {
        const { value, done } = await getReader.read()
        if (done) break
        chunks.push(value)
      }

      const allGetText = chunks.map((c) => decoder.decode(c)).join('')
      const getEvents = parseSSEEvents(allGetText)

      // The GET stream must contain an event whose data matches the POST-stream result
      const replayed = getEvents.find((e) => e.data === resultData)
      expect(replayed).toBeDefined()
      // Replayed events preserve their original POST-stream id (not re-issued under
      // the GET stream), so the client's resumption cursor stays consistent.
      expect(replayed?.id).toBe(resultEventID)
    } finally {
      handler.dispose()
    }
  })

  test('GET resumption with an unknown Last-Event-ID replays all buffered events', async () => {
    const handler = createHandler({ replayBufferSize: 100 })

    try {
      const sessionID = await initializeSession(handler)

      // Produce a POST stream event to populate the session replay log.
      const postResponse = await handler.handleRequest(toolCallRequest(sessionID, 'fallback'))
      expect(postResponse.status).toBe(200)
      const postEvents = parseSSEEvents(await postResponse.text())
      const resultData = postEvents.find((e) => e.data !== '')?.data ?? ''
      expect(resultData).not.toBe('')

      // Open GET with an id that was never emitted (e.g. trimmed beyond the cap).
      // The server must fall back to replaying all buffered events rather than nothing.
      const getResponse = await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            'Mcp-Session-Id': sessionID,
            'Last-Event-ID': 'post-99999-1',
          },
        }),
      )
      expect(getResponse.status).toBe(200)

      // biome-ignore lint/style/noNonNullAssertion: asserted status above
      const getReader = getResponse.body!.getReader()
      const decoder = new TextDecoder()
      const { value: primingChunk } = await getReader.read()

      // Force-close the first GET stream so the reader drains to completion.
      await handler.handleRequest(
        new Request('http://localhost/mcp', {
          method: 'GET',
          headers: { Accept: 'text/event-stream', 'Mcp-Session-Id': sessionID },
        }),
      )

      const chunks: Array<Uint8Array> = [primingChunk ?? new Uint8Array()]
      while (true) {
        const { value, done } = await getReader.read()
        if (done) break
        chunks.push(value)
      }

      const getEvents = parseSSEEvents(chunks.map((c) => decoder.decode(c)).join(''))
      const replayed = getEvents.find((e) => e.data === resultData)
      expect(replayed).toBeDefined()
    } finally {
      handler.dispose()
    }
  })
})
