import { NodeStreamsTransport } from '@enkaku/node-streams'
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
  ServerNotifications,
  ServerRequests,
  ServerResult,
  Tool,
} from '@mokei/context-protocol'
import {
  ENVELOPE_VIOLATION,
  INVALID_PARAMS,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  PROTOCOL_VERSIONS,
  PROTOCOLS,
  UNSUPPORTED_PROTOCOL_VERSION,
} from '@mokei/context-protocol'
import {
  ContextRPC,
  RPCError,
  splitRequestOptions,
  type WithRequestOptions,
} from '@mokei/context-rpc'
import { createValidator, type Schema } from '@sozai/schema'

import { applyCacheHints } from './cache.js'
import { ToolOutputValidationError, toResourceHandlers } from './definitions.js'
import { buildDiscoverResult } from './discover.js'
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
import { MRTRNotSupportedError } from './types.js'

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
  complete?: CompleteHandler
  prompts?: PromptDefinitions
  resources?: ResourceDefinitions
  tools?: ToolDefinitions
}

export type ServerParams = ServerConfig & {
  transport: ServerTransport
  /** Request handlers allowed to run at once (default 100). */
  maxConcurrentRequests?: number
  /** Requests allowed to wait for a slot before further requests are refused (default 1000). */
  maxQueuedRequests?: number
  /**
   * Called for an inbound frame that could neither be validated nor routed to anything —
   * an invalid notification, or a response for an id nobody is waiting on — and for request
   * handlers that failed. Without it such frames vanish silently.
   */
  onError?: (error: Error) => void
}

export type ServerEvents = {
  initialize: ClientInitialize
  initialized: undefined
  log: Log
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
  SendResult: ServerResult
}

export class ContextServer extends ContextRPC<ServerTypes> {
  #cache?: CacheHints
  #capabilities: ServerCapabilities = {}
  #client: ServerClient
  #clientInitialize?: ClientInitialize
  #clientLoggingLevel?: LoggingLevel
  #completeHandler?: CompleteHandler
  #protocolVersions: Array<ProtocolVersion>
  #serverInfo: Implementation
  #promptHandlers: Record<string, GenericPromptHandler> = {}
  #promptsList: Array<Prompt> = []
  #resources?: ResourceHandlers
  #toolHandlers: Record<string, GenericToolHandler> = {}
  #toolsList: Array<Tool> = []

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
   * (`2025-11-25`). Also the `log` a handler gets on any revision without
   * `requiresPerRequestLogLevel`.
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
      const handshake = this.#protocolVersions.find(
        (version) => PROTOCOLS[version].requiresHandshake,
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
   * `MRTRNotSupportedError`: there is nothing on the wire to send it as, since server-initiated
   * requests are replaced by multi round-trip requests (MRTR, SEP-2322) in that revision, which
   * mokei does not implement yet. `log` is gated on the independent
   * `requiresPerRequestLogLevel`: when true it scopes emission to the level this request opted
   * into via `_meta`, instead of a standing session level.
   *
   * `2025-11-25` has all three methods in `serverMethods` and `requiresPerRequestLogLevel:
   * false`, so this returns the constructor-built, session-scoped `#client` unchanged — its
   * `log` is `ContextServer.log`, gated by `#clientLoggingLevel` (`logging/setLevel`). Any other
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
      !protocol.requiresPerRequestLogLevel
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
      log: protocol.requiresPerRequestLogLevel
        ? (params: LogParams) => this.#emitLog(params, logLevel)
        : this.log.bind(this),
    }
  }

  async _handleRequest(request: ClientRequest, signal: AbortSignal): Promise<ServerResult> {
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
    const client = this.#createClient(protocol, protocol.readRequestMeta(request).logLevel)
    const result = await withRequestMeta(meta, () =>
      this.#dispatchRequest(request, protocol, client, signal),
    )
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
  ): Promise<ServerResult> {
    switch (request.method) {
      case 'completion/complete':
        if (this.#completeHandler == null) {
          break
        }
        return await this.#completeHandler({ client, params: request.params, signal })
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
        return await this.#getPrompt(request, client, signal)
      case 'prompts/list':
        return { prompts: this.#promptsList, ...this.#cache }
      case 'resources/list':
        if (this.#resources == null) {
          break
        }
        return this.#resources.list({ client, params: request.params, signal })
      case 'resources/read':
        if (this.#resources == null) {
          break
        }
        return this.#resources.read({ client, params: request.params, signal })
      case 'resources/templates/list':
        if (this.#resources == null) {
          break
        }
        return this.#resources.listTemplates({
          client,
          params: request.params,
          signal,
        })
      case 'server/discover':
        return buildDiscoverResult({
          capabilities: this.#capabilities,
          protocolVersions: this.#protocolVersions,
        })
      case 'tools/call':
        return await this.#callTool(request, client, signal)
      case 'tools/list':
        return { tools: this.#toolsList, ...this.#cache }
    }
    throw new RPCError(METHOD_NOT_FOUND, `Unsupported method: ${request.method}`)
  }

  async #callTool(
    request: CallToolRequest,
    client: ServerClient,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
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
  ): Promise<GetPromptResult> {
    const name = request.params.name
    const handler = Object.hasOwn(this.#promptHandlers, name)
      ? this.#promptHandlers[name]
      : undefined
    if (handler == null) {
      throw new RPCError(INVALID_PARAMS, `Prompt ${name} not found`)
    }
    return await handler({ input: request.params.arguments, client, signal })
  }
}

export function serveProcess(config: ServerConfig): ContextServer {
  const transport = new NodeStreamsTransport<ClientMessage, ServerMessage>({
    streams: { readable: process.stdin, writable: process.stdout },
  })
  return new ContextServer({ ...config, transport })
}
