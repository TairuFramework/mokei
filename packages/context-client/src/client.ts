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
  ElicitRequest,
  ElicitResult,
  GetPromptRequest,
  GetPromptResult,
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
  Metadata,
  ProgressNotification,
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
  isSupportedProtocolVersion,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  PROTOCOL_VERSIONS,
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

export const DEFAULT_INITIALIZE_PARAMS: InitializeRequest['params'] = {
  capabilities: {},
  clientInfo: {
    name: 'Mokei',
    version: '0.4.0',
  },
  protocolVersion: LATEST_PROTOCOL_VERSION,
}

export const DEFAULT_INITIALIZE_TIMEOUT = 30_000

/** Default cap on pages fetched by a single list walk. */
export const DEFAULT_LIST_MAX_PAGES = 100

/** Max notifications buffered once a reader is attached; oldest dropped past this. */
const NOTIFICATION_BUFFER_CAP = 256

export class UnsupportedProtocolVersionError extends Error {
  constructor(received: string) {
    super(
      `Server responded with unsupported protocolVersion "${received}"; supported: ${PROTOCOL_VERSIONS.join(', ')}`,
    )
    this.name = 'UnsupportedProtocolVersionError'
  }
}

export class CapabilityNotDeclaredError extends Error {
  constructor(capability: string) {
    super(`Server did not declare the "${capability}" capability`)
    this.name = 'CapabilityNotDeclaredError'
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
  createMessage?: CreateMessageHandler
  elicit?: ElicitHandler
  initializeTimeout?: number
  listMaxPages?: number
  listRoots?: Array<Root> | ListRootsHandler
  transport: ClientTransport
}

type PagedResult = { nextCursor?: string } & Record<string, unknown>

export class ContextClient<
  T extends ContextTypes = UnknownContextTypes,
> extends ContextRPC<ClientTypes> {
  #createMessage?: CreateMessageHandler
  #elicit?: ElicitHandler
  #initialized: PromiseLike<InitializeResult>
  #initializeTimeout: number
  #listMaxPages: number
  #listRoots?: Array<Root> | ListRootsHandler
  #notificationBuffer: Array<HandleNotification> = []
  #notificationPull: (() => void) | null = null
  #hasNotificationReader = false
  #notifications: ReadableStream<HandleNotification>
  #serverCapabilities: InitializeResult['capabilities'] = {}
  #toolOutputSchemas = new Map<string, Validator<unknown>>()

  constructor(params: ClientParams) {
    super({ validateMessageIn: validateServerMessage, transport: params.transport })
    this.#createMessage = params.createMessage
    this.#elicit = params.elicit
    this.#initialized = lazy(() => this.#initialize())
    this.#initializeTimeout = params.initializeTimeout ?? DEFAULT_INITIALIZE_TIMEOUT
    this.#listMaxPages = params.listMaxPages ?? DEFAULT_LIST_MAX_PAGES
    this.#listRoots = params.listRoots
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

  // Inject W3C trace context (SEP-414) into every outgoing request's `_meta`.
  // No-op when no OpenTelemetry SDK is active.
  request<Method extends keyof ClientTypes['SendRequests']>(
    method: Method,
    params: ClientTypes['SendRequests'][Method]['Params'],
    options?: RequestOptions,
  ): Promise<ClientTypes['SendRequests'][Method]['Result']> {
    const trace = currentTraceMeta()
    if (trace.traceparent == null) {
      return super.request(method, params, options)
    }
    const base =
      params != null && typeof params === 'object' ? (params as Record<string, unknown>) : {}
    const existingMeta =
      base._meta != null && typeof base._meta === 'object'
        ? (base._meta as Record<string, unknown>)
        : {}
    const merged = { ...base, _meta: { ...existingMeta, ...trace } }
    return super.request(method, merged as typeof params, options)
  }

  async #initialize(): Promise<InitializeResult> {
    const id = this._getNextRequestID()
    // Build capabilities
    const capabilities: ClientCapabilities = {}
    if (this.#elicit != null) {
      capabilities.elicitation = {}
    }
    if (this.#createMessage != null) {
      capabilities.sampling = {}
    }
    if (this.#listRoots != null) {
      capabilities.roots = {}
    }
    // Send initialize request
    await super._write({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: { ...DEFAULT_INITIALIZE_PARAMS, capabilities },
    })
    // Wait for the matching response, bounded by the initialize timeout. The
    // deadline promise is built once (not per iteration) so reading past stray
    // pre-init messages doesn't accumulate abort listeners on the signal.
    const timeoutMs = this.#initializeTimeout
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
    // Reject an unsupported negotiated version before establishing the session.
    if (!isSupportedProtocolVersion(result.protocolVersion)) {
      await this.dispose()
      throw new UnsupportedProtocolVersionError(result.protocolVersion)
    }
    // Store server capabilities for client-side gating (Task 13).
    this.#serverCapabilities = result.capabilities
    // Start listening for incoming messages
    this._handle()
    // Notify server that client is initialized
    await super._write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    this.events.emit('initialized', result)
    return result
  }

  _onTransportClosed(reason?: Error): void {
    this.events.emit('closed', { error: reason })
  }

  // Override _write method to ensure that client is initialized before sending messages
  async _write(message: ClientMessage): Promise<void> {
    await this.#initialized
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

  get notifications(): ReadableStream<ServerNotification> {
    this.#hasNotificationReader = true
    return this.#notifications as ReadableStream<ServerNotification>
  }

  async initialize(): Promise<InitializeResult> {
    return await this.#initialized
  }

  async setLoggingLevel(params: WithRequestOptions<SetLevelRequest['params']>): Promise<Result> {
    await this.#initialized
    this.#requireServerCapability('logging')
    const [wireParams, options] = splitRequestOptions(params)
    return await this.request('logging/setLevel', wireParams, options)
  }

  async complete(params: WithRequestOptions<CompleteRequest['params']>): Promise<CompleteResult> {
    await this.#initialized
    this.#requireServerCapability('completions')
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
    await this.#initialized

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
    await this.#initialized
    this.#requireServerCapability('tools')
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
