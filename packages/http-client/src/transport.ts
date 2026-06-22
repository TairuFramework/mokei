import { Transport } from '@enkaku/transport'
import type { ClientTransport } from '@mokei/context-client'
import { ContextClient, type ContextTypes, type UnknownContextTypes } from '@mokei/context-client'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { LATEST_PROTOCOL_VERSION } from '@mokei/context-protocol'
import { getMokeiLogger, type Logger } from '@mokei/logger'
import { createReadable, writeTo } from '@sozai/stream'
import { parseServerSentEvents } from 'parse-sse'

import { buildHTTPHeaders, type HTTPAuthOptions } from './auth.js'
import { SESSION_EXPIRED_CODE, SESSION_EXPIRED_MESSAGE } from './errors.js'
import { buildParamHeaders, collectHeaderAnnotations } from './x-mcp-header.js'

/** Standard JSON-RPC internal-error code, used for synthesized transport failures. */
const INTERNAL_ERROR_CODE = -32603

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
  /** Cached tool `inputSchema`s keyed by tool name, populated from `tools/list` results. */
  #toolSchemas = new Map<string, unknown>()
  /** Protocol version to send in `MCP-Protocol-Version` header; updated after initialize. */
  #protocolVersion: string = LATEST_PROTOCOL_VERSION
  #logger: Logger

  constructor(params: HTTPTransportParams) {
    const [readable, controller] = createReadable<ServerMessage>()
    const writable = writeTo<ClientMessage>(async (message) => {
      await this.#sendMessage(message)
    })
    super({ stream: { readable, writable } })
    this.#controller = controller
    this.#url = params.url
    this.#headers = buildHTTPHeaders(params.headers, params.auth)
    this.#timeout = params.timeout ?? DEFAULT_HTTP_TIMEOUT
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

    if (this.#disposed) {
      this.#failRequest(requestID, INTERNAL_ERROR_CODE, 'Transport is disposed')
      return
    }

    const headers: Record<string, string> = {
      ...this.#headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': this.#protocolVersion,
    }

    if ('method' in message && typeof message.method === 'string') {
      headers['Mcp-Method'] = message.method
      const name = (message as { params?: { name?: unknown } }).params?.name
      if (typeof name === 'string') {
        headers['Mcp-Name'] = name
      }
      // Track in-flight requests so responses can be correlated back to their method.
      if (requestID != null) {
        this.#pendingMethods.set(requestID, message.method)
      }
      // Mirror x-mcp-header-annotated tools/call arguments into Mcp-Param-* headers.
      // buildParamHeaders can throw (e.g. a non-integer value for an integer-annotated
      // param); route that to the originating request rather than letting it escape the
      // sink and poison the shared writable stream.
      if (message.method === 'tools/call' && typeof name === 'string') {
        const schema = this.#toolSchemas.get(name)
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

    if (this.#sessionID) {
      headers['Mcp-Session-Id'] = this.#sessionID
    }

    // The timeout guards time-to-headers only. Once a response begins, a long
    // streamed tool call must not be aborted — its own request-level timeout applies.
    const controller = new AbortController()
    const timeoutID = setTimeout(() => controller.abort(), this.#timeout)

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
      if (requestID != null) {
        this.#pendingMethods.delete(requestID)
      }
      const reason = controller.signal.aborted
        ? `Request timed out after ${this.#timeout}ms`
        : `Request failed: ${error instanceof Error ? error.message : String(error)}`
      this.#failRequest(requestID, INTERNAL_ERROR_CODE, reason)
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
      if (requestID != null) {
        this.#pendingMethods.delete(requestID)
      }
      this.#failRequest(requestID, SESSION_EXPIRED_CODE, SESSION_EXPIRED_MESSAGE)
      return
    }

    if (!response.ok) {
      let errorText = ''
      try {
        errorText = await response.text()
      } catch {
        // Body may be unreadable; the status alone is enough to surface the failure.
      }
      if (requestID != null) {
        this.#pendingMethods.delete(requestID)
      }
      this.#failRequest(requestID, INTERNAL_ERROR_CODE, `HTTP ${response.status}: ${errorText}`)
      return
    }

    const contentType = response.headers.get('Content-Type') ?? ''

    if (contentType.includes('application/json')) {
      let data: unknown
      try {
        data = await response.json()
      } catch {
        if (requestID != null) {
          this.#pendingMethods.delete(requestID)
        }
        this.#failRequest(requestID, INTERNAL_ERROR_CODE, 'Invalid JSON in response')
        return
      }
      if (data && this.#controller) {
        this.#controller.enqueue(this.#handleIncoming(data as ServerMessage))
      }
      if (requestID != null) {
        this.#pendingMethods.delete(requestID)
      }
    } else if (contentType.includes('text/event-stream')) {
      // Consume the SSE stream in the background so the sink unblocks as soon as the
      // response headers arrive. Awaiting here would serialize all other outgoing
      // traffic — including the notifications/cancelled meant to stop this very stream
      // — behind it. The correlation entry is reclaimed once the stream ends.
      void this.#handleSSEResponse(response)
        .catch((error) => {
          this.#logger.warn('SSE response stream failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          if (requestID != null) {
            this.#pendingMethods.delete(requestID)
          }
        })
    } else if (requestID != null) {
      // 202 Accepted or other no-content responses: nothing to enqueue, reclaim the entry.
      this.#pendingMethods.delete(requestID)
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
    this.#pendingMethods.delete(id)
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
          'MCP-Protocol-Version': this.#protocolVersion,
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

    // Terminate session with DELETE, bounded so a hung server can't stall shutdown.
    if (this.#sessionID) {
      try {
        await fetch(this.#url, {
          method: 'DELETE',
          headers: {
            ...this.#headers,
            'MCP-Protocol-Version': this.#protocolVersion,
            'Mcp-Session-Id': this.#sessionID,
          },
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

/**
 * Create an MCP HTTP client with a single call.
 *
 * Instantiates an {@link HTTPTransport} and wires it to a {@link ContextClient}.
 */
export function createHTTPClient<T extends ContextTypes = UnknownContextTypes>(
  params: HTTPTransportParams,
): ContextClient<T> {
  const transport = new HTTPTransport(params)
  return new ContextClient<T>({ transport: transport as ClientTransport })
}
