import { NodeStreamsTransport } from '@enkaku/node-streams-transport'
import { createValidator } from '@enkaku/schema'
import type {
  CallToolRequest,
  CallToolResult,
  ClientMessage,
  ClientNotification,
  ClientRequest,
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  GetPromptRequest,
  GetPromptResult,
  Implementation,
  InitializeResult,
  ListRootsResult,
  Log,
  LoggingLevel,
  ProgressNotification,
  Prompt,
  ServerCapabilities,
  ServerMessage,
  ServerNotifications,
  ServerRequests,
  ServerResult,
  Tool,
} from '@mokei/context-protocol'
import {
  clientMessage,
  INVALID_PARAMS,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
} from '@mokei/context-protocol'
import { ContextRPC, RPCError, type SentRequest } from '@mokei/context-rpc'

import { toResourceHandlers } from './definitions.js'
import type {
  ClientInitialize,
  CompleteHandler,
  GenericPromptHandler,
  GenericToolHandler,
  PromptDefinitions,
  ResourceDefinitions,
  ResourceHandlers,
  ServerTransport,
  ToolDefinitions,
} from './types.js'

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

const validateClientMessage = createValidator(clientMessage)

export type ServerConfig = {
  name: string
  version: string
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
  SendNotifications: ServerNotifications
  SendRequests: ServerRequests
  SendResult: ServerResult
}

export class ContextServer extends ContextRPC<ServerTypes> {
  #capabilities: ServerCapabilities = {}
  #clientInitialize?: ClientInitialize
  #clientLoggingLevel?: LoggingLevel
  #completeHandler?: CompleteHandler
  #serverInfo: Implementation
  #promptHandlers: Record<string, GenericPromptHandler> = {}
  #promptsList: Array<Prompt> = []
  #resources?: ResourceHandlers
  #toolHandlers: Record<string, GenericToolHandler> = {}
  #toolsList: Array<Tool> = []

  constructor(params: ServerParams) {
    super({ transport: params.transport, validateMessageIn: validateClientMessage })

    this.#completeHandler = params.complete
    this.#serverInfo = { name: params.name, version: params.version }

    for (const [name, prompt] of Object.entries(params.prompts ?? {})) {
      const { handler, ...info } = prompt
      this.#promptHandlers[name] = handler
      this.#promptsList.push({ name, ...info })
    }
    if (this.#promptsList.length !== 0) {
      this.#capabilities.prompts = {}
    }

    if (params.resources != null) {
      this.#capabilities.resources = {}
      this.#resources = toResourceHandlers(params.resources)
    }

    for (const [name, tool] of Object.entries(params.tools ?? {})) {
      const { handler, ...info } = tool
      this.#toolHandlers[name] = handler
      this.#toolsList.push({ name, ...info })
    }
    if (this.#toolsList.length !== 0) {
      this.#capabilities.tools = {}
    }

    this._handle()
  }

  get clientInitialize(): ClientInitialize | undefined {
    return this.#clientInitialize
  }

  log = (level: LoggingLevel, data: unknown, logger?: string) => {
    this.events.emit('log', { level, data, logger })
  }

  elicit(params: ElicitRequest['params']): SentRequest<ElicitResult> {
    return this.request('elicitation/create', params)
  }

  listRoots(): SentRequest<ListRootsResult> {
    return this.request('roots/list', {})
  }

  createMessage(params: CreateMessageRequest['params']): SentRequest<CreateMessageResult> {
    return this.request('sampling/createMessage', params)
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

  async _handleRequest(request: ClientRequest, signal: AbortSignal): Promise<ServerResult> {
    switch (request.method) {
      case 'completion/complete':
        if (this.#completeHandler == null) {
          break
        }
        return await this.#completeHandler({ log: this.log, params: request.params, signal })
      case 'initialize':
        this.#clientInitialize = request.params
        this.events.emit('initialize', request.params)
        return {
          capabilities: this.#capabilities,
          protocolVersion: LATEST_PROTOCOL_VERSION,
          serverInfo: this.#serverInfo,
        } satisfies InitializeResult
      case 'logging/setLevel':
        this.#clientLoggingLevel = request.params.level
        return {}
      case 'prompts/get':
        return await this.#getPrompt(request, signal)
      case 'prompts/list':
        return { prompts: this.#promptsList }
      case 'resources/list':
        if (this.#resources == null) {
          break
        }
        return this.#resources.list({ log: this.log, params: request.params, signal })
      case 'resources/read':
        if (this.#resources == null) {
          break
        }
        return this.#resources.read({ log: this.log, params: request.params, signal })
      case 'resources/templates/list':
        if (this.#resources == null) {
          break
        }
        return this.#resources.listTemplates({ log: this.log, params: request.params, signal })
      case 'tools/call':
        return await this.#callTool(request, signal)
      case 'tools/list':
        return { tools: this.#toolsList }
    }
    throw new RPCError(METHOD_NOT_FOUND, `Unsupported method: ${request.method}`)
  }

  async #callTool(request: CallToolRequest, signal: AbortSignal): Promise<CallToolResult> {
    const handler = this.#toolHandlers[request.params.name]
    if (handler == null) {
      throw new RPCError(INVALID_PARAMS, `Tool ${request.params.name} not found`)
    }
    return await handler({ input: request.params.arguments ?? {}, log: this.log, signal })
  }

  async #getPrompt(request: GetPromptRequest, signal: AbortSignal): Promise<GetPromptResult> {
    const handler = this.#promptHandlers[request.params.name]
    if (handler == null) {
      throw new RPCError(INVALID_PARAMS, `Prompt ${request.params.name} not found`)
    }
    return await handler({ arguments: request.params.arguments, log: this.log, signal })
  }
}

export function serveProcess(config: ServerConfig): ContextServer {
  const transport = new NodeStreamsTransport<ClientMessage, ServerMessage>({
    streams: { readable: process.stdin, writable: process.stdout },
  })
  return new ContextServer({ ...config, transport })
}
