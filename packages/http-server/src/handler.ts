import { Transport } from '@enkaku/transport'
import {
  type ClientMessage,
  isSupportedProtocolVersion,
  type ServerMessage,
} from '@mokei/context-protocol'
import type { ContextServer, ServerTransport } from '@mokei/context-server'

import { appendReplay, eventsAfter, type Session, SessionManager } from './session.js'
import { type SSEEvent, SSEWriter } from './sse-writer.js'

export type HTTPHandlerParams = {
  createServer: (transport: ServerTransport) => ContextServer
  /**
   * Controls Origin header validation:
   * - Unset (default): localhost-only. Requests without an Origin header (non-browser clients)
   *   are allowed. Requests with a foreign Origin are rejected (DNS-rebinding protection).
   * - `['*']`: Disable validation — all origins are accepted.
   * - Any other array: Exact-match allowlist. A missing Origin header is rejected.
   */
  allowedOrigins?: Array<string>
  sessionTimeoutMs?: number
  maxSessions?: number
  replayBufferSize?: number
}

export type HTTPHandler = {
  handleRequest: (request: Request) => Promise<Response>
  dispose: () => void
}

type TransportBridge = {
  controller: ReadableStreamDefaultController<ClientMessage>
  transport: ServerTransport
}

function isRequest(message: Record<string, unknown>): boolean {
  return 'method' in message && 'id' in message && !('result' in message) && !('error' in message)
}

function isResponse(message: Record<string, unknown>): boolean {
  return 'id' in message && ('result' in message || 'error' in message)
}

function isNotification(message: Record<string, unknown>): boolean {
  return 'method' in message && !('id' in message)
}

function isServerResponse(message: Record<string, unknown>): boolean {
  return 'id' in message && !('method' in message)
}

function isServerRequestOrNotification(message: Record<string, unknown>): boolean {
  return 'method' in message
}

/**
 * Create a stream pair for SSE output. The writable side accepts strings
 * (SSE-formatted text), and the readable side produces Uint8Array chunks
 * suitable for use as a Response body.
 */
function createSSEStream(): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<string>
} {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let closed = false

  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      closed = true
    },
  })

  const writable = new WritableStream<string>({
    write(chunk) {
      if (!closed) {
        controller.enqueue(encoder.encode(chunk))
      }
    },
    close() {
      if (!closed) {
        closed = true
        controller.close()
      }
    },
    abort(reason) {
      if (!closed) {
        closed = true
        controller.error(reason)
      }
    },
  })

  return { readable, writable }
}

export function createHTTPHandler(params: HTTPHandlerParams): HTTPHandler {
  const {
    createServer,
    allowedOrigins,
    sessionTimeoutMs = 300_000,
    maxSessions = 1000,
    replayBufferSize = 100,
  } = params

  const sessions = new SessionManager({ maxSessions, sessionTimeoutMs })

  // Map session IDs to their transport bridges
  const bridges = new Map<string, TransportBridge>()

  // Map session IDs to promises that resolve when a specific request ID gets a response
  // Used for the initialize flow where we need to capture the response synchronously
  const initWaiters = new Map<
    string,
    { requestID: string | number; resolve: (message: ServerMessage) => void }
  >()

  const DEFAULT_LOCALHOST_ORIGINS = [
    'http://localhost',
    'http://127.0.0.1',
    'http://[::1]',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
  ]

  function isLocalhostOrigin(origin: string): boolean {
    // Match scheme+host with any port: e.g. http://localhost:3000.
    return DEFAULT_LOCALHOST_ORIGINS.some(
      (base) => origin === base || origin.startsWith(`${base}:`),
    )
  }

  function validateOrigin(request: Request): boolean {
    // Explicit wildcard opts out entirely.
    if (allowedOrigins?.includes('*')) {
      return true
    }
    const origin = request.headers.get('Origin')
    if (allowedOrigins == null) {
      // Secure default: localhost only. No Origin header (non-browser client) is allowed.
      return origin == null || isLocalhostOrigin(origin)
    }
    // Allowlist configured: a missing Origin is not allowed.
    if (origin == null) {
      return false
    }
    return allowedOrigins.includes(origin)
  }

  function validateProtocolVersion(request: Request): boolean {
    const header = request.headers.get('MCP-Protocol-Version')
    // Absent header allowed for backward compatibility (treated as the version
    // negotiated at initialize). A present header must be supported.
    return header == null || isSupportedProtocolVersion(header)
  }

  function createTransportBridge(session: Session): TransportBridge {
    let controller!: ReadableStreamDefaultController<ClientMessage>

    const readable = new ReadableStream<ClientMessage>({
      start(c) {
        controller = c
      },
    })

    const writable = new WritableStream<ServerMessage>({
      async write(message) {
        const msg = message as unknown as Record<string, unknown>

        // Check if this is a response to an init waiter
        const waiter = initWaiters.get(session.sessionID)
        if (waiter != null && isServerResponse(msg) && msg.id === waiter.requestID) {
          initWaiters.delete(session.sessionID)
          waiter.resolve(message)
          return
        }

        // Is this a response? (has 'id', no 'method')
        if (isServerResponse(msg)) {
          const requestID = msg.id as string | number
          const postStream = session.postStreams.get(requestID)
          if (postStream != null) {
            await postStream.writeEvent({ data: JSON.stringify(message) })
            postStream.close()
            session.postStreams.delete(requestID)
          }
        }
        // Is this a server request or notification? (has 'method')
        else if (isServerRequestOrNotification(msg)) {
          if (session.getStream != null) {
            await session.getStream.writeEvent({ data: JSON.stringify(message) })
          } else {
            // Fall back to any active post stream
            const anyStream = session.postStreams.values().next().value
            if (anyStream != null) {
              await anyStream.writeEvent({ data: JSON.stringify(message) })
            }
          }
        }
      },
    })

    const transport = new Transport<ClientMessage, ServerMessage>({
      stream: { readable, writable },
    })

    return { controller, transport }
  }

  async function handlePOST(request: Request): Promise<Response> {
    if (!validateOrigin(request)) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!validateProtocolVersion(request)) {
      return new Response('Unsupported MCP-Protocol-Version', { status: 400 })
    }

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }

    const sessionID = request.headers.get('Mcp-Session-Id')

    // Initialize request: no session ID and message is 'initialize'
    if (sessionID == null && body.method === 'initialize') {
      return await handleInitialize(body as unknown as ClientMessage)
    }

    // All other POST requests require a session ID
    if (sessionID == null) {
      return new Response('Mcp-Session-Id header required', { status: 400 })
    }

    const session = sessions.get(sessionID)
    if (session == null) {
      return new Response('Session not found', { status: 404 })
    }

    sessions.touch(sessionID)

    const bridge = bridges.get(sessionID)
    if (bridge == null) {
      return new Response('Session transport not found', { status: 500 })
    }

    // Is this a notification or response? (no result expected)
    if (isNotification(body) || isResponse(body)) {
      bridge.controller.enqueue(body as unknown as ClientMessage)
      return new Response(null, { status: 202 })
    }

    // Is this a request? (expects a result)
    if (isRequest(body)) {
      const requestID = body.id as string | number

      bridge.controller.enqueue(body as unknown as ClientMessage)

      // Open SSE stream for the response
      const { readable, writable } = createSSEStream()
      const sseWriter = new SSEWriter({
        writable,
        streamID: `post-${requestID}`,
        replayBufferSize,
        onEvent: (event) => appendReplay(session, event, replayBufferSize),
      })

      session.postStreams.set(requestID, sseWriter)

      // Send priming event
      await sseWriter.writePrimingEvent()

      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    return new Response('Invalid message', { status: 400 })
  }

  async function handleInitialize(message: ClientMessage): Promise<Response> {
    let session: Session
    try {
      session = sessions.create()
    } catch {
      return new Response('Too many sessions', { status: 503 })
    }

    let bridge: TransportBridge
    try {
      bridge = createTransportBridge(session)
      bridges.set(session.sessionID, bridge)
      const server = createServer(bridge.transport)
      session.server = server
    } catch {
      bridges.delete(session.sessionID)
      sessions.delete(session.sessionID)
      return new Response('Server initialization failed', { status: 500 })
    }

    // Set up a waiter to capture the initialize response
    const msg = message as unknown as Record<string, unknown>
    const requestID = msg.id as string | number

    const responsePromise = new Promise<ServerMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        initWaiters.delete(session.sessionID)
        reject(new Error('Initialize timed out'))
      }, 30_000)
      // Don't prevent process exit
      if (typeof timeout === 'object' && 'unref' in timeout) {
        timeout.unref()
      }
      initWaiters.set(session.sessionID, {
        requestID,
        resolve: (message: ServerMessage) => {
          clearTimeout(timeout)
          resolve(message)
        },
      })
    })

    // Enqueue the initialize message to the transport
    bridge.controller.enqueue(message)

    let response: ServerMessage
    try {
      response = await responsePromise
    } catch {
      bridges.delete(session.sessionID)
      sessions.delete(session.sessionID)
      return new Response('Initialize timed out', { status: 504 })
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': session.sessionID,
      },
    })
  }

  async function handleGET(request: Request): Promise<Response> {
    if (!validateOrigin(request)) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!validateProtocolVersion(request)) {
      return new Response('Unsupported MCP-Protocol-Version', { status: 400 })
    }

    const sessionID = request.headers.get('Mcp-Session-Id')
    if (sessionID == null) {
      return new Response('Mcp-Session-Id header required', { status: 400 })
    }

    const session = sessions.get(sessionID)
    if (session == null) {
      return new Response('Session not found', { status: 404 })
    }

    sessions.touch(sessionID)

    // Check for Last-Event-ID for resumability -- resolve replay events across all
    // of the session's streams (POST and GET), not just the previous GET buffer.
    const lastEventID = request.headers.get('Last-Event-ID')
    const replayEvents: Array<SSEEvent> =
      lastEventID != null ? eventsAfter(session, lastEventID) : []

    // Close any existing GET stream
    if (session.getStream != null) {
      session.getStream.close()
      session.getStream = null
    }

    const { readable, writable } = createSSEStream()
    const sseWriter = new SSEWriter({
      writable,
      streamID: `get-${sessionID}`,
      replayBufferSize,
      onEvent: (event) => appendReplay(session, event, replayBufferSize),
    })

    session.getStream = sseWriter

    // Send priming event
    await sseWriter.writePrimingEvent()

    // Replay buffered events from the previous stream
    for (const event of replayEvents) {
      await sseWriter.writeEvent({ data: event.data })
    }

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  function handleDELETE(request: Request): Response {
    if (!validateOrigin(request)) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!validateProtocolVersion(request)) {
      return new Response('Unsupported MCP-Protocol-Version', { status: 400 })
    }

    const sessionID = request.headers.get('Mcp-Session-Id')
    if (sessionID == null) {
      return new Response('Mcp-Session-Id header required', { status: 400 })
    }

    const session = sessions.get(sessionID)
    if (session == null) {
      return new Response('Session not found', { status: 404 })
    }

    // Clean up the transport bridge
    const bridge = bridges.get(sessionID)
    if (bridge != null) {
      bridge.controller.close()
      bridges.delete(sessionID)
    }

    // Delete session (disposes server, closes all streams)
    sessions.delete(sessionID)

    return new Response(null, { status: 204 })
  }

  async function handleRequest(request: Request): Promise<Response> {
    const method = request.method.toUpperCase()

    switch (method) {
      case 'POST':
        return await handlePOST(request)
      case 'GET':
        return await handleGET(request)
      case 'DELETE':
        return handleDELETE(request)
      default:
        return new Response('Method not allowed', { status: 405 })
    }
  }

  function dispose(): void {
    // Close all transport bridges
    for (const [sessionID, bridge] of bridges) {
      try {
        bridge.controller.close()
      } catch {
        // Ignore errors during cleanup
      }
      bridges.delete(sessionID)
    }

    // Clear all init waiters
    initWaiters.clear()

    // Dispose all sessions
    sessions.dispose()
  }

  return { handleRequest, dispose }
}
