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
    super({ transport: params.transport, validateMessageIn: validateClientMessage })

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

  log(params: LogParams) {
    this.events.emit('log', params)
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

  _handle() {
    this.events.on('log', (log) => {
      // Only send log if client has opted-in and it's at least as verbose as the client has requested
      if (
        this.#clientLoggingLevel != null &&
        LOGGING_LEVELS[log.level] <= LOGGING_LEVELS[this.#clientLoggingLevel]
      ) {
        this._write({ jsonrpc: '2.0', method: 'notifications/message', params: log })
      }
    })
    super._handle()
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
        throw new RPCError(INVALID_PARAMS, `Missing "${META_PROTOCOL_VERSION}" in request _meta`)
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
      throw new RPCError(INVALID_PARAMS, `Missing "${META_CLIENT_CAPABILITIES}" in request _meta`)
    }
    return protocol
  }

  /**
   * Builds the `ServerClient` a request's handlers see.
   *
   * `2025-11-25` gets the constructor-built, session-scoped `#client` back unchanged: its
   * `createMessage`/`elicit`/`listRoots` really send server-initiated requests, and its `log`
   * goes through the `events.on('log')` bridge gated by `#clientLoggingLevel`
   * (`logging/setLevel`).
   *
   * A revision that sets `requiresMRTR` or `requiresPerRequestLogLevel` gets a fresh client
   * instead, built per request so it can close over that request's resolved `logLevel`. The two
   * traits are independent: `requiresMRTR` alone swaps out `createMessage`/`elicit`/`listRoots`
   * for rejections (there is nothing to send them as — no server-initiated request survives in
   * such a revision); `requiresPerRequestLogLevel` alone changes what `log` does, scoping
   * emission to the level this request opted into instead of a standing session level.
   */
  #createClient(protocol: ProtocolDefinition, logLevel?: LoggingLevel): ServerClient {
    if (!protocol.requiresMRTR && !protocol.requiresPerRequestLogLevel) {
      return this.#client
    }
    return {
      createMessage: protocol.requiresMRTR
        ? () => Promise.reject(new MRTRNotSupportedError('createMessage'))
        : this.createMessage.bind(this),
      elicit: protocol.requiresMRTR
        ? () => Promise.reject(new MRTRNotSupportedError('elicit'))
        : this.elicit.bind(this),
      listRoots: protocol.requiresMRTR
        ? () => Promise.reject(new MRTRNotSupportedError('listRoots'))
        : this.listRoots.bind(this),
      log: protocol.requiresPerRequestLogLevel
        ? (params: LogParams) => {
            // Emit only when this request opted in via `_meta`, at or above its level.
            if (logLevel != null && LOGGING_LEVELS[params.level] <= LOGGING_LEVELS[logLevel]) {
              void this._write({ jsonrpc: '2.0', method: 'notifications/message', params })
            }
          }
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
          serverInfo: this.#serverInfo,
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
