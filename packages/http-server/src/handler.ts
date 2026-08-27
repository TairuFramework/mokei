import { Transport } from '@enkaku/transport'
import {
  type ClientMessage,
  isSupportedProtocolVersion,
  PROTOCOLS,
  type ProtocolVersion,
  type ServerMessage,
} from '@mokei/context-protocol'
import type { ContextServer, ServerTransport, SubscriptionHub } from '@mokei/context-server'
import { getMokeiLogger, type Logger } from '@mokei/logger'
import { createRuntime, type Runtime } from '@sozai/runtime'

import { appendReplay, eventsAfter, type Session, SessionManager } from './session.js'
import { createSSEStream, SSE_RESPONSE_HEADERS } from './sse-stream.js'
import { type SSEEvent, SSEWriter } from './sse-writer.js'
import {
  DEFAULT_STATELESS_TIMEOUT_MS,
  readRequestProtocolVersion,
  runStatelessExchange,
} from './stateless.js'
import { runSubscriptionExchange } from './subscriptions.js'

export type HTTPHandlerParams = {
  /**
   * Builds a `ContextServer` for one connection. The object form threads the optional durable
   * {@link HTTPHandlerParams.subscriptionHub} through so a server can borrow it, and — for a
   * `subscriptions/listen` POST — the per-POST `connectionID` minted from {@link runtime}. Both
   * are absent on the session/initialize path; a server that ignores them behaves as before.
   */
  createServer: (params: {
    transport: ServerTransport
    subscriptionHub?: SubscriptionHub
    connectionID?: string
  }) => ContextServer
  /**
   * A durable `SubscriptionHub` the caller owns (e.g. a long-lived `ContextServer` with
   * `subscriptions: true`, or `createSubscriptionHub`). When present, a `2026-07-28`
   * `subscriptions/listen` POST is served against a transport-isolated per-POST server that
   * *borrows* this hub; without one, a listen POST gets `METHOD_NOT_FOUND`. The handler never
   * owns or disposes the hub it is handed — the caller does.
   *
   * Dispose ordering matters. The per-POST servers this handler creates are *borrowers* of the
   * hub, not its owner: calling `dispose()` on the value returned by `serveHTTP(...)` (or on
   * `handler.dispose()`) does NOT gracefully complete open subscriptions — it is the abrupt
   * backstop only, and every open `subscriptions/listen` stream is torn down abruptly (no
   * terminal frame written) if that's all that runs. To get graceful, terminal-writing teardown
   * of open subscriptions, the caller must first gracefully complete/dispose the durable
   * hub-owning `ContextServer` (or call `hub.endAllGracefully()` directly) — and only then call
   * `serveHTTP(...).dispose()` / `handler.dispose()`.
   */
  subscriptionHub?: SubscriptionHub
  /**
   * RN-safe runtime primitives (`@sozai/runtime`). Resolved once via `createRuntime` and threaded
   * to `runSubscriptionExchange`, which mints each listen POST's `connectionID` from its
   * `getRandomID()`. Defaults are filled in when omitted.
   */
  runtime?: Partial<Runtime>
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
  /** Maximum accepted POST body size in bytes (default: 4 MiB). Oversized bodies get a 413. */
  maxBodyBytes?: number
  /**
   * How long a stateless `2026-07-28` exchange waits for its server to respond
   * (default: 30000).
   */
  statelessTimeoutMs?: number
  /**
   * How many stateless exchanges may be in flight at once (default:
   * {@link DEFAULT_MAX_STATELESS_EXCHANGES}). Past the cap a POST is refused with `503` before
   * anything is built for it.
   *
   * The session path's `maxSessions` has no reach here — a stateless exchange has no session —
   * and `statelessTimeoutMs` is not a substitute: that timer is cleared by the first thing the
   * server writes, so a tool that emits one progress notification and then blocks holds its
   * throwaway `ContextServer`, transport and connection for as long as the caller keeps reading.
   */
  maxStatelessExchanges?: number
  /**
   * How many `subscriptions/listen` exchanges may be in flight at once (default:
   * {@link DEFAULT_MAX_SUBSCRIPTION_EXCHANGES}). Past the cap a listen POST is refused with `503`
   * before anything is built for it.
   *
   * Tracked separately from `maxStatelessExchanges`: a listen is meant to sit open indefinitely,
   * so it is deliberately excluded from that cap — but each one still holds a whole per-POST
   * `ContextServer`, its transport, an SSE response and a hub entry for its entire lifetime, so it
   * needs a bound of its own or an unbounded number of open listens could exhaust the deployment.
   */
  maxSubscriptionExchanges?: number
  /** Optional logger (defaults to the `mokei:http-server` logger) */
  logger?: Logger
}

/** Default maximum accepted POST body size, in bytes (4 MiB). */
export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024

/**
 * Default cap on concurrent stateless exchanges.
 *
 * An order of magnitude below `maxSessions`' 1000 on purpose: a session is one *client*, whereas
 * a stateless exchange is one in-flight *request*, and each holds a whole `ContextServer` for as
 * long as its handler runs. Raise it deliberately for a server fronting many concurrent callers.
 */
export const DEFAULT_MAX_STATELESS_EXCHANGES = 100

/**
 * Default cap on concurrent `subscriptions/listen` exchanges.
 *
 * Each open listen holds a per-POST `ContextServer`, transport, SSE response and hub entry for as
 * long as the subscription lives, so — like `maxStatelessExchanges`, and for the same
 * one-request-holds-a-whole-server reason — it is bounded well below `maxSessions`. Raise it
 * deliberately for a deployment that expects many simultaneous long-lived subscribers.
 */
export const DEFAULT_MAX_SUBSCRIPTION_EXCHANGES = 100

export type HTTPHandler = {
  handleRequest: (request: Request) => Promise<Response>
  /**
   * Tears the handler down. Async because it disposes session servers and awaits every in-flight
   * `subscriptions/listen` server's bounded disposal (its held-response flush), so an awaiting
   * caller knows those terminals have been given their chance to write before proceeding.
   */
  dispose: () => Promise<void>
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
 * Read a request body as text, enforcing a maximum byte size. Returns `null` when
 * the body exceeds `maxBytes` so the caller can respond 413 — without first
 * buffering and parsing an unbounded payload (a cheap DoS otherwise). Checks the
 * declared Content-Length for a fast reject, then counts actual streamed bytes
 * (the header can be absent or wrong under chunked transfer).
 */
async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get('Content-Length')
  if (declared != null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > maxBytes) {
      return null
    }
  }

  const body = request.body
  if (body == null) {
    // No readable stream available (some runtimes/mocks): fall back to text() and
    // check the decoded size after the fact.
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      return null
    }
    return text
  }

  const reader = body.getReader()
  const chunks: Array<Uint8Array> = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

const DEFAULT_LOCALHOST_ORIGINS = [
  'http://localhost',
  'http://127.0.0.1',
  'http://[::1]',
  'https://localhost',
  'https://127.0.0.1',
  'https://[::1]',
]

export function createHTTPHandler(params: HTTPHandlerParams): HTTPHandler {
  const {
    createServer,
    allowedOrigins,
    sessionTimeoutMs = 300_000,
    maxSessions = 1000,
    replayBufferSize = 100,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    statelessTimeoutMs = DEFAULT_STATELESS_TIMEOUT_MS,
    maxStatelessExchanges = DEFAULT_MAX_STATELESS_EXCHANGES,
    maxSubscriptionExchanges = DEFAULT_MAX_SUBSCRIPTION_EXCHANGES,
    subscriptionHub,
    runtime: runtimeOverrides,
    logger = getMokeiLogger('http-server'),
  } = params

  // Resolved once and threaded to every listen exchange, which mints its per-POST `connectionID`
  // from `getRandomID()`. A single shared instance is the "handler's own runtime" the subscription
  // exchange doc refers to.
  const runtime = createRuntime(runtimeOverrides)

  // Map session IDs to their transport bridges
  const bridges = new Map<string, TransportBridge>()

  // Teardown handles for the stateless exchanges currently in flight, so shutting the
  // handler down ends them instead of leaving their throwaway servers un-disposed and
  // their callers waiting on the timeout. A keyless set on purpose: these handles are
  // shutdown bookkeeping, never addressable by anything a client sends.
  const statelessTeardowns = new Set<() => void>()

  // The same, for in-flight `subscriptions/listen` exchanges — plus the per-POST servers they
  // built, so `dispose()` can await each one's bounded held-response flush (not just fire its
  // abrupt teardown). A listen holds its server open indefinitely, so it is tracked separately
  // from `statelessTeardowns` and is not counted against `maxStatelessExchanges`.
  const listenTeardowns = new Set<() => void>()
  const listenServers = new Set<ContextServer>()

  // Map session IDs to promises that resolve when a specific request ID gets a response
  // Used for the initialize flow where we need to capture the response synchronously
  const initWaiters = new Map<
    string,
    { requestID: string | number; resolve: (message: ServerMessage) => void }
  >()

  // Release the transport bridge (and any pending init waiter) for a session.
  // Idempotent: safe to call from explicit DELETE, init failure, and the
  // SessionManager's idle-cleanup timer (via onDelete) without double-closing.
  function closeBridge(sessionID: string): void {
    const bridge = bridges.get(sessionID)
    if (bridge != null) {
      bridges.delete(sessionID)
      try {
        bridge.controller.close()
      } catch {
        // Controller may already be closed.
      }
    }
    initWaiters.delete(sessionID)
  }

  const sessions = new SessionManager({
    maxSessions,
    sessionTimeoutMs,
    // Ensures a timed-out session's bridge is torn down, not leaked.
    onDelete: closeBridge,
  })

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

    // Enforce a body-size cap before buffering/parsing to avoid an unbounded-memory DoS.
    const bodyText = await readBodyText(request, maxBodyBytes)
    if (bodyText == null) {
      return new Response('Payload Too Large', { status: 413 })
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }

    // Revisions that require per-request `_meta` carry their version in the request itself
    // and have no session, so they are served statelessly and any `Mcp-Session-Id` on them
    // is ignored, per the specification. The gate is `requiresRequestMeta` rather than the
    // mere presence of the `_meta` key: a session-based request is free to stamp that key
    // too, and pulling it off its session onto a throwaway server would silently discard
    // all of its session state.
    const requestVersion = readRequestProtocolVersion(body)
    if (
      requestVersion != null &&
      PROTOCOLS[requestVersion as ProtocolVersion]?.requiresRequestMeta
    ) {
      const headerVersion = request.headers.get('MCP-Protocol-Version')
      // An absent header is accepted: the body's `_meta` is what `ContextServer` resolves
      // the revision from, so the header is redundant confirmation for intermediaries. A
      // header that *contradicts* the body is rejected — one of the two is wrong, and
      // guessing which would let a stale proxy silently reroute a request.
      if (headerVersion != null && headerVersion !== requestVersion) {
        return new Response(
          `MCP-Protocol-Version header "${headerVersion}" does not match request _meta "${requestVersion}"`,
          { status: 400 },
        )
      }
      return await handleStateless(request, body)
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
        logger,
      })

      session.postStreams.set(requestID, sseWriter)

      // Send priming event
      await sseWriter.writePrimingEvent()

      return new Response(readable, {
        status: 200,
        headers: SSE_RESPONSE_HEADERS,
      })
    }

    return new Response('Invalid message', { status: 400 })
  }

  async function handleStateless(
    request: Request,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const rawID = body.id
    const requestID: string | number | null =
      typeof rawID === 'string' || typeof rawID === 'number' ? rawID : null

    // A `subscriptions/listen` POST is the one stateless request served against a held-open
    // stream rather than `runStatelessExchange`'s answer-then-close one — but only when a durable
    // hub is configured for it to borrow. Without a hub it falls through to `runStatelessExchange`
    // below, where the per-POST server (built with no hub) rejects the method with
    // `METHOD_NOT_FOUND`, exactly as the spec requires — no special-casing of the error here.
    if (body.method === 'subscriptions/listen' && subscriptionHub != null) {
      // Refuse before building anything, mirroring the `maxStatelessExchanges` gate below:
      // `listenTeardowns` holds exactly the listens currently in flight, and `Retry-After: 1`
      // because the condition frees as subscriptions end. A listen always carries an id, so an
      // id-less frame (which occupies no long-lived slot) is left to fall through and be handled.
      if (requestID != null && listenTeardowns.size >= maxSubscriptionExchanges) {
        return new Response('Too many subscription exchanges', {
          status: 503,
          headers: { 'Retry-After': '1' },
        })
      }
      return await handleListen(request, body, requestID)
    }

    // Refused before dispatch, mirroring the session path's `maxSessions` gate —
    // `statelessTeardowns` holds exactly the exchanges currently in flight, and `Retry-After: 1`
    // because the condition is transient by construction: the cap frees as handlers return.
    //
    // Gated on `requestID != null`, and therefore placed after the id is parsed rather than at
    // the top of this function: an id-less frame occupies no slot. `runStatelessExchange`
    // acknowledges it `202` and finishes it before `onStart` ever registers a teardown, so
    // refusing one at the cap would reject work the cap is not protecting anything from.
    //
    // Note what `requestID` actually tests: the presence of `body.id`, not the frame's kind. A
    // *response* carries an id, so it would take a slot and hold it until the exchange times
    // out. That is unreachable rather than handled — `handlePOST` routes here only on a
    // `params._meta` protocol version, and a response has no `params` at all, so one never
    // arrives. Anything that made responses routable would have to revisit this.
    if (requestID != null && statelessTeardowns.size >= maxStatelessExchanges) {
      return new Response('Too many stateless exchanges', {
        status: 503,
        headers: { 'Retry-After': '1' },
      })
    }

    return await runStatelessExchange({
      message: body as unknown as ClientMessage,
      requestID,
      // The stateless per-POST server borrows the durable hub (if any) so its advertised
      // capabilities — `resources.subscribe` in particular — match the listen path's. It never
      // registers a subscription itself, so no `connectionID` is threaded here.
      createServer: (transport) => createServer({ transport, subscriptionHub }),
      replayBufferSize,
      timeoutMs: statelessTimeoutMs,
      // The client hanging up is a stateless exchange's only cancellation channel.
      signal: request.signal,
      onStart: (teardown) => {
        statelessTeardowns.add(teardown)
      },
      onEnd: (teardown) => {
        statelessTeardowns.delete(teardown)
      },
      logger,
    })
  }

  /**
   * Serves a `subscriptions/listen` POST against a transport-isolated per-POST `ContextServer`
   * borrowing the durable {@link subscriptionHub}. Only reached with a hub configured (the caller
   * gates on it). The per-POST server is tracked so `dispose()` can await its bounded held-response
   * flush, and the exchange's abrupt teardown is tracked so a shutdown can end an idle listen; the
   * request signal drives the client-disconnect / response-body-cancellation teardown.
   */
  async function handleListen(
    request: Request,
    body: Record<string, unknown>,
    requestID: string | number | null,
  ): Promise<Response> {
    const hub = subscriptionHub as SubscriptionHub
    return await runSubscriptionExchange({
      message: body as unknown as ClientMessage,
      requestID,
      createServer: ({ transport, subscriptionHub: borrowed, connectionID }) => {
        const server = createServer({ transport, subscriptionHub: borrowed, connectionID })
        listenServers.add(server)
        void server.disposed.finally(() => {
          listenServers.delete(server)
        })
        return server
      },
      subscriptionHub: hub,
      replayBufferSize,
      // The handler's resolved runtime: the exchange mints its per-POST `connectionID` from it.
      runtime,
      // Client disconnect / response-body cancellation is a listen's teardown trigger.
      signal: request.signal,
      onStart: (teardown) => {
        listenTeardowns.add(teardown)
      },
      onEnd: (teardown) => {
        listenTeardowns.delete(teardown)
      },
      logger,
    })
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
      // A session server manages its own subscription lifecycle (via its own config); the
      // handler's durable hub is the stateless-path hub, so it is not threaded here.
      const server = createServer({ transport: bridge.transport })
      session.server = server
    } catch {
      // Deleting the session fires onDelete, which tears down the bridge.
      await sessions.delete(session.sessionID)
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
      // Deleting the session fires onDelete, which tears down the bridge.
      await sessions.delete(session.sessionID)
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
    // A revision with no handshake has no session to attach a stream to, and its
    // request-scoped notifications travel on that request's own POST response, so there is
    // nothing a GET stream could carry. Keyed on the header because a GET has no body; an
    // unrecognised or absent header leaves `protocol` nullish and falls through to the
    // session lookup below, which is what keeps a header-less `2025-11-25` GET working.
    const protocol = PROTOCOLS[request.headers.get('MCP-Protocol-Version') as ProtocolVersion]
    if (protocol != null && !protocol.requiresHandshake) {
      return new Response('Method not allowed', { status: 405 })
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
      logger,
    })

    session.getStream = sseWriter

    // Send priming event
    await sseWriter.writePrimingEvent()

    // Replay buffered events from across the session's streams, preserving
    // their original ids so the client's resumption cursor stays consistent.
    for (const event of replayEvents) {
      await sseWriter.writeRawEvent(event)
    }

    return new Response(readable, {
      status: 200,
      headers: SSE_RESPONSE_HEADERS,
    })
  }

  async function handleDELETE(request: Request): Promise<Response> {
    if (!validateOrigin(request)) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!validateProtocolVersion(request)) {
      return new Response('Unsupported MCP-Protocol-Version', { status: 400 })
    }
    // DELETE exists only to terminate a session, and a session is what a handshake
    // establishes: a revision without one never creates anything to terminate. Nullish for
    // an unrecognised or absent header, which falls through to the session lookup below.
    const protocol = PROTOCOLS[request.headers.get('MCP-Protocol-Version') as ProtocolVersion]
    if (protocol != null && !protocol.requiresHandshake) {
      return new Response('Method not allowed', { status: 405 })
    }

    const sessionID = request.headers.get('Mcp-Session-Id')
    if (sessionID == null) {
      return new Response('Mcp-Session-Id header required', { status: 400 })
    }

    const session = sessions.get(sessionID)
    if (session == null) {
      return new Response('Session not found', { status: 404 })
    }

    // Delete session (disposes server, closes all streams); onDelete releases the bridge.
    // Awaited so the 204 is not returned until the session server has actually been disposed.
    await sessions.delete(sessionID)

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
        return await handleDELETE(request)
      default:
        return new Response('Method not allowed', { status: 405 })
    }
  }

  async function dispose(): Promise<void> {
    // Snapshot the in-flight listen servers before any teardown runs: each server's disposal
    // removes it from the set (via its `disposed` handler), so the set is unsafe to await over
    // once teardown has begun.
    const listenServerSnapshot = [...listenServers]

    // Disposing the manager deletes every session, firing onDelete (closeBridge) for each —
    // which releases its bridge and init waiter. Awaited so each session server's disposal
    // (and its own held-response flush) completes before the handler is considered torn down.
    await sessions.dispose()

    // Backstop: release any bridge/waiter not tied to a live session.
    for (const sessionID of bridges.keys()) {
      closeBridge(sessionID)
    }
    initWaiters.clear()

    // Iterate a copy: each teardown removes its own handle from the set as it runs.
    for (const teardown of [...statelessTeardowns]) {
      teardown()
    }
    statelessTeardowns.clear()

    // End every in-flight listen: fire its abrupt teardown, then await each per-POST server's
    // bounded disposal. The server's own `_beforeTransportClose` + held-response flush (≤5s)
    // gives any resolved terminal its chance to write; `dispose()` resolves only once every one
    // of those has settled.
    for (const teardown of [...listenTeardowns]) {
      teardown()
    }
    listenTeardowns.clear()
    await Promise.all(listenServerSnapshot.map((server) => server.disposed))
    listenServers.clear()
  }

  return { handleRequest, dispose }
}
