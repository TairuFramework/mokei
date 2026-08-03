import { Transport } from '@enkaku/transport'
import type { ClientTransport } from '@mokei/context-client'
import { ContextClient, type ContextTypes, type UnknownContextTypes } from '@mokei/context-client'
import type { ClientMessage, ProtocolVersion, ServerMessage } from '@mokei/context-protocol'
import {
  isSupportedProtocolVersion,
  META_PROTOCOL_VERSION,
  PROTOCOLS,
} from '@mokei/context-protocol'
import { getMokeiLogger, type Logger } from '@mokei/logger'
import { createReadable, writeTo } from '@sozai/stream'
import { parseServerSentEvents } from 'parse-sse'

import { buildHTTPHeaders, type HTTPAuthOptions } from './auth.js'
import { SESSION_EXPIRED_CODE, SESSION_EXPIRED_MESSAGE } from './errors.js'
import { buildParamHeaders, collectHeaderAnnotations, encodeHeaderValue } from './x-mcp-header.js'

/** Standard JSON-RPC internal-error code, used for synthesized transport failures. */
const INTERNAL_ERROR_CODE = -32603

/**
 * A JSON-RPC error response carried in a non-OK HTTP body, or `null` if the body is not one
 * — or names a different request, which would mean routing an error to the wrong caller.
 *
 * The accepted shape is deliberately no looser than what the RPC layer's inbound validator
 * admits: a response failing that validation is dropped there rather than rejected, and no
 * timeout covers an ordinary request, so an under-checked frame would leave its caller waiting
 * forever. It must be no *stricter* either, for the mirror-image reason: a frame refused here
 * comes back as a synthesized internal error whose message is the raw body, losing the code and
 * `data` an `'auto'` client reads. So the two checks below are exactly the constraints
 * `errorResponse` places on an error object, and `error.data` — whose value JSON-RPC leaves
 * entirely to the server — is checked here no more than it is there.
 */
function parseJSONRPCError(
  body: string,
  requestID: string | number | null,
): Record<string, unknown> | null {
  if (requestID == null || body === '') {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (parsed == null || typeof parsed !== 'object') {
    return null
  }
  const record = parsed as Record<string, unknown>
  const error = record.error
  if (
    record.jsonrpc !== '2.0' ||
    record.id !== requestID ||
    error == null ||
    typeof error !== 'object'
  ) {
    return null
  }
  const errorRecord = error as Record<string, unknown>
  return typeof errorRecord.code === 'number' && typeof errorRecord.message === 'string'
    ? record
    : null
}

/**
 * The methods whose `Mcp-Name` request header mirrors a field of the request body, and which
 * field supplies it (specification/2026-07-28/basic/transports, standard request headers).
 *
 * Keyed by method rather than read off whatever `name` a body happens to carry: the source
 * field is not the same for all three — `resources/read` names its subject in `uri` — and a
 * method outside this table must not acquire the header just because its params carry a `name`.
 * A method the specification adds later then arrives here as a missing entry, which a
 * conformant peer rejects visibly, rather than as a header quietly built from the wrong field.
 */
const MCP_NAME_HEADER_SOURCE: Readonly<Record<string, string | undefined>> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
}

/**
 * Parameters for creating an MCP HTTP transport.
 */
export type HTTPTransportParams = {
  /** URL of the MCP HTTP endpoint */
  url: string
  /** Optional custom headers */
  headers?: Record<string, string>
  /** Optional authentication */
  auth?: HTTPAuthOptions
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Optional logger (defaults to the `mokei:http-client` logger) */
  logger?: Logger
  /**
   * Seeds the `MCP-Protocol-Version` header before any revision is known. Rarely needed:
   * a `2026-07-28` request declares its revision in its own `_meta`, and a `2025-11-25`
   * connection learns it from the `initialize` result. Left unset, the header is omitted
   * until one of those two supplies a value — which is what the specification asks for on
   * the `initialize` request itself.
   */
  protocolVersion?: string
}

/**
 * Whether a revision has protocol sessions to name in an `Mcp-Session-Id` header.
 *
 * A session is established by the `initialize`/`initialized` handshake, so a revision that
 * does not require the handshake has no session at all. Unknown revisions are treated as
 * session-bearing: suppressing the header on a revision this build does not recognise would
 * break a connection that a pass-through server might otherwise handle.
 */
function hasSession(version: string | null): boolean {
  if (version == null || !isSupportedProtocolVersion(version)) {
    return true
  }
  return PROTOCOLS[version].requiresHandshake
}

/** Default HTTP request timeout in milliseconds. */
export const DEFAULT_HTTP_TIMEOUT = 30_000

/** Base delay before reconnecting the GET notification stream, when the server gives no `retry`. */
export const DEFAULT_GET_RECONNECT_BASE_MS = 1_000

/** Floor for the reconnect base, so a server `retry: 0` hint can't drive the loop into a hot spin. */
export const MIN_GET_RECONNECT_MS = 100

/** Maximum backoff delay between GET notification stream reconnect attempts. */
export const MAX_GET_RECONNECT_MS = 30_000

/** Timeout for the session-termination DELETE issued on dispose. */
export const DEFAULT_DISPOSE_TIMEOUT = 5_000

/**
 * MCP Streamable HTTP client transport.
 *
 * Implements the MCP Streamable HTTP transport specification:
 * - POST requests for sending JSON-RPC messages
 * - Handles JSON and SSE responses
 * - Manages Mcp-Session-Id lifecycle
 * - Opens a GET SSE stream for server-initiated messages after initialization
 */
export class HTTPTransport extends Transport<ServerMessage, ClientMessage> {
  #url: string
  #headers: Record<string, string>
  #timeout: number
  #sessionID: string | null = null
  #lastEventID: string | null = null
  #retryMs: number | null = null
  #disposed = false
  #controller: ReadableStreamDefaultController<ServerMessage> | null = null
  #getStreamAbortController: AbortController | null = null
  /** Method of each in-flight request, keyed by request id (for response correlation). */
  #pendingMethods = new Map<string | number, string>()
  /**
   * The in-flight fetch of each request, keyed by request id. Retained past response headers —
   * unlike the time-to-headers timer — so an outgoing `notifications/cancelled` can hang up on
   * the exchange. `cancellable` is true only for a revision without protocol sessions, where
   * the server handles each POST on its own and reads the disconnect as a cancellation.
   */
  #exchangeControllers = new Map<
    string | number,
    { cancelled: boolean; cancellable: boolean; controller: AbortController }
  >()

  #clearExchange(requestID: string | number): void {
    this.#pendingMethods.delete(requestID)
    this.#exchangeControllers.delete(requestID)
  }
  /** Cached tool `inputSchema`s keyed by tool name, populated from `tools/list` results. */
  #toolSchemas = new Map<string, unknown>()
  /**
   * Version for the `MCP-Protocol-Version` header when the outgoing message does not
   * declare one itself. Stays `null` until an `initialize` result or a constructor seed
   * supplies a value; while it is `null` and the message declares nothing, the header is
   * omitted.
   */
  #protocolVersion: string | null
  #logger: Logger

  constructor(params: HTTPTransportParams) {
    const [readable, controller] = createReadable<ServerMessage>()
    const writable = writeTo<ClientMessage>(async (message) => {
      await this.#sendMessage(message)
    })
    super({ stream: { readable, writable } })
    this.#controller = controller
    this.#url = params.url
    this.#headers = buildHTTPHeaders({ headers: params.headers, auth: params.auth })
    this.#timeout = params.timeout ?? DEFAULT_HTTP_TIMEOUT
    this.#protocolVersion = params.protocolVersion ?? null
    this.#logger = params.logger ?? getMokeiLogger('http-client')
  }

  /**
   * Get the current session ID.
   */
  get sessionID(): string | null {
    return this.#sessionID
  }

  /**
   * Get the last event ID received from SSE streams.
   */
  get lastEventID(): string | null {
    return this.#lastEventID
  }

  /**
   * Get the retry interval in milliseconds, if specified by the server.
   */
  get retryMs(): number | null {
    return this.#retryMs
  }

  /**
   * Surface a send failure to its originating request as a JSON-RPC error response.
   *
   * Sink writes must never throw: the writable side caches a single writer, so a
   * rejected sink permanently errors the stream and every later `request()` fails.
   * Instead we enqueue an error frame correlated by request id — the RPC read loop
   * rejects exactly that pending request, leaving the transport usable. Failed
   * notifications (no id) have no originator to reject and are dropped with a log.
   */
  #failRequest(requestID: string | number | null, code: number, errorMessage: string): void {
    if (requestID == null) {
      this.#logger.warn('Outgoing notification failed', { error: errorMessage })
      return
    }
    if (this.#controller == null) {
      return
    }
    try {
      this.#controller.enqueue({
        jsonrpc: '2.0',
        id: requestID,
        error: { code, message: errorMessage },
      } as unknown as ServerMessage)
    } catch {
      // Controller may already be closed by a concurrent dispose(); nothing to surface.
    }
  }

  /**
   * The revision an outgoing message declares in its own `_meta`, if any. Revisions with
   * `requiresRequestMeta` put it there on every request, which makes the header derivable
   * rather than tracked: transport and payload can never disagree about which revision a
   * message belongs to.
   */
  #declaredVersion(message: ClientMessage): string | null {
    const params = (message as { params?: unknown }).params
    if (params == null || typeof params !== 'object') {
      return null
    }
    const meta = (params as Record<string, unknown>)._meta
    if (meta == null || typeof meta !== 'object') {
      return null
    }
    const version = (meta as Record<string, unknown>)[META_PROTOCOL_VERSION]
    return typeof version === 'string' ? version : null
  }

  /**
   * Send a JSON-RPC message to the server via HTTP POST.
   *
   * Never throws: per-message failures are routed to {@link #failRequest} so a
   * single failed send cannot poison the shared writable stream.
   */
  async #sendMessage(message: ClientMessage): Promise<void> {
    // Determine the request id up front so any early failure can be correlated.
    const rawID = (message as { id?: unknown }).id
    const requestID: string | number | null =
      typeof rawID === 'string' || typeof rawID === 'number' ? rawID : null
    // Only an outgoing *request* owns an exchange-tracking entry, a synthesized failure frame,
    // or a carried HTTP-level error: a *response* also carries an `id`, but from the peer's own
    // id space, which starts at 0 just like this client's own request ids. Keying any of that
    // bookkeeping on a response's id risks registering, clearing, or failing whatever request
    // happens to share the number instead. `trackedID` is `null` for a response (and for a
    // notification, which already has no id), so every site below that used to key on
    // `requestID` keys on `trackedID` instead.
    const trackedID = requestID != null && 'method' in message ? requestID : null

    if (this.#disposed) {
      this.#failRequest(trackedID, INTERNAL_ERROR_CODE, 'Transport is disposed')
      return
    }

    if (
      'method' in message &&
      message.method === 'notifications/cancelled' &&
      typeof (message as { params?: { requestId?: unknown } }).params?.requestId !== 'undefined'
    ) {
      const cancelledID = (message as { params: { requestId: string | number } }).params.requestId
      const entry = this.#exchangeControllers.get(cancelledID)
      if (entry?.cancellable) {
        // Aborting the fetch is what a stateless server observes as the disconnect it already
        // handles. The notification is still POSTed below: a peer may want the record, and on
        // the session path it is the only cancellation channel there is.
        entry.cancelled = true
        entry.controller.abort()
      }
    }

    const declaredVersion = this.#declaredVersion(message)
    const headerVersion = declaredVersion ?? this.#protocolVersion

    const headers: Record<string, string> = {
      ...this.#headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (headerVersion != null) {
      headers['MCP-Protocol-Version'] = headerVersion
    }

    if ('method' in message && typeof message.method === 'string') {
      headers['Mcp-Method'] = message.method
      const nameSourceField = MCP_NAME_HEADER_SOURCE[message.method]
      const params = (message as { params?: Record<string, unknown> }).params
      const nameValue = nameSourceField == null ? undefined : params?.[nameSourceField]
      if (typeof nameValue === 'string') {
        // Encoded, never raw: a resource URI (and a tool or prompt name) is unconstrained text,
        // while an HTTP header value is a ByteString — `new Headers()` throws on any character
        // above U+00FF, which `fetch` does internally, so a raw assignment here turns
        // `readResource({ uri: 'file:///文档/notes.md' })` into an opaque send failure. The
        // `=?base64?…?=` sentinel is the specification's own encoding for header-carried values,
        // and a conformant peer runs `Mcp-Name` through that decoder before cross-checking it
        // against `params.name`/`params.uri`, so the encoded form is what it compares.
        headers['Mcp-Name'] = encodeHeaderValue(nameValue)
      }
      // Track in-flight requests so responses can be correlated back to their method.
      if (requestID != null) {
        this.#pendingMethods.set(requestID, message.method)
      }
      // Mirror x-mcp-header-annotated tools/call arguments into Mcp-Param-* headers.
      // buildParamHeaders can throw (e.g. a non-integer value for an integer-annotated
      // param); route that to the originating request rather than letting it escape the
      // sink and poison the shared writable stream.
      if (message.method === 'tools/call' && typeof nameValue === 'string') {
        const schema = this.#toolSchemas.get(nameValue)
        if (schema != null) {
          try {
            const { annotations } = collectHeaderAnnotations(schema)
            const args = (message as { params?: { arguments?: unknown } }).params?.arguments
            Object.assign(
              headers,
              buildParamHeaders(
                annotations,
                args != null && typeof args === 'object'
                  ? (args as Record<string, unknown>)
                  : undefined,
              ),
            )
          } catch (error) {
            if (requestID != null) {
              this.#pendingMethods.delete(requestID)
            }
            this.#failRequest(
              requestID,
              INTERNAL_ERROR_CODE,
              `Failed to encode request headers: ${error instanceof Error ? error.message : String(error)}`,
            )
            return
          }
        }
      }
    }

    // A revision without the handshake has no protocol session. Sending a session id on
    // such a request would ask a multi-revision server to route it into session state it
    // must ignore, so the header is suppressed for exactly the requests that declare such
    // a revision — a `2025-11-25` connection on the same transport keeps its session.
    if (this.#sessionID && hasSession(declaredVersion)) {
      headers['Mcp-Session-Id'] = this.#sessionID
    }

    // The timer guards time-to-headers only. The controller outlives it: once a response
    // begins, a long streamed tool call must not be cut off by a timeout — but it must still
    // be cuttable by an explicit cancellation.
    const controller = new AbortController()
    const timeoutID = setTimeout(() => controller.abort(), this.#timeout)
    if (trackedID != null) {
      this.#exchangeControllers.set(trackedID, {
        cancelled: false,
        cancellable: !hasSession(declaredVersion),
        controller,
      })
    }

    let response: Response
    try {
      response = await fetch(this.#url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeoutID)
      const entry = trackedID == null ? undefined : this.#exchangeControllers.get(trackedID)
      if (trackedID != null) {
        this.#clearExchange(trackedID)
      }
      if (entry?.cancelled) {
        // The caller already rejected this exchange locally; a second error frame for a
        // settled id is noise.
        return
      }
      const reason = controller.signal.aborted
        ? `Request timed out after ${this.#timeout}ms`
        : `Request failed: ${error instanceof Error ? error.message : String(error)}`
      this.#failRequest(trackedID, INTERNAL_ERROR_CODE, reason)
      return
    }
    clearTimeout(timeoutID)

    // Capture session ID from response
    const newSessionID = response.headers.get('Mcp-Session-Id')
    if (newSessionID) {
      this.#sessionID = newSessionID
    }

    if (response.status === 404 && this.#sessionID != null) {
      // Spec MUST: a 404 on an active session means it is gone. Clear it and surface
      // a coded error so the client can detect it (isSessionExpiredCode) and re-initialize.
      this.#sessionID = null
      if (trackedID != null) {
        this.#clearExchange(trackedID)
      }
      this.#failRequest(trackedID, SESSION_EXPIRED_CODE, SESSION_EXPIRED_MESSAGE)
      return
    }

    if (!response.ok) {
      let errorText = ''
      try {
        errorText = await response.text()
      } catch {
        // Body may be unreadable; the status alone is enough to surface the failure.
      }
      if (trackedID != null) {
        this.#clearExchange(trackedID)
      }
      // A `2026-07-28` server answers an envelope failure with a real HTTP `400` whose body
      // is the JSON-RPC error itself (unsupported revision, missing required `_meta`). That
      // body is the whole signal an `'auto'` client uses to tell a current server from an
      // older one, and the only actionable message a pinned client can show — so pass it
      // through verbatim rather than flattening it into an internal error.
      const carried = parseJSONRPCError(errorText, trackedID)
      if (carried != null) {
        try {
          this.#controller?.enqueue(carried as unknown as ServerMessage)
        } catch {
          // Controller may already be closed by a concurrent dispose(); nothing to surface.
          // Throwing here would reject the sink and permanently error the writable stream.
        }
        return
      }
      this.#failRequest(trackedID, INTERNAL_ERROR_CODE, `HTTP ${response.status}: ${errorText}`)
      return
    }

    const contentType = response.headers.get('Content-Type') ?? ''

    if (contentType.includes('application/json')) {
      let data: unknown
      try {
        data = await response.json()
      } catch {
        if (trackedID != null) {
          this.#clearExchange(trackedID)
        }
        this.#failRequest(trackedID, INTERNAL_ERROR_CODE, 'Invalid JSON in response')
        return
      }
      if (data && this.#controller) {
        this.#controller.enqueue(this.#handleIncoming(data as ServerMessage))
      }
      if (trackedID != null) {
        this.#clearExchange(trackedID)
      }
    } else if (contentType.includes('text/event-stream')) {
      // Consume the SSE stream in the background so the sink unblocks as soon as the
      // response headers arrive. Awaiting here would serialize all other outgoing
      // traffic — including the notifications/cancelled meant to stop this very stream
      // — behind it. The correlation entry is reclaimed once the stream ends.
      void this.#handleSSEResponse(response)
        .catch((error) => {
          if (trackedID != null && this.#exchangeControllers.get(trackedID)?.cancelled) {
            return
          }
          this.#logger.warn('SSE response stream failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          if (trackedID != null) {
            this.#clearExchange(trackedID)
          }
        })
    } else if (trackedID != null) {
      // 202 Accepted or other no-content responses: nothing to enqueue, reclaim the entry.
      this.#clearExchange(trackedID)
    }

    // After sending notifications/initialized with a session, open GET stream
    if ('method' in message && message.method === 'notifications/initialized' && this.#sessionID) {
      this.#openGETStream()
    }
  }

  /**
   * Correlate an incoming message to its originating request. For `tools/list` results,
   * cache each tool's `inputSchema` and exclude any tool carrying invalid
   * `x-mcp-header` annotations, per SEP-2243.
   */
  #handleIncoming(message: ServerMessage): ServerMessage {
    const id = (message as { id?: unknown }).id
    if (typeof id !== 'string' && typeof id !== 'number') {
      return message
    }
    const method = this.#pendingMethods.get(id)
    if (method == null) {
      return message
    }
    this.#clearExchange(id)
    if (method === 'initialize') {
      const version = (message as { result?: { protocolVersion?: unknown } }).result
        ?.protocolVersion
      if (typeof version === 'string') {
        this.#protocolVersion = version
      }
      return message
    }
    if (method !== 'tools/list') {
      return message
    }
    const result = (message as { result?: { tools?: unknown } }).result
    const tools = result?.tools
    if (!Array.isArray(tools)) {
      return message
    }
    const kept: Array<unknown> = []
    for (const entry of tools) {
      const name = (entry as { name?: unknown })?.name
      const inputSchema = (entry as { inputSchema?: unknown })?.inputSchema
      const check = collectHeaderAnnotations(inputSchema)
      if (!check.valid) {
        this.#logger.warn('Excluding tool with invalid x-mcp-header annotation', {
          tool: String(name),
          errors: check.errors,
        })
        continue
      }
      if (typeof name === 'string') {
        this.#toolSchemas.set(name, inputSchema)
      }
      kept.push(entry)
    }
    if (kept.length === tools.length) {
      return message
    }
    return { ...message, result: { ...result, tools: kept } } as ServerMessage
  }

  /**
   * Handle an SSE response, parsing events and enqueuing messages.
   */
  async #handleSSEResponse(response: Response): Promise<void> {
    const stream = parseServerSentEvents(response)
    const reader = stream.getReader()

    try {
      while (true) {
        const { done, value: event } = await reader.read()
        if (done) break

        if (event.lastEventId) {
          this.#lastEventID = event.lastEventId
        }
        if (event.retry != null) {
          this.#retryMs = event.retry
        }
        if (event.data && event.data.trim() !== '') {
          try {
            const message = JSON.parse(event.data) as ServerMessage
            if (this.#controller) {
              this.#controller.enqueue(this.#handleIncoming(message))
            }
          } catch {
            // Skip events with non-JSON data
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Open a background GET SSE stream for server-initiated messages.
   */
  #openGETStream(): void {
    if (this.#disposed) return

    // Abort any prior loop (e.g. a duplicate notifications/initialized) so it can't
    // outlive its controller and keep reconnecting in the background.
    this.#getStreamAbortController?.abort()
    this.#getStreamAbortController = new AbortController()

    // Fire-and-forget: the reconnect loop runs until the transport is disposed.
    void this.#runGETStream(this.#getStreamAbortController.signal)
  }

  /**
   * Maintain the GET SSE stream for server-initiated messages, reconnecting with
   * capped exponential backoff after any disconnect. A single network blip must
   * not permanently silence server notifications. Resumes from {@link #lastEventID}
   * on each attempt and stops only on dispose/abort or a server signal that the
   * stream is unsupported (405) or the session is gone (404).
   */
  async #runGETStream(signal: AbortSignal): Promise<void> {
    let attempt = 0
    while (!this.#disposed && !signal.aborted) {
      try {
        const headers: Record<string, string> = {
          ...this.#headers,
          Accept: 'text/event-stream',
        }
        if (this.#protocolVersion != null) {
          headers['MCP-Protocol-Version'] = this.#protocolVersion
        }
        if (this.#sessionID) {
          headers['Mcp-Session-Id'] = this.#sessionID
        }
        // Resume from the last seen event so no server notifications are dropped.
        if (this.#lastEventID) {
          headers['Last-Event-ID'] = this.#lastEventID
        }

        const response = await fetch(this.#url, { method: 'GET', headers, signal })

        if (response.status === 405 || response.status === 404) {
          // 405: server does not offer a GET notification stream. 404: session gone.
          // Either way reconnecting cannot help — stop quietly.
          return
        }
        if (!response.ok) {
          throw new Error(`GET stream HTTP ${response.status}`)
        }

        // Connected: a successful stream resets the backoff so a later blip starts fresh.
        attempt = 0
        await this.#handleSSEResponse(response)
        // Clean end (server closed the stream): reconnect after the base delay.
      } catch (error) {
        if (this.#disposed || signal.aborted) {
          return
        }
        this.#logger.warn('GET notification stream disconnected; will reconnect', {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      if (this.#disposed || signal.aborted) {
        return
      }

      // Floor the server-supplied retry hint so retry: 0 can't drive a no-delay hot loop.
      const base = Math.max(MIN_GET_RECONNECT_MS, this.#retryMs ?? DEFAULT_GET_RECONNECT_BASE_MS)
      const delay = Math.min(MAX_GET_RECONNECT_MS, base * 2 ** attempt)
      attempt += 1
      await this.#sleep(delay, signal)
    }
  }

  /**
   * Resolve after `ms`, or immediately if `signal` aborts first.
   */
  #sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      const onAbort = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Dispose of the transport.
   */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true

    // Cancel the GET stream
    if (this.#getStreamAbortController) {
      this.#getStreamAbortController.abort()
      this.#getStreamAbortController = null
    }

    // Abort every in-flight exchange. The #disposed guard above stops new sends, but an
    // exchange already past it — including a POST whose SSE body never ends — must not
    // outlive dispose: any transport close, dispose or peer EOF, aborts in-flight work, and
    // leaving one running is the exact symptom cancellation exists to fix, one path over.
    // Marking `cancelled` (rather than deleting the entry here) routes the resulting
    // rejection through the same silent-return path a notifications/cancelled abort takes —
    // each exchange reclaims its own entry via #clearExchange when its catch/finally runs,
    // same as it already does for an explicit cancel. Deleting eagerly here would race that:
    // a catch that fires after this loop but before #controller is closed below would find no
    // entry, skip the cancelled check, and enqueue a spurious error frame.
    for (const entry of this.#exchangeControllers.values()) {
      entry.cancelled = true
      entry.controller.abort()
    }

    // Terminate session with DELETE, bounded so a hung server can't stall shutdown.
    if (this.#sessionID) {
      try {
        const headers: Record<string, string> = {
          ...this.#headers,
          'Mcp-Session-Id': this.#sessionID,
        }
        if (this.#protocolVersion != null) {
          headers['MCP-Protocol-Version'] = this.#protocolVersion
        }
        await fetch(this.#url, {
          method: 'DELETE',
          headers,
          signal: AbortSignal.timeout(DEFAULT_DISPOSE_TIMEOUT),
        })
      } catch {
        // Ignore errors (including the timeout abort) during cleanup.
      }
    }

    if (this.#controller) {
      try {
        this.#controller.close()
      } catch {
        // Controller may already be closed
      }
    }

    await super.dispose()
  }
}

/** Parameters for {@link createHTTPClient}. */
export type CreateHTTPClientParams = HTTPTransportParams & {
  /** Revision to speak. `'auto'` probes the server, then caches the result. */
  protocolVersion: ProtocolVersion | 'auto'
}

/**
 * Create an MCP HTTP client with a single call.
 *
 * Instantiates an {@link HTTPTransport} and wires it to a {@link ContextClient}.
 */
export function createHTTPClient<T extends ContextTypes = UnknownContextTypes>(
  params: CreateHTTPClientParams,
): ContextClient<T> {
  const { protocolVersion, ...transportParams } = params
  const transport = new HTTPTransport(transportParams)
  return new ContextClient<T>({
    protocolVersion,
    transport: transport as ClientTransport,
  })
}
