import type {
  CallToolRequest,
  CallToolResult,
  ClientCapabilities,
  ClientMessage,
  ClientNotifications,
  ClientRequests,
  ClientResult,
  CompleteRequest,
  CompleteResult,
  CreateMessageRequest,
  CreateMessageResult,
  DiscoverResult,
  ElicitRequest,
  ElicitResult,
  GetPromptRequest,
  GetPromptResult,
  Implementation,
  InitializeRequest,
  InitializeResult,
  ListPromptsRequest,
  ListPromptsResult,
  ListResourcesRequest,
  ListResourcesResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListToolsRequest,
  ListToolsResult,
  Log,
  LoggingLevel,
  Metadata,
  ProgressNotification,
  ProtocolDefinition,
  ProtocolVersion,
  ReadResourceRequest,
  ReadResourceResult,
  Result,
  Root,
  ServerMessage,
  ServerNotification,
  ServerRequest,
  SetLevelRequest,
} from '@mokei/context-protocol'
import {
  type ErrorResponse,
  inferSchemaDraft,
  METHOD_NOT_FOUND,
  PROTOCOLS,
  serverMessage,
} from '@mokei/context-protocol'
import {
  ContextRPC,
  type RequestOptions,
  RequestTimeoutError,
  RPCError,
  splitRequestOptions,
  type WithRequestOptions,
} from '@mokei/context-rpc'
import { lazy } from '@sozai/async'
import { createValidator, type Schema, type Validator } from '@sozai/schema'

import { currentTraceMeta } from './trace.js'
import type { ClientTransport } from './types.js'

const validateServerMessage = createValidator(serverMessage)

export const DEFAULT_CLIENT_INFO: Implementation = {
  name: 'Mokei',
  version: '0.4.0',
}

// '2025-11-25' rather than the latest protocol version: it is the only supported revision
// that has an `initialize` handshake at all. '2026-07-28' has no `initialize` request
// (`requiresHandshake: false`), so declaring it here would describe a handshake no revision
// can legitimately send. `#initialize()` always overrides this with the resolved protocol's
// own version before sending, so this default is never sent as-is.
export const DEFAULT_INITIALIZE_PARAMS: InitializeRequest['params'] = {
  capabilities: {},
  clientInfo: DEFAULT_CLIENT_INFO,
  protocolVersion: '2025-11-25',
}

export const DEFAULT_INITIALIZE_TIMEOUT = 30_000

/** Default cap on pages fetched by a single list walk. */
export const DEFAULT_LIST_MAX_PAGES = 100

/** Max notifications buffered once a reader is attached; oldest dropped past this. */
const NOTIFICATION_BUFFER_CAP = 256

export class UnsupportedProtocolVersionError extends Error {
  constructor(received: string, expected: ProtocolVersion) {
    super(`Server responded with unsupported protocolVersion "${received}"; expected "${expected}"`)
    this.name = 'UnsupportedProtocolVersionError'
  }
}

export class CapabilityNotDeclaredError extends Error {
  constructor(capability: string) {
    super(`Server did not declare the "${capability}" capability`)
    this.name = 'CapabilityNotDeclaredError'
  }
}

/**
 * Thrown by `setLoggingLevel()` on a protocol revision whose `clientMethods` carries no
 * `logging/setLevel` — derived from that table, not a version literal, so this fires exactly
 * when the method itself is gone. `2026-07-28` removes the session-level opt-in: the log
 * level travels per request instead, via `_meta` (see `ClientParams.logLevel`).
 */
export class LoggingLevelNotSupportedError extends Error {
  constructor(version: ProtocolVersion) {
    super(
      `logging/setLevel does not exist in protocol version ${version}: the log level travels per request via _meta instead (see ClientParams.logLevel)`,
    )
    this.name = 'LoggingLevelNotSupportedError'
  }
}

/**
 * Thrown when a client is configured with a `createMessage`/`elicit`/`listRoots` handler on a
 * protocol revision whose `serverMethods` carries no way to invoke it — the client-side mirror
 * of `@mokei/context-server`'s `MRTRNotSupportedError`. `2026-07-28` has no server-initiated
 * requests: `sampling/createMessage`, `elicitation/create` and `roots/list` are replaced by
 * multi round-trip requests (MRTR, SEP-2322), which mokei does not implement yet.
 */
export class MRTRNotSupportedError extends Error {
  constructor(handler: string) {
    super(
      `The "${handler}" handler is not supported on protocol version 2026-07-28: sampling, elicitation and roots are replaced by multi round-trip requests (MRTR, SEP-2322), which mokei does not implement yet`,
    )
    this.name = 'MRTRNotSupportedError'
  }
}

/** Thrown when a server returns an `input_required` result: MRTR (SEP-2322) is not implemented yet. */
export class InputRequiredNotSupportedError extends Error {
  constructor() {
    super(
      'The server returned an "input_required" result: multi round-trip requests (MRTR, SEP-2322) are not implemented yet',
    )
    this.name = 'InputRequiredNotSupportedError'
  }
}

/** Thrown when a paginated list walk fetches more pages than its cap allows. */
export class ListMaxPagesError extends Error {
  /** The list method that exceeded the cap, e.g. `tools/list`. */
  method: string
  /** Number of pages fetched before giving up. */
  pages: number
  /** Cursor of the page that would have been fetched next. */
  cursor: string
  /** Items collected across the pages that were fetched. */
  results: Array<unknown>

  constructor(method: string, pages: number, cursor: string, results: Array<unknown>) {
    super(`Listing ${method} exceeded the maximum of ${pages} pages`)
    this.name = 'ListMaxPagesError'
    this.method = method
    this.pages = pages
    this.cursor = cursor
    this.results = results
  }
}

/**
 * Pagination and transport options accepted by the paginated list methods, alongside the
 * request's own params.
 *
 * `signal` aborts the walk, cancelling the request in flight; `timeout` applies to each
 * page request, not to the walk as a whole.
 */
export type ListOptions = RequestOptions & {
  /** Overrides `ClientParams.listMaxPages` for this call. */
  maxPages?: number
}

/** Params of a paginated list method: its wire params plus {@link ListOptions}. */
export type ListParams<Params> = Params & ListOptions

/**
 * Splits a list method's parameters into the params sent on the wire and the options kept
 * local to this process.
 *
 * The counterpart to `splitRequestOptions` for the paginated methods, which carry one
 * local-only option it does not know about: `maxPages`. Any paginated method must split
 * here rather than there, or the cap is serialized into the request sent to the peer.
 */
export function splitListOptions<Params>(
  params: ListParams<Params>,
): [Params, ListOptions & RequestOptions] {
  const { maxPages, ...rest } = params as ListParams<Record<string, unknown>>
  const [wireParams, options] = splitRequestOptions(rest)
  return [wireParams as Params, { ...options, maxPages }]
}

/** A validation issue, matching the shape `createTool` produces for input errors. */
export type ValidationIssue = {
  message: string
  path?: ReadonlyArray<PropertyKey>
}

/** Thrown when a tool result's structuredContent violates the tool's advertised outputSchema. */
export class StructuredContentValidationError extends Error {
  toolName: string
  issues: Array<ValidationIssue>

  constructor(toolName: string, issues: Array<ValidationIssue>) {
    super(`Invalid structuredContent returned by tool ${toolName}`)
    this.name = 'StructuredContentValidationError'
    this.toolName = toolName
    this.issues = issues
  }
}

/**
 * A server-initiated request handed to a client handler: the request's params, plus the
 * signal that aborts if the server cancels it.
 *
 * Mirrors `HandlerRequest` on the server side, so a handler is one object either way.
 */
export type ClientHandlerRequest<Params = Record<string, never>> = {
  params: Params
  signal: AbortSignal
}

export type ElicitHandler = (
  request: ClientHandlerRequest<ElicitRequest['params']>,
) => ElicitResult | Promise<ElicitResult>

export type CreateMessageHandler = (
  request: ClientHandlerRequest<CreateMessageRequest['params']>,
) => CreateMessageResult | Promise<CreateMessageResult>

export type ListRootsHandler = (
  request: Omit<ClientHandlerRequest, 'params'>,
) => Array<Root> | Promise<Array<Root>>

export type ClientEvents = {
  closed: { error?: Error }
  initialized: InitializeResult
  log: Log
}

type HandleNotification = ProgressNotification | ServerNotification

type ClientTypes = {
  Events: ClientEvents
  MessageIn: ServerMessage
  MessageOut: ClientMessage
  HandleNotification: HandleNotification
  HandleRequest: ServerRequest
  SendNotifications: ClientNotifications
  SendRequests: ClientRequests
  SendResult: ClientResult
}

export type ContextTypes = {
  Prompts?: Record<string, Record<string, unknown> | never>
  Tools?: Record<string, Record<string, unknown>>
}

export type UnknownContextTypes = {
  Prompts: Record<string, Record<string, unknown>>
  Tools: Record<string, Record<string, unknown>>
}

/**
 * Params of a named call, as a union of one member per name — so `arguments` is the type of
 * *that* name's arguments.
 *
 * The obvious shape, `{ name: keyof M & string; arguments: M[keyof M] }`, is wrong: it takes
 * the union of every entry's arguments and correlates it with nothing, so calling tool `a`
 * with tool `b`'s arguments type-checks. Distributing over the keys keeps the two tied.
 */
type NamedParams<M> = {
  [K in keyof M & string]: {
    name: K
    arguments: M[K] extends undefined ? never : M[K]
    _meta?: Metadata
  }
}[keyof M & string]

export type PromptParams<T extends ContextTypes> = NamedParams<T['Prompts']>

export type ToolParams<T extends ContextTypes> = NamedParams<T['Tools']>

export type ClientParams = {
  /** Revision to speak. `'auto'` probes the server, then caches the result. */
  protocolVersion: ProtocolVersion | 'auto'
  clientInfo?: Implementation
  createMessage?: CreateMessageHandler
  elicit?: ElicitHandler
  listMaxPages?: number
  listRoots?: Array<Root> | ListRootsHandler
  logLevel?: LoggingLevel
  /** Bounds both the 2025-11-25 handshake and the `'auto'` probe. */
  setupTimeout?: number
  /** @deprecated Renamed to `setupTimeout`. */
  initializeTimeout?: number
  transport: ClientTransport
}

type PagedResult = { nextCursor?: string } & Record<string, unknown>

export class ContextClient<
  T extends ContextTypes = UnknownContextTypes,
> extends ContextRPC<ClientTypes> {
  #capabilities: ClientCapabilities
  #clientInfo: Implementation
  #createMessage?: CreateMessageHandler
  #discovered: { result: DiscoverResult; expiresAt: number } | null = null
  #discovering: Promise<DiscoverResult> | null = null
  #elicit?: ElicitHandler
  #initialized: PromiseLike<InitializeResult>
  #listMaxPages: number
  #listRoots?: Array<Root> | ListRootsHandler
  #logLevel?: LoggingLevel
  #notificationBuffer: Array<HandleNotification> = []
  #notificationPull: (() => void) | null = null
  #hasNotificationReader = false
  #notifications: ReadableStream<HandleNotification>
  #protocol: ProtocolDefinition | null
  #reading = false
  #ready: PromiseLike<void>
  #serverCapabilities: InitializeResult['capabilities'] = {}
  #setupTimeout: number
  #toolOutputSchemas = new Map<string, Validator<unknown>>()

  constructor(params: ClientParams) {
    super({ validateMessageIn: validateServerMessage, transport: params.transport })

    // Derived from `serverMethods`, not a hardcoded version check: a handler is refused
    // exactly when its own method (`sampling/createMessage`/`elicitation/create`/`roots/list`)
    // is absent from the configured revision — the client-side mirror of what
    // `@mokei/context-server` does per capability on the server side.
    const protocol = params.protocolVersion === 'auto' ? null : PROTOCOLS[params.protocolVersion]
    if (protocol != null) {
      if (params.createMessage != null && !protocol.serverMethods.has('sampling/createMessage')) {
        throw new MRTRNotSupportedError('createMessage')
      }
      if (params.elicit != null && !protocol.serverMethods.has('elicitation/create')) {
        throw new MRTRNotSupportedError('elicit')
      }
      if (params.listRoots != null && !protocol.serverMethods.has('roots/list')) {
        throw new MRTRNotSupportedError('listRoots')
      }
    }

    const capabilities: ClientCapabilities = {}
    if (params.elicit != null) {
      capabilities.elicitation = {}
    }
    if (params.createMessage != null) {
      capabilities.sampling = {}
    }
    if (params.listRoots != null) {
      capabilities.roots = {}
    }

    this.#capabilities = capabilities
    this.#clientInfo = params.clientInfo ?? DEFAULT_CLIENT_INFO
    this.#createMessage = params.createMessage
    this.#elicit = params.elicit
    this.#initialized = lazy(() => this.#initialize())
    this.#listMaxPages = params.listMaxPages ?? DEFAULT_LIST_MAX_PAGES
    this.#listRoots = params.listRoots
    this.#logLevel = params.logLevel
    this.#protocol = protocol
    this.#ready = lazy(() => this.#setup())
    this.#setupTimeout =
      params.setupTimeout ?? params.initializeTimeout ?? DEFAULT_INITIALIZE_TIMEOUT
    this.#notifications = new ReadableStream<HandleNotification>(
      {
        pull: (controller) => {
          const next = this.#notificationBuffer.shift()
          if (next != null) {
            controller.enqueue(next)
            return
          }
          // No buffered item: park until the next notification arrives.
          return new Promise<void>((resolve) => {
            this.#notificationPull = () => {
              this.#notificationPull = null
              const queued = this.#notificationBuffer.shift()
              if (queued != null) {
                controller.enqueue(queued)
              }
              resolve()
            }
          })
        },
        cancel: () => {
          this.#hasNotificationReader = false
          this.#notificationBuffer = []
          this.#notificationPull = null
        },
      },
      new CountQueuingStrategy({ highWaterMark: 0 }),
    )
  }

  // Decorate every outgoing request with this revision's protocol envelope (`decorateRequest`)
  // and inject W3C trace context (SEP-414) into `_meta`; the latter is a no-op when no
  // OpenTelemetry SDK is active. Reject an `input_required` result until MRTR (SEP-2322) lands.
  request<Method extends keyof ClientTypes['SendRequests']>(
    method: Method,
    params: ClientTypes['SendRequests'][Method]['Params'],
    options?: RequestOptions,
  ): Promise<ClientTypes['SendRequests'][Method]['Result']> {
    const trace = currentTraceMeta()
    const base =
      params != null && typeof params === 'object' ? { ...(params as Record<string, unknown>) } : {}
    if (trace.traceparent != null) {
      base._meta = { ...(base._meta as Record<string, unknown> | undefined), ...trace }
    }
    const decorated = this.#requireProtocol().decorateRequest(base, {
      capabilities: this.#capabilities,
      clientInfo: this.#clientInfo,
      logLevel: this.#logLevel,
    })
    return super.request(method, decorated as typeof params, options).then((result) => {
      if ((result as { resultType?: string } | undefined)?.resultType === 'input_required') {
        throw new InputRequiredNotSupportedError()
      }
      return result
    })
  }

  async #initialize(): Promise<InitializeResult> {
    const id = this._getNextRequestID()
    // The revision this client is configured to speak — not `LATEST_PROTOCOL_VERSION`: this
    // client implements exactly one revision's wire behavior, so declaring anything else in
    // the handshake would misrepresent what it can actually speak.
    const protocol = this.#requireProtocol()
    // Send initialize request
    await super._write({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        ...DEFAULT_INITIALIZE_PARAMS,
        clientInfo: this.#clientInfo,
        capabilities: this.#capabilities,
        protocolVersion: protocol.version,
      },
    })
    // Wait for the matching response, bounded by the setup timeout. The
    // deadline promise is built once (not per iteration) so reading past stray
    // pre-init messages doesn't accumulate abort listeners on the signal.
    const timeoutMs = this.#setupTimeout
    const deadline = AbortSignal.timeout(timeoutMs)
    const timedOut = new Promise<never>((_resolve, reject) => {
      const fail = () =>
        reject(
          new RequestTimeoutError(
            `Server did not respond to initialize request within ${timeoutMs}ms`,
          ),
        )
      if (deadline.aborted) {
        fail()
      } else {
        deadline.addEventListener('abort', fail, { once: true })
      }
    })
    let result: InitializeResult | undefined
    while (result == null) {
      // The losing _read() stays pending and holds the reader lock; it resolves
      // (done) when the transport is later disposed. Its result is ignored.
      const next = await Promise.race([this._read(), timedOut])
      if (next.done) {
        throw new Error('Server closed the connection during initialize')
      }
      const message = next.value
      // Drop anything that isn't the initialize response: pre-init notifications
      // and server requests can't be handled before the session is established.
      if (message.id !== id) {
        continue
      }
      if ('error' in message) {
        throw RPCError.fromResponse(message as ErrorResponse)
      }
      result = message.result as InitializeResult
    }
    // Reject a negotiated version other than the one this client is configured to speak.
    if (result.protocolVersion !== protocol.version) {
      await this.dispose()
      throw new UnsupportedProtocolVersionError(result.protocolVersion, protocol.version)
    }
    // Store server capabilities for client-side gating.
    this.#serverCapabilities = result.capabilities
    // Start listening for incoming messages
    this.#startReadLoop()
    // Notify server that client is initialized
    await super._write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    this.events.emit('initialized', result)
    return result
  }

  async #setup(): Promise<void> {
    const protocol = this.#protocol ?? (await this.#probe())
    this.#protocol = protocol
    if (protocol.requiresHandshake) {
      await this.#initialized
      return
    }
    this.#startReadLoop()
  }

  /** @todo Task 11: probe the server for the protocol version it speaks. */
  async #probe(): Promise<ProtocolDefinition> {
    throw new Error("protocolVersion: 'auto' is not implemented yet")
  }

  /** The resolved protocol record. Throws while an `'auto'` probe is still pending. */
  #requireProtocol(): ProtocolDefinition {
    if (this.#protocol == null) {
      throw new Error("The 'auto' protocol version has not been resolved yet")
    }
    return this.#protocol
  }

  /** Starts `ContextRPC`'s read loop exactly once, across probe and handshake. */
  #startReadLoop(): void {
    if (this.#reading) {
      return
    }
    this.#reading = true
    this._handle()
  }

  _onTransportClosed(reason?: Error): void {
    this.events.emit('closed', { error: reason })
  }

  // Override _write to ensure the client is set up (handshake or read loop start) before
  // sending messages.
  async _write(message: ClientMessage): Promise<void> {
    await this.#ready
    await super._write(message)
  }

  _handleNotification(notification: HandleNotification): void {
    if (notification.method === 'notifications/message') {
      this.events.emit('log', notification.params)
    }
    // Clear tool output schemas cache on tools/list_changed notification
    if (notification.method === 'notifications/tools/list_changed') {
      this.#toolOutputSchemas.clear()
    }
    // Drop until a reader attaches, then keep only the most recent CAP.
    if (!this.#hasNotificationReader) {
      return
    }
    this.#notificationBuffer.push(notification)
    if (this.#notificationBuffer.length > NOTIFICATION_BUFFER_CAP) {
      this.#notificationBuffer.shift()
    }
    this.#notificationPull?.()
  }

  async _handleRequest(request: ServerRequest, signal: AbortSignal): Promise<ClientResult> {
    switch (request.method) {
      case 'elicitation/create': {
        if (this.#elicit != null) {
          return await this.#elicit({ params: request.params, signal })
        }
        break
      }
      case 'roots/list': {
        if (this.#listRoots == null) {
          throw new RPCError(METHOD_NOT_FOUND, 'roots capability not supported')
        }
        const roots = Array.isArray(this.#listRoots)
          ? this.#listRoots
          : await this.#listRoots({ signal })
        return { roots }
      }
      case 'sampling/createMessage':
        if (this.#createMessage != null) {
          return await this.#createMessage({ params: request.params, signal })
        }
    }
    throw new RPCError(METHOD_NOT_FOUND, 'Method not implemented')
  }

  // Guard: throws synchronously when the server did not declare the given capability.
  // Only meaningful after initialize() completes; #serverCapabilities is {} until then.
  #requireServerCapability(capability: 'tools' | 'logging' | 'completions'): void {
    if (this.#serverCapabilities[capability] == null) {
      throw new CapabilityNotDeclaredError(capability)
    }
  }

  // Guard: throws when the server did not declare the given capability, reading from whichever
  // source this revision actually populates. `2025-11-25` has a handshake, so `#serverCapabilities`
  // is authoritative; `2026-07-28` has none, so the only way to learn what the server supports is
  // `discover()`, which this awaits (and which caches per its own `ttlMs`).
  async #requireServerCapabilityAsync(
    capability: 'tools' | 'logging' | 'completions',
  ): Promise<void> {
    const protocol = this.#requireProtocol()
    const capabilities = protocol.requiresHandshake
      ? this.#serverCapabilities
      : (await this.discover()).capabilities
    if (capabilities[capability] == null) {
      throw new CapabilityNotDeclaredError(capability)
    }
  }

  get notifications(): ReadableStream<ServerNotification> {
    this.#hasNotificationReader = true
    return this.#notifications as ReadableStream<ServerNotification>
  }

  /** The resolved protocol revision. Throws while an `'auto'` probe is still pending. */
  get protocolVersion(): ProtocolVersion {
    return this.#requireProtocol().version
  }

  async initialize(): Promise<InitializeResult> {
    const protocol = this.#requireProtocol()
    if (!protocol.requiresHandshake) {
      throw new Error(
        `initialize() is not applicable to protocol version ${protocol.version}: it does not require a handshake`,
      )
    }
    return await this.#initialized
  }

  /**
   * Queries a server's supported protocol versions, capabilities and identity — the
   * `2026-07-28` replacement for the `initialize` handshake. Result is cached per the
   * server's own `ttlMs`; concurrent callers while a request is in flight collapse onto it.
   *
   * Awaits `#ready` like every other public method here (`setLoggingLevel`, `complete`,
   * `listTools`, `#listPaged`), so a first call under `protocolVersion: 'auto'` probes rather
   * than throwing "not resolved yet".
   */
  async discover(options?: RequestOptions): Promise<DiscoverResult> {
    await this.#ready
    const protocol = this.#requireProtocol()
    if (protocol.requiresHandshake) {
      throw new Error(
        `server/discover does not exist in protocol version ${protocol.version}; use initialize()`,
      )
    }
    if (this.#discovered != null && Date.now() < this.#discovered.expiresAt) {
      return this.#discovered.result
    }
    // Collapse concurrent callers onto one in-flight request.
    this.#discovering ??= this.request('server/discover', {}, options)
      .then((result) => {
        const ttlMs = typeof result.ttlMs === 'number' && result.ttlMs > 0 ? result.ttlMs : 0
        this.#discovered = { result, expiresAt: Date.now() + ttlMs }
        return result
      })
      .finally(() => {
        this.#discovering = null
      })
    return await this.#discovering
  }

  async setLoggingLevel(params: WithRequestOptions<SetLevelRequest['params']>): Promise<Result> {
    await this.#ready
    const protocol = this.#requireProtocol()
    // Derived from `clientMethods`, not a version literal: refuses exactly when this
    // revision's method table has no `logging/setLevel` to send. Deliberately does not route
    // through `discover()`'s capabilities — `2026-07-28` still advertises `logging: {}` even
    // though the method itself is gone, so gating on capabilities would let this through and
    // earn a METHOD_NOT_FOUND from the server instead of this clearer, client-side refusal.
    if (!protocol.clientMethods.has('logging/setLevel')) {
      throw new LoggingLevelNotSupportedError(protocol.version)
    }
    this.#requireServerCapability('logging')
    const [wireParams, options] = splitRequestOptions(params)
    return await this.request('logging/setLevel', wireParams, options)
  }

  async complete(params: WithRequestOptions<CompleteRequest['params']>): Promise<CompleteResult> {
    await this.#ready
    await this.#requireServerCapabilityAsync('completions')
    const [wireParams, options] = splitRequestOptions(params)
    return await this.request('completion/complete', wireParams, options)
  }

  /**
   * Walks a paginated list method until the server stops returning a cursor.
   *
   * Takes the caller's merged params and separates the wire params from the pagination
   * and transport options, so the list methods never hand the latter to `request`.
   *
   * When `cursor` is set the caller is driving pagination: a single request is issued and
   * its page returned verbatim, `nextCursor` intact.
   */
  async #listPaged(
    method: string,
    key: string,
    send: (params: Record<string, unknown>, options: RequestOptions) => Promise<PagedResult>,
    listParams: ListParams<Record<string, unknown>>,
  ): Promise<PagedResult> {
    await this.#ready

    const [params, { maxPages: maxPagesParam, ...options }] = splitListOptions(listParams)

    if (params.cursor != null) {
      return await send(params, options)
    }

    const maxPages = maxPagesParam ?? this.#listMaxPages
    const items: Array<unknown> = []
    let cursor: string | undefined
    let pages = 0

    while (true) {
      const page = await send(cursor == null ? params : { ...params, cursor }, options)
      pages += 1

      const pageItems = page[key]
      if (Array.isArray(pageItems)) {
        items.push(...pageItems)
      }

      if (page.nextCursor == null) {
        const { nextCursor: _nextCursor, ...rest } = page
        return { ...rest, [key]: items }
      }
      if (pages >= maxPages) {
        throw new ListMaxPagesError(method, pages, page.nextCursor, items)
      }
      cursor = page.nextCursor
    }
  }

  async listPrompts(
    params: ListParams<ListPromptsRequest['params']> = {},
  ): Promise<ListPromptsResult> {
    const result = await this.#listPaged(
      'prompts/list',
      'prompts',
      (pageParams, options) =>
        this.request(
          'prompts/list',
          pageParams as ListPromptsRequest['params'],
          options,
        ) as Promise<PagedResult>,
      params,
    )
    return result as ListPromptsResult
  }

  getPrompt(params: WithRequestOptions<PromptParams<T>>): Promise<GetPromptResult> {
    const [wireParams, options] = splitRequestOptions(params)
    return this.request('prompts/get', wireParams as GetPromptRequest['params'], options)
  }

  async listResources(
    params: ListParams<ListResourcesRequest['params']> = {},
  ): Promise<ListResourcesResult> {
    const result = await this.#listPaged(
      'resources/list',
      'resources',
      (pageParams, options) =>
        this.request(
          'resources/list',
          pageParams as ListResourcesRequest['params'],
          options,
        ) as Promise<PagedResult>,
      params,
    )
    return result as ListResourcesResult
  }

  async listResourceTemplates(
    params: ListParams<ListResourceTemplatesRequest['params']> = {},
  ): Promise<ListResourceTemplatesResult> {
    const result = await this.#listPaged(
      'resources/templates/list',
      'resourceTemplates',
      (pageParams, options) =>
        this.request(
          'resources/templates/list',
          pageParams as ListResourceTemplatesRequest['params'],
          options,
        ) as Promise<PagedResult>,
      params,
    )
    return result as ListResourceTemplatesResult
  }

  readResource(
    params: WithRequestOptions<ReadResourceRequest['params']>,
  ): Promise<ReadResourceResult> {
    const [wireParams, options] = splitRequestOptions(params)
    return this.request('resources/read', wireParams, options)
  }

  async listTools(params: ListParams<ListToolsRequest['params']> = {}): Promise<ListToolsResult> {
    await this.#ready
    await this.#requireServerCapabilityAsync('tools')
    const result = (await this.#listPaged(
      'tools/list',
      'tools',
      (pageParams, options) =>
        this.request(
          'tools/list',
          pageParams as ListToolsRequest['params'],
          options,
        ) as Promise<PagedResult>,
      params,
    )) as ListToolsResult
    this._cacheToolOutputSchemas(result.tools)
    return result
  }

  /** @internal Memoises validators for tools that advertise an outputSchema. */
  _cacheToolOutputSchemas(tools: ListToolsResult['tools']): void {
    for (const tool of tools) {
      if (tool.outputSchema == null) {
        this.#toolOutputSchemas.delete(tool.name)
        continue
      }
      const schema = tool.outputSchema as Schema
      this.#toolOutputSchemas.set(
        tool.name,
        createValidator(schema, { draft: inferSchemaDraft(schema), strict: false }),
      )
    }
  }

  async callTool(params: WithRequestOptions<ToolParams<T>>): Promise<CallToolResult> {
    const [wireParams, options] = splitRequestOptions(params)
    const result = await this.request(
      'tools/call',
      wireParams as CallToolRequest['params'],
      options,
    )
    const validate = this.#toolOutputSchemas.get(params.name)
    if (validate == null || result.structuredContent == null) {
      return result
    }
    const outcome = validate(result.structuredContent)
    if (outcome.issues != null) {
      throw new StructuredContentValidationError(
        params.name,
        outcome.issues.map((issue) => ({
          message: issue.message,
          path: issue.path?.map((segment) =>
            typeof segment === 'object' && segment != null ? segment.key : segment,
          ),
        })),
      )
    }
    return result
  }
}
