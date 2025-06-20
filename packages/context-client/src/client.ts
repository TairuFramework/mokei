import { lazy } from '@enkaku/async'
import { createValidator } from '@enkaku/schema'
import { createReadable } from '@enkaku/stream'
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
import { LATEST_PROTOCOL_VERSION, METHOD_NOT_FOUND, serverMessage } from '@mokei/context-protocol'
import { ContextRPC, RPCError, type SentRequest } from '@mokei/context-rpc'

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

export type ElicitHandler = (
  params: ElicitRequest['params'],
  signal: AbortSignal,
) => ElicitResult | Promise<ElicitResult>

export type CreateMessageHandler = (
  params: CreateMessageRequest['params'],
  signal: AbortSignal,
) => CreateMessageResult | Promise<CreateMessageResult>

export type ListRootsHandler = (signal: AbortSignal) => Array<Root> | Promise<Array<Root>>

export type ClientEvents = {
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

export type PromptParams<T extends ContextTypes> = {
  name: keyof T['Prompts'] & string
  arguments: T['Prompts'][keyof T['Prompts']] extends undefined
    ? never
    : T['Prompts'][keyof T['Prompts']]
  _meta?: Metadata
}

export type ToolParams<T extends ContextTypes> = {
  name: keyof T['Tools'] & string
  arguments: T['Tools'][keyof T['Tools']] extends undefined ? never : T['Tools'][keyof T['Tools']]
  _meta?: Metadata
}

export type ClientParams = {
  createMessage?: CreateMessageHandler
  elicit?: ElicitHandler
  listRoots?: Array<Root> | ListRootsHandler
  transport: ClientTransport
}

export class ContextClient<
  T extends ContextTypes = UnknownContextTypes,
> extends ContextRPC<ClientTypes> {
  #createMessage?: CreateMessageHandler
  #elicit?: ElicitHandler
  #initialized: PromiseLike<InitializeResult>
  #listRoots?: Array<Root> | ListRootsHandler
  #notificationController: ReadableStreamDefaultController<HandleNotification>
  #notifications: ReadableStream<HandleNotification>

  constructor(params: ClientParams) {
    super({ validateMessageIn: validateServerMessage, transport: params.transport })
    const [stream, controller] = createReadable<HandleNotification>()
    this.#createMessage = params.createMessage
    this.#elicit = params.elicit
    this.#initialized = lazy(() => this.#initialize())
    this.#listRoots = params.listRoots
    this.#notificationController = controller
    this.#notifications = stream
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
    // Wait for initialize response
    const next = await this._read()
    if (next.done) {
      throw new Error('Server did not respond to initialize request')
    }
    if (next.value.id !== id) {
      throw new Error('Server did not correctly respond to initialize request')
    }
    // Start listening for incoming messages
    this._handle()
    // Notify server that client is initialized
    await super._write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    // TODO: check result
    const result = next.value.result as InitializeResult
    // Return result
    this.events.emit('initialized', result)
    return result
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
    this.#notificationController.enqueue(notification)
  }

  async _handleRequest(request: ServerRequest, signal: AbortSignal): Promise<ClientResult> {
    switch (request.method) {
      case 'elicitation/create': {
        if (this.#elicit != null) {
          return await this.#elicit(request.params, signal)
        }
        break
      }
      case 'roots/list': {
        const roots =
          this.#listRoots == null
            ? []
            : Array.isArray(this.#listRoots)
              ? this.#listRoots
              : await this.#listRoots(signal)
        return { roots }
      }
      case 'sampling/createMessage':
        if (this.#createMessage != null) {
          return await this.#createMessage(request.params, signal)
        }
    }
    throw new RPCError(METHOD_NOT_FOUND, 'Method not implemented')
  }

  get notifications(): ReadableStream<ServerNotification> {
    return this.#notifications
  }

  async initialize(): Promise<InitializeResult> {
    return await this.#initialized
  }

  setLoggingLevel(params: SetLevelRequest['params']): SentRequest<Result> {
    return this.request('logging/setLevel', params)
  }

  complete(params: CompleteRequest['params']): SentRequest<CompleteResult> {
    return this.request('completion/complete', params)
  }

  listPrompts(params: ListPromptsRequest['params'] = {}): SentRequest<ListPromptsResult> {
    return this.request('prompts/list', params)
  }

  getPrompt(params: PromptParams<T>): SentRequest<GetPromptResult> {
    return this.request('prompts/get', params as GetPromptRequest['params'])
  }

  listResources(params: ListResourcesRequest['params'] = {}): SentRequest<ListResourcesResult> {
    return this.request('resources/list', params)
  }

  listResourceTemplates(
    params: ListResourceTemplatesRequest['params'] = {},
  ): SentRequest<ListResourceTemplatesResult> {
    return this.request('resources/templates/list', params)
  }

  readResource(params: ReadResourceRequest['params']): SentRequest<ReadResourceResult> {
    return this.request('resources/read', params)
  }

  listTools(params: ListToolsRequest['params'] = {}): SentRequest<ListToolsResult> {
    return this.request('tools/list', params)
  }

  callTool(params: ToolParams<T>): SentRequest<CallToolResult> {
    return this.request('tools/call', params as CallToolRequest['params'])
  }
}
