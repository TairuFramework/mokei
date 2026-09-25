import { Transport } from '@enkaku/transport'
import type { ClientParams, ClientTransport } from '@mokei/context-client'
import { ContextClient, type ContextTypes, type UnknownContextTypes } from '@mokei/context-client'
import type {
  ClientMessage,
  ProtocolVersion,
  RequestID,
  ServerMessage,
} from '@mokei/context-protocol'
import {
  HEADER_MISMATCH,
  isHandshakeRequired,
  isSupportedProtocolVersion,
  META_PROTOCOL_VERSION,
  PROTOCOLS,
} from '@mokei/context-protocol'
import { getMokeiLogger, type Logger } from '@mokei/logger'
import { EventEmitter } from '@sozai/event'
import { createReadable, writeTo } from '@sozai/stream'
import { parseServerSentEvents } from 'parse-sse'

import { buildHTTPHeaders, type HTTPAuthOptions } from './auth.js'
import { SESSION_EXPIRED_CODE, SESSION_EXPIRED_MESSAGE } from './errors.js'
import {
  buildParamHeaders,
  collectHeaderAnnotations,
  encodeHeaderValue,
  type HeaderAnnotation,
} from './x-mcp-header.js'

/** Standard JSON-RPC internal-error code, used for synthesized transport failures. */
const INTERNAL_ERROR_CODE = -32603

/**
 * Accept a JSON-RPC error in a failed HTTP response only for the matching request.
 * Match `errorResponse` validation: a looser check could leave the RPC caller waiting
 * forever; a stricter check would discard the code and `data` needed by `'auto'` clients.
 * JSON-RPC leaves `error.data` unconstrained.
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
 * Only an `Mcp-Param-*` mismatch can be fixed by refreshing the schema. The same
 * `-32020` also covers `Mcp-Method`, `Mcp-Name`, and `MCP-Protocol-Version`; absent or
 * unexpected server-defined `error.data` must not trigger a retry.
 */
function isParamHeaderMismatch(carried: Record<string, unknown>): boolean {
  const error = carried.error as { code?: unknown; data?: unknown } | undefined
  if (error?.code !== HEADER_MISMATCH) {
    return false
  }
  const data = error.data as { mismatch?: unknown } | undefined
  const header = (data?.mismatch as { header?: unknown } | undefined)?.header
  // Case-insensitive: HTTP field names are (RFC 9110), so a peer reporting `mcp-param-tenant`
  // names the same header and must not lose the retry.
  return typeof header === 'string' && header.toLowerCase().startsWith('mcp-param-')
}

/** Whether two `Mcp-Param-*` header sets carry the same names and the same values. */
function sameParamHeaders(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/**
 * Body fields used for `Mcp-Name` (specification/2026-07-28/basic/transports).
 * `resources/read` uses `uri`; unknown methods must not inherit a `name` header.
 * A `Map` avoids inherited `constructor`/`__proto__` lookups if methods become dynamic.
 */
const MCP_NAME_HEADER_SOURCE: ReadonlyMap<string, string> = new Map([
  ['tools/call', 'name'],
  ['prompts/get', 'name'],
  ['resources/read', 'uri'],
])

/** A `fetch`-shaped function: the unit a {@link FetchMiddleware} wraps and produces. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Wraps a {@link FetchLike} with another, e.g. to inject an OAuth `Authorization` header. */
export type FetchMiddleware = (next: FetchLike) => FetchLike

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
  /** Budget for the internal schema-refresh `tools/list` (default: 10000). */
  refreshTimeout?: number
  /** Optional logger (defaults to the `mokei:http-client` logger) */
  logger?: Logger
  /**
   * Raw seed for `MCP-Protocol-Version`, including legacy revisions outside
   * {@link ProtocolVersion}. Omit it on `initialize` as the specification requires:
   * `2025-11-25` learns the version from its result; `2026-07-28` declares it in `_meta`.
   * Unlike {@link CreateHTTPClientParams.protocolVersion}, this does not select the
   * revision the client speaks.
   */
  protocolVersionHeader?: string
  /** Wraps the transport's fetch (e.g. OAuth). Composed once over globalThis.fetch. */
  fetchMiddleware?: FetchMiddleware
}

/**
 * Whether a revision has protocol sessions to name in an `Mcp-Session-Id` header.
 *
 * Handshake-free revisions have no session. Preserve the header for unknown revisions
 * so a pass-through server can still handle a session-bearing revision.
 */
function hasSession(version: string | null): boolean {
  if (version == null || !isSupportedProtocolVersion(version)) {
    return true
  }
  return isHandshakeRequired(PROTOCOLS[version])
}

/** Default HTTP request timeout in milliseconds. */
export const DEFAULT_HTTP_TIMEOUT = 30_000

/**
 * Default budget for the internal schema-refresh `tools/list`, in milliseconds. Independent of
 * {@link HTTPTransportParams.timeout} so a firing stale-schema retry cannot triple the caller's
 * clock (original POST + refresh + re-send).
 */
export const DEFAULT_HTTP_REFRESH_TIMEOUT = 10_000

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
 * Implements MCP Streamable HTTP with POST exchanges and a GET notification stream.
 */
export class HTTPTransport extends Transport<ServerMessage, ClientMessage> {
  #url: string
  #headers: Record<string, string>
  #timeout: number
  #refreshTimeout: number
  #sessionID: string | null = null
  #lastEventID: string | null = null
  #retryMs: number | null = null
  #disposed = false
  #controller: ReadableStreamDefaultController<ServerMessage> | null = null
  #getStreamAbortController: AbortController | null = null
  /** Method of each in-flight request, keyed by request id (for response correlation). */
  #pendingMethods = new Map<string | number, string>()
  /**
   * Retain fetch controllers past the header timeout so cancellation can abort an exchange.
   * Only sessionless revisions treat a POST disconnect as cancellation.
   */
  #exchangeControllers = new Map<
    string | number,
    { cancelled: boolean; cancellable: boolean; controller: AbortController }
  >()
  /**
   * Outgoing responses and notifications have no id in this client's request space.
   * Track their POST controllers here so `dispose()` can abort them after the header
   * timeout. `notifications/cancelled` applies only to tracked requests; each POST
   * removes its controller on settlement to prevent a lasting reference.
   */
  #untrackedControllers = new Set<AbortController>()
  /** Counter behind the request ids the stale-schema refresh mints for its own `tools/list`. */
  #internalRequestCount = 0
  /**
   * Optional `StreamEventsTransport` capability: on abrupt SSE close, `ContextRPC`
   * settles the exchange through `ExchangeRegistry.close` so `subscriptions/listen`
   * can reconnect. Graceful terminals and deliberate cancellations must not fire it.
   */
  #streamEvents = new EventEmitter<{ closed: { requestID: RequestID; error?: Error } }>()

  #clearExchange(requestID: string | number): void {
    this.#pendingMethods.delete(requestID)
    this.#exchangeControllers.delete(requestID)
  }

  /**
   * Reclaim the tracked exchange or {@link #untrackedControllers} entry on every
   * POST settlement path; otherwise disposal retains completed controllers.
   */
  #releaseController(trackedID: string | number | null, controller: AbortController): void {
    if (trackedID != null) {
      this.#clearExchange(trackedID)
    } else {
      this.#untrackedControllers.delete(controller)
    }
  }

  /**
   * Cache valid `x-mcp-header` annotations and filter invalid tools (SEP-2243).
   * Partial headers would be rejected by the peer; ordinary lists and refreshes
   * must apply the same filter.
   */
  #cacheToolAnnotations(tools: Array<unknown>): Array<unknown> {
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
        this.#toolAnnotations.set(name, check.annotations)
      }
      kept.push(entry)
    }
    return kept
  }

  /**
   * Refresh annotations with an internal POST. Its response must not enter the RPC
   * queue: no caller owns its id. Keep {@link #handleIncoming}'s return contract.
   *
   * @param version Exchange revision, not `#protocolVersion`: handshake-free
   * `2026-07-28` leaves that field null (SEP-2243).
   * @param requestMeta Original `params._meta`, copied intact so required client
   * identity and capabilities survive. A duplicated progress token is less harmful
   * than dropping a future envelope field.
   * @returns Whether the annotations were refreshed.
   */
  async #refreshToolAnnotations(version: string | null, requestMeta: unknown): Promise<boolean> {
    const headers = this.#baseHeaders(version, version)
    headers['Mcp-Method'] = 'tools/list'

    // Copied verbatim (see @param requestMeta), with the version stamped in as a floor.
    const meta: Record<string, unknown> =
      requestMeta != null && typeof requestMeta === 'object'
        ? { ...(requestMeta as Record<string, unknown>) }
        : {}
    if (
      version != null &&
      isSupportedProtocolVersion(version) &&
      PROTOCOLS[version].requiresRequestMeta
    ) {
      meta[META_PROTOCOL_VERSION] = version
    }
    const params: Record<string, unknown> = Object.keys(meta).length > 0 ? { _meta: meta } : {}

    const controller = new AbortController()
    const timeoutID = setTimeout(() => controller.abort(), this.#refreshTimeout)
    this.#untrackedControllers.add(controller)
    try {
      const response = await this.#fetch(this.#url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          // An id in a space of this transport's own making. The response is read from the
          // fetch and never enqueued, so it cannot collide with the RPC layer's numeric ids.
          id: `mokei-internal:tools/list:${++this.#internalRequestCount}`,
          method: 'tools/list',
          params,
        }),
        signal: controller.signal,
      })
      // `Accept` must advertise SSE too, so declining a non-JSON body happens here instead.
      const contentType = response.headers.get('Content-Type') ?? ''
      if (!response.ok || !contentType.includes('application/json')) {
        return false
      }
      const data = (await response.json()) as { result?: { tools?: unknown } }
      const tools = data?.result?.tools
      if (!Array.isArray(tools)) {
        return false
      }
      this.#cacheToolAnnotations(tools)
      return true
    } catch {
      // A failed refresh is never the caller's error: the peer's own `-32020` is what surfaces.
      return false
    } finally {
      clearTimeout(timeoutID)
      this.#untrackedControllers.delete(controller)
    }
  }

  /**
   * Retry only if refreshed `Mcp-Param-*` headers differ; otherwise preserve the
   * peer's `-32020` diagnosis.
   * @returns Whether a resend suppressed the original error.
   */
  async #retryAfterSchemaRefresh(
    message: ClientMessage,
    sentParamHeaders: Record<string, string>,
  ): Promise<boolean> {
    const requestMeta = (message as { params?: { _meta?: unknown } }).params?._meta
    if (
      !(await this.#refreshToolAnnotations(
        this.#declaredVersion(message) ?? this.#protocolVersion,
        requestMeta,
      ))
    ) {
      return false
    }
    const name = (message as { params?: { name?: unknown } }).params?.name
    if (typeof name !== 'string') {
      return false
    }
    const annotations = this.#toolAnnotations.get(name)
    if (annotations == null) {
      return false
    }
    let fresh: Record<string, string>
    try {
      const args = (message as { params?: { arguments?: unknown } }).params?.arguments
      fresh = buildParamHeaders(
        annotations,
        args != null && typeof args === 'object' ? (args as Record<string, unknown>) : undefined,
      )
    } catch {
      // The fresh schema cannot encode these arguments at all.
      return false
    }
    if (sameParamHeaders(fresh, sentParamHeaders)) {
      return false
    }
    await this.#sendMessage(message, true)
    return true
  }

  /**
   * Cache validated `x-mcp-header` annotations per tool. Keeping the collected
   * values avoids rescanning schemas on every `tools/call`.
   */
  #toolAnnotations = new Map<string, Array<HeaderAnnotation>>()
  /**
   * Version for the `MCP-Protocol-Version` header when the outgoing message does not
   * declare one itself. Stays `null` until an `initialize` result or a constructor seed
   * supplies a value; while it is `null` and the message declares nothing, the header is
   * omitted.
   */
  #protocolVersion: string | null
  #logger: Logger
  #fetch: FetchLike

  constructor(params: HTTPTransportParams) {
    // OAuth middleware and static `Authorization` must not compete. Check bearer/basic,
    // header auth, and plain headers case-insensitively; other header auth may coexist.
    if (params.fetchMiddleware) {
      const auth = params.auth
      const authSetsAuthorization =
        auth != null &&
        (auth.type !== 'header' ||
          (auth.name != null && auth.name.toLowerCase() === 'authorization'))
      const headerSetsAuthorization =
        params.headers != null &&
        Object.keys(params.headers).some((k) => k.toLowerCase() === 'authorization')
      if (authSetsAuthorization || headerSetsAuthorization) {
        throw new Error(
          'Static `auth`/`headers` setting `Authorization` and `fetchMiddleware` are mutually exclusive (both set Authorization)',
        )
      }
    }

    const [readable, controller] = createReadable<ServerMessage>()
    const writable = writeTo<ClientMessage>(async (message) => {
      await this.#sendMessage(message)
    })
    super({ stream: { readable, writable } })
    this.#controller = controller
    this.#url = params.url
    this.#headers = buildHTTPHeaders({ headers: params.headers, auth: params.auth })
    this.#timeout = params.timeout ?? DEFAULT_HTTP_TIMEOUT
    this.#refreshTimeout = params.refreshTimeout ?? DEFAULT_HTTP_REFRESH_TIMEOUT
    this.#protocolVersion = params.protocolVersionHeader ?? null
    this.#logger = params.logger ?? getMokeiLogger('http-client')
    const baseFetch: FetchLike = (url, init) => globalThis.fetch(url, init)
    this.#fetch = params.fetchMiddleware ? params.fetchMiddleware(baseFetch) : baseFetch
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
   * Per-exchange stream-closed signal (see {@link #streamEvents}'s field doc).
   */
  get streamEvents(): EventEmitter<{ closed: { requestID: RequestID; error?: Error } }> {
    return this.#streamEvents
  }

  /**
   * Surface a send failure to its originating request as a JSON-RPC error response.
   *
   * A rejected sink poisons its shared writer and all later requests. Enqueue a
   * correlated error instead; log failures for notifications without an id.
   */
  #failRequest(requestID: string | number | null, code: number, errorMessage: string): void {
    if (requestID == null) {
      this.#logger.warn('Outgoing frame without a tracked exchange failed', { error: errorMessage })
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
   * Share the POST envelope with schema refresh. Suppress `Mcp-Session-Id` only when
   * the message declares a sessionless revision; an undeclared request retains its
   * session while `MCP-Protocol-Version` may fall back to `#protocolVersion`.
   */
  #baseHeaders(
    headerVersion: string | null,
    sessionVersion: string | null,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.#headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (headerVersion != null) {
      headers['MCP-Protocol-Version'] = headerVersion
    }
    if (this.#sessionID && hasSession(sessionVersion)) {
      headers['Mcp-Session-Id'] = this.#sessionID
    }
    return headers
  }

  /**
   * Send a JSON-RPC message to the server via HTTP POST.
   *
   * Route failures to {@link #failRequest} so one send cannot poison the shared
   * writer. `retried` bounds stale-schema recovery to one extra attempt.
   */
  async #sendMessage(message: ClientMessage, retried = false): Promise<void> {
    // Determine the request id up front so any early failure can be correlated.
    const rawID = (message as { id?: unknown }).id
    const requestID: string | number | null =
      typeof rawID === 'string' || typeof rawID === 'number' ? rawID : null
    // Only requests own exchanges. A response id belongs to the peer and may collide
    // with one of ours, so never use it for tracking or failure correlation.
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

    const headers: Record<string, string> = this.#baseHeaders(headerVersion, declaredVersion)
    // The `Mcp-Param-*` subset actually sent, so a stale-schema retry can tell a refresh that
    // changed something from one that changed nothing.
    let sentParamHeaders: Record<string, string> = {}

    if ('method' in message && typeof message.method === 'string') {
      headers['Mcp-Method'] = message.method
      const nameSourceField = MCP_NAME_HEADER_SOURCE.get(message.method)
      const params = (message as { params?: Record<string, unknown> }).params
      const nameValue = nameSourceField == null ? undefined : params?.[nameSourceField]
      if (typeof nameValue === 'string') {
        // Names and URIs may exceed the ByteString range accepted by `Headers`.
        // Encode per the specification before the peer cross-checks `Mcp-Name`.
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
        const annotations = this.#toolAnnotations.get(nameValue)
        if (annotations != null) {
          try {
            const args = (message as { params?: { arguments?: unknown } }).params?.arguments
            sentParamHeaders = buildParamHeaders(
              annotations,
              args != null && typeof args === 'object'
                ? (args as Record<string, unknown>)
                : undefined,
            )
            Object.assign(headers, sentParamHeaders)
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

    // The timer guards time-to-headers only. The controller outlives it: once a response
    // begins, a long streamed tool call must not be cut off by a timeout -- but it must still
    // be cuttable by an explicit cancellation.
    const controller = new AbortController()
    const timeoutID = setTimeout(() => controller.abort(), this.#timeout)
    if (trackedID != null) {
      this.#exchangeControllers.set(trackedID, {
        cancelled: false,
        cancellable: !hasSession(declaredVersion),
        controller,
      })
    } else {
      this.#untrackedControllers.add(controller)
    }

    let response: Response
    try {
      response = await this.#fetch(this.#url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeoutID)
      const entry = trackedID == null ? undefined : this.#exchangeControllers.get(trackedID)
      this.#releaseController(trackedID, controller)
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
      this.#releaseController(trackedID, controller)
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
      // Read cancellation before releasing its entry: `dispose()` may run after
      // response headers, and must not let a torn-down exchange retry.
      const wasCancelled =
        trackedID != null && this.#exchangeControllers.get(trackedID)?.cancelled === true
      this.#releaseController(trackedID, controller)
      // Preserve `2026-07-28` JSON-RPC errors inside HTTP 400: `'auto'` uses them
      // for revision detection, and pinned clients need the peer's diagnosis.
      const carried = parseJSONRPCError(errorText, trackedID)
      if (carried != null) {
        // One exception: a `-32020` naming an `Mcp-Param-*` header means the peer's tool schema
        // moved under this client. Refresh and re-send once.
        if (
          !retried &&
          !wasCancelled &&
          'method' in message &&
          message.method === 'tools/call' &&
          isParamHeaderMismatch(carried) &&
          (await this.#retryAfterSchemaRefresh(message, sentParamHeaders))
        ) {
          return
        }
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
        this.#releaseController(trackedID, controller)
        this.#failRequest(trackedID, INTERNAL_ERROR_CODE, 'Invalid JSON in response')
        return
      }
      if (data && this.#controller) {
        this.#controller.enqueue(this.#handleIncoming(data as ServerMessage))
      }
      this.#releaseController(trackedID, controller)
    } else if (contentType.includes('text/event-stream')) {
      // Consume SSE in the background so a long stream does not block outgoing
      // traffic, including its own cancellation. Reclaim tracking when it ends.
      void this.#handleSSEResponse(response, trackedID)
        .catch((error) => {
          if (trackedID != null && this.#exchangeControllers.get(trackedID)?.cancelled) {
            return
          }
          this.#logger.warn('SSE response stream failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          this.#releaseController(trackedID, controller)
        })
    } else {
      // 202 Accepted or other no-content responses: nothing to enqueue, reclaim the entry.
      this.#releaseController(trackedID, controller)
    }

    // After sending `notifications/initialized` with a session, open GET stream.
    if ('method' in message && message.method === 'notifications/initialized' && this.#sessionID) {
      this.#openGETStream()
    }
  }

  /**
   * Correlate an incoming message to its originating request. For `tools/list` results,
   * cache each tool's collected `x-mcp-header` annotations and exclude any tool whose
   * annotations are invalid, per SEP-2243.
   */
  #handleIncoming(message: ServerMessage): ServerMessage {
    // A server-initiated method owns its id space; clearing a matching local id
    // would lose the pending client request.
    if ('method' in message) {
      return message
    }
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
    const kept = this.#cacheToolAnnotations(tools)
    if (kept.length === tools.length) {
      return message
    }
    return { ...message, result: { ...result, tools: kept } } as ServerMessage
  }

  /**
   * Signal an abrupt POST SSE close only. A terminal, cancellation, or disposal
   * already settles the exchange; GET has no request id to signal.
   */
  #emitStreamClosed(trackedID: string | number | null, terminalSeen: boolean, error?: Error): void {
    if (trackedID == null || terminalSeen || this.#disposed) {
      return
    }
    if (this.#exchangeControllers.get(trackedID)?.cancelled) {
      return
    }
    this.#streamEvents.fire(
      'closed',
      error ? { requestID: trackedID, error } : { requestID: trackedID },
    )
  }

  /**
   * Parse SSE messages. `trackedID` is the POST request id, or null for GET.
   * Only a JSON-RPC response with that id counts as a terminal; notifications
   * and progress updates must not suppress {@link #streamEvents} on abrupt close.
   */
  async #handleSSEResponse(
    response: Response,
    trackedID: string | number | null = null,
  ): Promise<void> {
    const stream = parseServerSentEvents(response)
    const reader = stream.getReader()
    let terminalSeen = false

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
            if (
              trackedID != null &&
              !('method' in message) &&
              (message as { id?: unknown }).id === trackedID
            ) {
              // A JSON-RPC response naming this request: the graceful terminal for this
              // exchange, as opposed to a notification or progress update sharing the stream.
              terminalSeen = true
            }
            if (this.#controller) {
              this.#controller.enqueue(this.#handleIncoming(message))
            }
          } catch {
            // Skip events with non-JSON data
          }
        }
      }
      this.#emitStreamClosed(trackedID, terminalSeen)
    } catch (error) {
      this.#emitStreamClosed(
        trackedID,
        terminalSeen,
        error instanceof Error ? error : new Error(String(error)),
      )
      throw error
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Open a background GET SSE stream for server-initiated messages.
   */
  #openGETStream(): void {
    if (this.#disposed) return

    // Abort any prior loop (e.g. a duplicate `notifications/initialized`) so it can't
    // outlive its controller and keep reconnecting in the background.
    this.#getStreamAbortController?.abort()
    this.#getStreamAbortController = new AbortController()

    // Fire-and-forget: the reconnect loop runs until the transport is disposed.
    void this.#runGETStream(this.#getStreamAbortController.signal)
  }

  /**
   * Reconnect GET with capped backoff and {@link #lastEventID} after a blip;
   * stop on abort, disposal, unsupported GET (405), or an expired session (404).
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

        const response = await this.#fetch(this.#url, { method: 'GET', headers, signal })

        if (response.status === 405 || response.status === 404) {
          // 405: server does not offer a GET notification stream. 404: session gone.
          // Either way reconnecting cannot help -- stop quietly.
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

    // Abort in-flight exchanges, including endless SSE bodies. Keep entries marked
    // cancelled until their own cleanup: eager deletion could race a catch handler
    // and enqueue a spurious error before the controller closes.
    for (const entry of this.#exchangeControllers.values()) {
      entry.cancelled = true
      entry.controller.abort()
    }

    // Untracked POSTs also need abort; their catch/finally removes each controller.
    for (const controller of this.#untrackedControllers) {
      controller.abort()
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
        await this.#fetch(this.#url, {
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

/**
 * {@link createHTTPClient} parameters: transport params plus {@link ClientParams},
 * excluding the constructed transport. `protocolVersion` is redeclared for its
 * separate contract below; its type is unchanged.
 */
export type CreateHTTPClientParams = HTTPTransportParams &
  Omit<ClientParams, 'transport' | 'protocolVersion'> & {
    /**
     * Revision to speak. `'auto'` probes the server, then caches the result.
     *
     * Distinct from {@link HTTPTransportParams.protocolVersionHeader}, the optional raw seed
     * for the `MCP-Protocol-Version` header: this field drives `ContextClient` negotiation and
     * is stripped before the transport is constructed, so it never reaches `HTTPTransport`
     * itself.
     */
    protocolVersion: ProtocolVersion | 'auto'
  }

/**
 * `satisfies Record<keyof HTTPTransportParams, true>` forces new transport fields
 * into this routing table. Without that check, a new field could silently reach
 * `ContextClient` instead of `HTTPTransport`.
 */
const HTTP_TRANSPORT_PARAM_KEYS = {
  url: true,
  headers: true,
  auth: true,
  timeout: true,
  refreshTimeout: true,
  logger: true,
  protocolVersionHeader: true,
  fetchMiddleware: true,
} satisfies Record<keyof HTTPTransportParams, true>

/**
 * Create an MCP HTTP client with a single call.
 *
 * Pass transport fields to {@link HTTPTransport} and every other
 * {@link ClientParams} field to {@link ContextClient}, including MRTR handlers
 * (SEP-2322). Enumerating client fields here once dropped new options silently;
 * {@link HTTP_TRANSPORT_PARAM_KEYS} is compile-checked instead.
 */
export function createHTTPClient<T extends ContextTypes = UnknownContextTypes>(
  params: CreateHTTPClientParams,
): ContextClient<T> {
  const transportParams: Record<string, unknown> = {}
  const clientParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (key in HTTP_TRANSPORT_PARAM_KEYS) {
      transportParams[key] = value
    } else {
      clientParams[key] = value
    }
  }
  const transport = new HTTPTransport(transportParams as HTTPTransportParams)
  return new ContextClient<T>({
    ...(clientParams as Omit<ClientParams, 'transport'>),
    transport: transport as ClientTransport,
  })
}
