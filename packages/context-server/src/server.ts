import type {
  CallToolRequest,
  CallToolResult,
  ClientMessage,
  ClientNotification,
  ClientRequest,
  CommonNotifications,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  GetPromptRequest,
  GetPromptResult,
  Implementation,
  InitializeResult,
  InputRequest,
  InputResponse,
  ListRootsRequest,
  ListRootsResult,
  Log,
  LoggingLevel,
  ProgressNotification,
  Prompt,
  ProtocolDefinition,
  ProtocolVersion,
  ServerCapabilities,
  ServerMessage,
  ServerNotification,
  ServerNotifications,
  ServerRequests,
  ServerResult,
  SubscriptionsListenRequest,
  Tool,
} from '@mokei/context-protocol'
import {
  ENVELOPE_VIOLATION,
  INPUT_REQUEST_CAPABILITIES,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  isHandshakeRequired,
  isPerRequestLogLevel,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  META_SUBSCRIPTION_ID,
  METHOD_NOT_FOUND,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  PROTOCOL_VERSIONS,
  PROTOCOLS,
  UNSUPPORTED_PROTOCOL_VERSION,
} from '@mokei/context-protocol'
import {
  ContextRPC,
  type HeldResponse,
  isHeldResponse,
  RPCError,
  splitRequestOptions,
  type WithRequestOptions,
} from '@mokei/context-rpc'
import { defer } from '@sozai/async'
import { createValidator, type Schema } from '@sozai/schema'

import { applyCacheHints } from './cache.js'
import { ToolOutputValidationError, toResourceHandlers } from './definitions.js'
import { buildDiscoverResult } from './discover.js'
import {
  defaultMintRequestState,
  type InputRequiredResult,
  isInputRequiredResult,
  liftRetryParams,
  MRTR_METHODS,
  missingInputCapabilities,
  type RequestStateHooks,
  resolveRequestState,
} from './mrtr.js'
import {
  createSubscriptionHub,
  type SubscriptionHandle,
  type SubscriptionHub,
  type SubscriptionSink,
  SubscriptionWriter,
} from './subscriptions.js'
import { withRequestMeta } from './trace.js'
import type {
  ClientInitialize,
  CompleteHandler,
  GenericPromptHandler,
  GenericToolHandler,
  LogParams,
  PromptDefinitions,
  ResourceDefinitions,
  ResourceHandlers,
  ServerClient,
  ServerTransport,
  ToolDefinitions,
} from './types.js'
import { MissingRequiredClientCapabilityError, MRTRNotSupportedError } from './types.js'

type MRTRContext = {
  inputResponses?: Record<string, InputResponse>
  requestState?: unknown
  mintRequestState: (payload: unknown) => string
}

// cf https://datatracker.ietf.org/doc/html/rfc5424#section-6.2.1
const LOGGING_LEVELS: Record<LoggingLevel, number> = {
  emergency: 0,
  alert: 1,
  critical: 2,
  error: 3,
  warning: 4,
  notice: 5,
  info: 6,
  debug: 7,
} as const

/**
 * Accepts any message shape known to any registered revision, not just the revisions this
 * instance is configured to serve: an unsupported-but-well-formed request (e.g. a `ping` on a
 * `2026-07-28`-only server) must fail with `METHOD_NOT_FOUND`/`UNSUPPORTED_PROTOCOL_VERSION`
 * from `#resolveProtocol` — a semantic decision — rather than `INVALID_REQUEST` from the wire
 * parser, which cannot tell "malformed" from "not what this server was configured to speak."
 */
const validateClientMessage = createValidator<Schema, ClientMessage>({
  anyOf: PROTOCOL_VERSIONS.map((version) => PROTOCOLS[version].clientMessage),
} as Schema)

export type CacheHints = {
  cacheScope?: 'public' | 'private'
  ttlMs?: number
}

export type ServerConfig = {
  name: string
  version: string
  /** Revisions this server serves. Listing both makes it serve both. */
  protocolVersions: Array<ProtocolVersion>
  cache?: CacheHints
  /** Integrity hooks for the MRTR `requestState` (SEP-2322). See {@link RequestStateHooks}. */
  requestState?: RequestStateHooks
  complete?: CompleteHandler
  prompts?: PromptDefinitions
  resources?: ResourceDefinitions
  tools?: ToolDefinitions
}

export type ServerParams = ServerConfig & {
  transport: ServerTransport
  /**
   * Owns resource subscriptions (SEP-1391 `subscriptions/listen`): creates and owns a
   * {@link SubscriptionHub} bound to this server's own `events`, disposing it on teardown.
   * Mutually exclusive with `subscriptionHub` — pass one or the other, never both.
   */
  subscriptions?: boolean
  /**
   * Borrows an externally-owned {@link SubscriptionHub} (the stateless-HTTP path, Task 13): the
   * server serves `subscriptions/listen` against it but neither re-subscribes its producers nor
   * disposes it. Affects capability advertising the same way `subscriptions: true` does.
   */
  subscriptionHub?: SubscriptionHub
  /**
   * Identifies this server's connection inside a shared hub, keeping subscriptions from two
   * connections that reuse the same JSON-RPC id distinct. Defaults to a process-unique value;
   * the HTTP per-POST server injects its own.
   */
  connectionID?: string
  /** Request handlers allowed to run at once (default 100). */
  maxConcurrentRequests?: number
  /** Requests allowed to wait for a slot before further requests are refused (default 1000). */
  maxQueuedRequests?: number
  /**
   * Called for an inbound frame that could neither be validated nor routed to anything —
   * an invalid notification, or a malformed frame naming an id nobody is waiting on — and
   * for request handlers that failed. Without it such frames vanish silently.
   */
  onError?: (error: Error) => void
}

export type ServerEvents = {
  initialize: ClientInitialize
  initialized: undefined
  log: Log
  /** Signals that a subscribed resource's content changed. Consumed by the subscription hub. */
  resourceUpdated: { uri: string }
  /** Signals that the resources list changed. Consumed by the subscription hub. */
  resourcesListChanged: undefined
  /** Signals that the prompts list changed. Consumed by the subscription hub. */
  promptsListChanged: undefined
  /** Signals that the tools list changed. Consumed by the subscription hub. */
  toolsListChanged: undefined
}

type HandleNotification = ProgressNotification | ClientNotification

type ServerTypes = {
  Events: ServerEvents
  MessageIn: ClientMessage
  MessageOut: ServerMessage
  HandleNotification: HandleNotification
  HandleRequest: ClientRequest
  SendNotifications: ServerNotifications & Pick<CommonNotifications, 'progress'>
  SendRequests: ServerRequests
  // Widened to admit a held response: a `subscriptions/listen` handler returns
  // `_holdResponse(...)` instead of a result body, and the RPC layer detects it via
  // `isHeldResponse`. Every other method still returns a `ServerResult`.
  SendResult: ServerResult | HeldResponse<ServerResult>
}

/**
 * Process-unique id distinguishing one server's subscriptions from another's inside a shared
 * hub. A plain (stdio) server owns its own hub, so any stable value would do; a counter keeps it
 * RN-safe (no `crypto`) and lets Task 13's HTTP per-POST server inject its own via `connectionID`.
 */
let nextConnectionID = 0

export class ContextServer extends ContextRPC<ServerTypes> {
  #cache?: CacheHints
  #capabilities: ServerCapabilities = {}
  #client: ServerClient
  #clientInitialize?: ClientInitialize
  #clientLoggingLevel?: LoggingLevel
  #completeHandler?: CompleteHandler
  #protocolVersions: Array<ProtocolVersion>
  #requestState?: RequestStateHooks
  #serverInfo: Implementation
  #promptHandlers: Record<string, GenericPromptHandler> = {}
  #promptsList: Array<Prompt> = []
  #resources?: ResourceHandlers
  #toolHandlers: Record<string, GenericToolHandler> = {}
  #toolsList: Array<Tool> = []
  #connectionID: string
  #subscriptionHub?: SubscriptionHub
  // True when this server created the hub (owner) and must dispose it; false when it borrows one.
  #ownsHub = false

  constructor(params: ServerParams) {
    super({
      transport: params.transport,
      validateMessageIn: validateClientMessage,
      maxConcurrentRequests: params.maxConcurrentRequests,
      maxQueuedRequests: params.maxQueuedRequests,
      onError: params.onError,
    })

    this.#client = {
      createMessage: this.createMessage.bind(this),
      elicit: this.elicit.bind(this),
      listRoots: this.listRoots.bind(this),
      log: this.log.bind(this),
    }
    this.#cache = params.cache
    this.#completeHandler = params.complete
    this.#protocolVersions = params.protocolVersions
    // Freeze a copy up front so the guard below and every later `resolveRequestState` see the exact
    // hooks configured at construction: a caller holding the original object cannot mutate a
    // `verify` in after passing the guard with `mint` alone.
    const requestState =
      params.requestState == null ? undefined : Object.freeze({ ...params.requestState })
    // `verify` without `mint` is a silently broken configuration, not a legitimate one: a handler
    // that mints with the default `JSON.stringify` (there being no custom `mint` to use instead)
    // produces a string the custom `verify` was never written to accept, so every MRTR flow on
    // this server fails on its second round with no clue pointing at the missing `mint`. `mint`
    // without `verify` is fine and stays unchecked — it is documented as the raw-passthrough mode
    // (`RequestStateHooks`), just without the default JSON encoding.
    if (requestState?.verify != null && requestState.mint == null) {
      throw new Error(
        'requestState.verify is configured without requestState.mint: pass a matching `mint` (or drop `verify`)',
      )
    }
    this.#requestState = requestState
    this.#serverInfo = { name: params.name, version: params.version }

    // Logging is always supported (the server can emit notifications/message).
    this.#capabilities.logging = {}
    // Completions only when a handler serves completion/complete.
    if (params.complete != null) {
      this.#capabilities.completions = {}
    }

    for (const [name, prompt] of Object.entries(params.prompts ?? {})) {
      const { handler, ...info } = prompt
      this.#promptHandlers[name] = handler
      this.#promptsList.push({ name, ...info })
    }
    this.#promptsList.sort((a, b) => a.name.localeCompare(b.name))
    if (this.#promptsList.length !== 0) {
      this.#capabilities.prompts = { listChanged: true }
    }

    if (params.resources != null) {
      this.#capabilities.resources = { listChanged: true }
      this.#resources = toResourceHandlers(params.resources)
    }

    // Owner (`subscriptions: true`) creates and owns a hub bound to its own `events`; a borrower
    // is handed one and neither re-subscribes producers to it nor disposes it. Passing both is a
    // configuration error — the owned hub would shadow the borrowed one silently.
    if (params.subscriptions === true && params.subscriptionHub != null) {
      throw new Error(
        'Pass either `subscriptions: true` (own a hub) or `subscriptionHub` (borrow one), not both',
      )
    }
    this.#connectionID = params.connectionID ?? `context-server-${nextConnectionID++}`
    if (params.subscriptions === true) {
      this.#subscriptionHub = createSubscriptionHub({ events: this.events })
      this.#ownsHub = true
    } else if (params.subscriptionHub != null) {
      this.#subscriptionHub = params.subscriptionHub
    }
    // `resources.subscribe` is honest only where both halves of a served subscription exist:
    // resources to update *and* a hub to fan their updates out. Advertise it nowhere else.
    if (this.#resources != null && this.#subscriptionHub != null) {
      // The `resources` capability object was created just above alongside `#resources`.
      ;(this.#capabilities.resources as { listChanged: boolean; subscribe?: boolean }).subscribe =
        true
    }

    for (const [name, tool] of Object.entries(params.tools ?? {})) {
      const { handler, ...info } = tool
      this.#toolHandlers[name] = handler
      this.#toolsList.push({ name, ...info })
    }
    this.#toolsList.sort((a, b) => a.name.localeCompare(b.name))
    if (this.#toolsList.length !== 0) {
      this.#capabilities.tools = { listChanged: true }
    }

    this._handle()
  }

  get clientInitialize(): ClientInitialize | undefined {
    return this.#clientInitialize
  }

  /**
   * Session-scoped log: delivered when the client opted in through `logging/setLevel`
   * (`2025-11-25`). Also the `log` a handler gets on any revision where `isPerRequestLogLevel`
   * is `false`.
   */
  log(params: LogParams) {
    this.#emitLog(params, this.#clientLoggingLevel)
  }

  /**
   * Raises the `log` event, and writes `notifications/message` when `level` admits it.
   *
   * Emission and transmission are one call rather than an `events.on('log')` bridge because the
   * two revisions decide delivery from different sources — a standing `logging/setLevel` on
   * `2025-11-25`, the request's own `_meta` on `2026-07-28`. With a bridge, the per-request
   * writer would have to emit the event to stay observable and would then get a *second*,
   * session-scoped write on a server serving both revisions. Here every `client.log()` produces
   * exactly one event and at most one frame, whichever revision the request came in on.
   */
  #emitLog(params: LogParams, level?: LoggingLevel): void {
    this.events.emit('log', params)
    if (level != null && LOGGING_LEVELS[params.level] <= LOGGING_LEVELS[level]) {
      void this._write({ jsonrpc: '2.0', method: 'notifications/message', params }).catch(() => {})
    }
  }

  elicit(params: WithRequestOptions<ElicitRequest['params']>): Promise<ElicitResult> {
    const [wireParams, options] = splitRequestOptions(params)
    return this.request('elicitation/create', wireParams, options)
  }

  listRoots(params: WithRequestOptions<ListRootsRequest['params']> = {}): Promise<ListRootsResult> {
    const [wireParams, options] = splitRequestOptions(params)
    return this.request('roots/list', wireParams, options)
  }

  createMessage(
    params: WithRequestOptions<CreateMessageRequest['params']>,
  ): Promise<CreateMessageResult> {
    const [wireParams, options] = splitRequestOptions(params)
    return this.request('sampling/createMessage', wireParams, options)
  }

  _handleNotification(notification: HandleNotification) {
    switch (notification.method) {
      case 'notifications/initialized':
        this.events.emit('initialized')
        break
    }
  }

  /**
   * Resolves the protocol revision that applies to an inbound request.
   *
   * An `initialize` request selects the handshake revision configured on this server;
   * anything else is resolved from the request's own `_meta`
   * (specification/2026-07-28/basic/versioning). When `_meta` carries no protocol version,
   * resolution falls back to the one configured revision that does not require it
   * (`2025-11-25`) — a revision that requires `_meta` can never be inferred silently.
   */
  #resolveProtocol(request: ClientRequest): ProtocolDefinition {
    if (request.method === 'initialize') {
      const handshake = this.#protocolVersions.find((version) =>
        isHandshakeRequired(PROTOCOLS[version]),
      )
      if (handshake == null) {
        throw new RPCError(
          UNSUPPORTED_PROTOCOL_VERSION,
          `This server supports ${this.#protocolVersions.join(', ')}`,
          { supported: this.#protocolVersions, requested: 'initialize' },
        )
      }
      return PROTOCOLS[handshake]
    }

    const meta = (request.params as Record<string, unknown> | undefined)?._meta as
      | Record<string, unknown>
      | undefined
    const requested = meta?.[META_PROTOCOL_VERSION] as string | undefined

    let protocol: ProtocolDefinition
    if (requested == null) {
      const fallback = this.#protocolVersions.find(
        (version) => !PROTOCOLS[version].requiresRequestMeta,
      )
      if (fallback == null) {
        throw new RPCError(INVALID_PARAMS, `Missing "${META_PROTOCOL_VERSION}" in request _meta`, {
          [ENVELOPE_VIOLATION]: true,
        })
      }
      protocol = PROTOCOLS[fallback]
    } else if (!this.#protocolVersions.includes(requested as ProtocolVersion)) {
      throw new RPCError(UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
        supported: this.#protocolVersions,
        requested,
      })
    } else {
      protocol = PROTOCOLS[requested as ProtocolVersion]
    }

    if (protocol.requiresRequestMeta && meta?.[META_CLIENT_CAPABILITIES] == null) {
      throw new RPCError(INVALID_PARAMS, `Missing "${META_CLIENT_CAPABILITIES}" in request _meta`, {
        [ENVELOPE_VIOLATION]: true,
      })
    }
    return protocol
  }

  /**
   * Builds the `ServerClient` a request's handlers see.
   *
   * `createMessage`/`elicit`/`listRoots` are gated individually on whether their own method
   * (`sampling/createMessage`/`elicitation/create`/`roots/list`) is in `protocol.serverMethods`
   * — the method the call would actually need to send. A revision missing one rejects it with
   * `MRTRNotSupportedError`: there is nothing on the wire to send it as, because that revision
   * replaces server-initiated requests with multi round-trip requests (MRTR, SEP-2322) — a
   * handler on it reaches the client by suspending (`inputRequired()`) and being re-invoked with
   * `inputResponses`, not by awaiting one of these three. `log` is gated on the independent
   * `isPerRequestLogLevel(protocol)`: when true it scopes emission to the level this request
   * opted into via `_meta`, instead of a standing session level.
   *
   * `2025-11-25` has all three methods in `serverMethods` and `isPerRequestLogLevel` `false`,
   * so this returns the constructor-built, session-scoped `#client` unchanged — its `log` is
   * `ContextServer.log`, gated by `#clientLoggingLevel` (`logging/setLevel`). Any other
   * combination builds a fresh client per request, so it can close over the request's resolved
   * `logLevel`.
   */
  #createClient(protocol: ProtocolDefinition, logLevel?: LoggingLevel): ServerClient {
    const supportsCreateMessage = protocol.serverMethods.has('sampling/createMessage')
    const supportsElicit = protocol.serverMethods.has('elicitation/create')
    const supportsListRoots = protocol.serverMethods.has('roots/list')
    if (
      supportsCreateMessage &&
      supportsElicit &&
      supportsListRoots &&
      !isPerRequestLogLevel(protocol)
    ) {
      return this.#client
    }
    return {
      createMessage: supportsCreateMessage
        ? this.createMessage.bind(this)
        : () => Promise.reject(new MRTRNotSupportedError('createMessage', protocol.version)),
      elicit: supportsElicit
        ? this.elicit.bind(this)
        : () => Promise.reject(new MRTRNotSupportedError('elicit', protocol.version)),
      listRoots: supportsListRoots
        ? this.listRoots.bind(this)
        : () => Promise.reject(new MRTRNotSupportedError('listRoots', protocol.version)),
      // Delivered only when this request opted in via `_meta`, at or above its level — but the
      // `log` event is raised either way, so `server.events.on('log')` sees handler logs on
      // every revision.
      log: isPerRequestLogLevel(protocol)
        ? (params: LogParams) => this.#emitLog(params, logLevel)
        : this.log.bind(this),
    }
  }

  async _handleRequest(
    request: ClientRequest,
    signal: AbortSignal,
  ): Promise<ServerResult | HeldResponse<ServerResult>> {
    const protocol = this.#resolveProtocol(request)
    if (!protocol.clientMethods.has(request.method)) {
      throw new RPCError(METHOD_NOT_FOUND, `Unsupported method: ${request.method}`)
    }
    if (request.method === 'ping') {
      return {}
    }
    const meta = (request.params as Record<string, unknown> | undefined)?._meta as
      | Record<string, unknown>
      | undefined
    // `2025-11-25` has no MRTR, so `inputResponses`/`requestState` are ordinary params there and
    // must not be lifted: a peer is entitled to a tool argument by either name on that revision.
    const { params: liftedParams, lifted } =
      protocol.inputRequestMethods.size > 0
        ? liftRetryParams(request.params)
        : { params: request.params, lifted: {} }
    // `verify` runs before the handler and its refusal must answer the request with -32602
    // rather than throw past this dispatch loop — but the throw sits outside the `catch` so it
    // is a fresh, unchained error: the hook's own error may carry internals (secrets, stack
    // frames) that must not ride along on `.cause` into a response a peer can read.
    let requestStateError: string | undefined
    let requestState: unknown
    try {
      requestState = resolveRequestState(lifted.requestState, this.#requestState)
    } catch (cause) {
      requestStateError = cause instanceof Error ? cause.message : String(cause)
    }
    if (requestStateError != null) {
      throw new RPCError(INVALID_PARAMS, `Invalid requestState: ${requestStateError}`)
    }
    const mrtr: MRTRContext = {
      inputResponses: lifted.inputResponses,
      requestState,
      mintRequestState: this.#requestState?.mint ?? defaultMintRequestState,
    }
    const liftedRequest = { ...request, params: liftedParams } as ClientRequest
    const client = this.#createClient(protocol, protocol.readRequestMeta(request).logLevel)
    const result = await withRequestMeta(meta, () =>
      this.#dispatchRequest(liftedRequest, protocol, client, signal, mrtr),
    )
    // A held `subscriptions/listen` response is already the wrapped terminal (or, more precisely,
    // its `terminal` promise resolves to one): the RPC layer writes it verbatim without wrapping,
    // so it must skip `wrapResult` here — passing it through `applyCacheHints`/`wrapResult` would
    // stamp a `resultType`/serverInfo the terminal must not carry.
    if (isHeldResponse(result)) {
      return result
    }
    if (isInputRequiredResult(result)) {
      if (protocol.inputRequestMethods.size === 0) {
        throw new RPCError(
          INTERNAL_ERROR,
          `A handler suspended on protocol version ${protocol.version}, which has no multi round-trip requests`,
        )
      }
      if (!MRTR_METHODS.has(request.method)) {
        throw new RPCError(INTERNAL_ERROR, `${request.method} cannot suspend on input`)
      }
      const missing = missingInputCapabilities(
        result.inputRequests,
        protocol.readRequestMeta(request).clientCapabilities,
      )
      if (missing != null) {
        const [key, embedded] = Object.entries(result.inputRequests ?? {}).find(
          ([, value]) => missing[INPUT_REQUEST_CAPABILITIES[value.method]] != null,
        ) as [string, InputRequest]
        throw new RPCError(
          MISSING_REQUIRED_CLIENT_CAPABILITY,
          new MissingRequiredClientCapabilityError(key, embedded.method, missing).message,
          { requiredCapabilities: missing },
        )
      }
      // Deliberately not through `applyCacheHints`: a suspension is not an answer, so there is
      // nothing to cache and a `ttlMs` on it would tell the client to reuse a half-finished call.
      return protocol.wrapResult(result as unknown as Record<string, unknown>, {
        serverInfo: this.#serverInfo,
      }) as ServerResult
    }
    const body = protocol.requiresCacheHints
      ? applyCacheHints(request.method, result as Record<string, unknown>, this.#cache)
      : (result as Record<string, unknown>)
    return protocol.wrapResult(body, { serverInfo: this.#serverInfo }) as ServerResult
  }

  async #dispatchRequest(
    request: ClientRequest,
    protocol: ProtocolDefinition,
    client: ServerClient,
    signal: AbortSignal,
    mrtr: MRTRContext,
  ): Promise<ServerResult | InputRequiredResult | HeldResponse<ServerResult>> {
    switch (request.method) {
      case 'completion/complete':
        if (this.#completeHandler == null) {
          break
        }
        return await this.#completeHandler({ client, params: request.params, signal, ...mrtr })
      case 'initialize':
        this.#clientInitialize = request.params
        this.events.emit('initialize', request.params)
        return {
          capabilities: this.#capabilities,
          protocolVersion: protocol.version,
          serverInfo: this.#serverInfo,
        } satisfies InitializeResult
      case 'logging/setLevel':
        this.#clientLoggingLevel = request.params.level
        return {}
      case 'prompts/get':
        return await this.#getPrompt(request, client, signal, mrtr)
      case 'prompts/list':
        return { prompts: this.#promptsList, ...this.#cache }
      case 'resources/list':
        if (this.#resources == null) {
          break
        }
        return this.#resources.list({ client, params: request.params, signal, ...mrtr })
      case 'resources/read':
        if (this.#resources == null) {
          break
        }
        return this.#resources.read({ client, params: request.params, signal, ...mrtr })
      case 'resources/templates/list':
        if (this.#resources == null) {
          break
        }
        return this.#resources.listTemplates({
          client,
          params: request.params,
          signal,
          ...mrtr,
        })
      case 'server/discover':
        return buildDiscoverResult({
          capabilities: this.#capabilities,
          protocolVersions: this.#protocolVersions,
        })
      case 'subscriptions/listen':
        if (this.#subscriptionHub == null) {
          break
        }
        return this.#listen(request as SubscriptionsListenRequest, protocol, signal)
      case 'tools/call':
        return await this.#callTool(request, client, signal, mrtr)
      case 'tools/list':
        return { tools: this.#toolsList, ...this.#cache }
    }
    throw new RPCError(METHOD_NOT_FOUND, `Unsupported method: ${request.method}`)
  }

  async #callTool(
    request: CallToolRequest,
    client: ServerClient,
    signal: AbortSignal,
    mrtr: MRTRContext,
  ): Promise<CallToolResult | InputRequiredResult> {
    const name = request.params.name
    const handler = Object.hasOwn(this.#toolHandlers, name) ? this.#toolHandlers[name] : undefined
    if (handler == null) {
      // "Errors in finding the tool" are MCP protocol errors, per the spec.
      throw new RPCError(INVALID_PARAMS, `Tool ${name} not found`)
    }
    const progressToken = request.params._meta?.progressToken
    const progress =
      progressToken == null
        ? undefined
        : (params: { progress: number; total?: number; message?: string }) => {
            void this.notify('progress', { ...params, progressToken }).catch(() => {})
          }
    try {
      return await handler({
        // The wire calls it `arguments` (MCP `tools/call`); handlers receive it as `input`,
        // the thing the tool's `inputSchema` describes.
        input: request.params.arguments ?? {},
        client,
        progress,
        signal,
        ...mrtr,
      })
    } catch (cause) {
      // Tool-execution and input-validation failures (SEP-1303) are reported
      // inside the result so the model can see and self-correct, not as
      // protocol errors. Re-throw genuine cancellation.
      if (signal.aborted) {
        throw cause
      }
      // An outputSchema violation is the server author's own contract breach,
      // not a tool failure, so it must cross the wire as a JSON-RPC error
      // rather than be hidden in an isError result.
      if (cause instanceof ToolOutputValidationError) {
        throw cause
      }
      const message = cause instanceof Error ? cause.message : String(cause)
      return { content: [{ type: 'text', text: message }], isError: true }
    }
  }

  async #getPrompt(
    request: GetPromptRequest,
    client: ServerClient,
    signal: AbortSignal,
    mrtr: MRTRContext,
  ): Promise<GetPromptResult | InputRequiredResult> {
    const name = request.params.name
    const handler = Object.hasOwn(this.#promptHandlers, name)
      ? this.#promptHandlers[name]
      : undefined
    if (handler == null) {
      throw new RPCError(INVALID_PARAMS, `Prompt ${name} not found`)
    }
    return await handler({ input: request.params.arguments, client, signal, ...mrtr })
  }

  /**
   * Serves one `subscriptions/listen` request (SEP-1391). Returns a held response: no result body
   * is written now — the stream stays open, the acknowledgement is the first frame on it, and the
   * terminal result is written only on graceful teardown.
   *
   * Ack-first: the `notifications/subscriptions/acknowledged` frame is *written* (awaited) before
   * the entry is registered with the hub, so a producer event can never target a stream the
   * client has not yet seen acknowledged.
   */
  async #listen(
    request: SubscriptionsListenRequest,
    protocol: ProtocolDefinition,
    signal: AbortSignal,
  ): Promise<HeldResponse<ServerResult>> {
    // Non-null: the dispatch case only reaches here with a hub configured.
    const hub = this.#subscriptionHub as SubscriptionHub
    const id = request.id
    const filter = request.params.notifications

    const terminal = defer<ServerResult>()
    // Suppress unhandled-rejection in the narrow window before `#holdRequest` attaches its own
    // handler (an `onFailure` firing between `register` and the `_holdResponse` return). It does
    // not replace that handler — both fire; `#holdRequest`'s is what actually cleans up.
    terminal.promise.catch(() => {})

    // Every frame the writer sends is stamped with the per-subscription id (under `params._meta`)
    // plus this revision's own notification decoration, so the client routes it back to this
    // listen exchange by `_meta[subscriptionId]`.
    const decorate = (notification: ServerNotification): ServerNotification => {
      const decorated = protocol.decorateNotification(notification.params ?? {}) as Record<
        string,
        unknown
      >
      return {
        ...notification,
        params: {
          ...decorated,
          _meta: {
            ...(decorated._meta as Record<string, unknown> | undefined),
            [META_SUBSCRIPTION_ID]: id,
          },
        },
      } as ServerNotification
    }

    const sink: SubscriptionSink = {
      writeNotification: (notification) => this._write(decorate(notification) as ServerMessage),
      // Fires only on writer failure (backpressure/write rejection), never on request-abort.
      // A borrower's wire is this one throwaway exchange, so dispose it (closing the transport
      // finishes the exchange); an owner shares its wire across subscriptions, so keep it open.
      close: () => {
        if (this.#subscriptionHub != null && !this.#ownsHub) {
          void this.dispose()
        }
      },
    }

    let handle: SubscriptionHandle | undefined
    // The abrupt teardown path, shared by backpressure/write failure (`writer.onFailure`) and
    // request abort/cancel (`signal`): unregister from the hub and reject the held terminal so the
    // request settles with no terminal result written. Idempotent via the hub handle + deferred.
    const teardown = (reason: Error): void => {
      handle?.close(reason)
      // Reject only once the held response exists: before registration a failure surfaces through
      // the `enqueue(ack)` rejection below, and rejecting an unheld terminal would strand it.
      if (handle != null) {
        terminal.reject(reason)
      }
    }

    const writer = new SubscriptionWriter({ sink, onFailure: teardown })

    // Ack-first: resolves only after the acknowledgement is written. A rejection here (the write
    // failed, or the request was aborted mid-write) throws out of `#listen`, so the listen request
    // answers with an error response and no entry is ever registered.
    // The acknowledged notification lives only in the `2026-07-28` revision union, not the
    // cross-revision aggregate `ServerNotification` the writer is typed against; the cast bridges
    // that. The wire schema for the revision this listen resolved to admits it.
    await writer.enqueue({
      jsonrpc: '2.0',
      method: 'notifications/subscriptions/acknowledged',
      params: { notifications: filter },
    } as unknown as ServerNotification)

    // Build the held response before registering, so `held.written` exists before the entry can be
    // completed (avoids a race with `#holdRequest`, which runs only after `#listen` returns).
    const held = this._holdResponse({
      terminal: terminal.promise,
      beforeTerminal: () => writer.flush(),
    })

    handle = hub.register({
      connectionID: this.#connectionID,
      subscriptionID: id,
      filter,
      deliver: (notification) => writer.enqueue(notification),
      // Graceful teardown: resolve the terminal (only `result._meta[subscriptionId]`, no
      // `resultType`), then await its write so `endAllGracefully()` never reports completion before
      // the result reaches the wire. Bounded by the RPC disposal deadline.
      complete: async () => {
        terminal.resolve({ _meta: { [META_SUBSCRIPTION_ID]: id } } as ServerResult)
        await held.written.promise
      },
    })

    // Request abort (a client `notifications/cancelled`, or `dispose`'s `abortAll`) routes to the
    // same abrupt teardown. On graceful dispose the terminal is already resolved by `complete()`,
    // so both calls here are no-ops.
    signal.addEventListener('abort', () => teardown(signal.reason as Error), { once: true })
    // The listener above cannot observe an abort that already fired during the `enqueue(ack)`
    // await -- `{ once: true }` only arms for *future* dispatches. Without this check the hub
    // entry just registered above would be left registered forever (until the owning server's
    // `endAllGracefully()`), silently delivering to a request the client already cancelled. Both
    // `teardown` (via `handle`) and `_holdResponse` (via `signal.aborted`) are idempotent/safe to
    // call in this state, so this synchronous check just closes the window rather than changing
    // any settlement semantics.
    if (signal.aborted) {
      teardown(signal.reason as Error)
    }

    return held
  }

  /**
   * On an explicit `dispose()`, before the transport closes: if this server owns its subscription
   * hub, resolve every held `subscriptions/listen` terminal (their writes are then awaited by the
   * RPC layer's held-response flush) and release the hub. A borrower does neither — the hub's
   * owner drives graceful teardown.
   */
  async _beforeTransportClose(_reason: Error): Promise<void> {
    if (this.#ownsHub && this.#subscriptionHub != null) {
      await this.#subscriptionHub.endAllGracefully()
      await this.#subscriptionHub.dispose()
    }
  }
}
