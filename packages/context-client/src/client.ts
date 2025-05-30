import { lazy } from '@enkaku/async'
import { createValidator } from '@enkaku/schema'
import { createReadable } from '@enkaku/stream'
import {
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  singleServerMessage,
} from '@mokei/context-protocol'
import type {
  CallToolRequest,
  CallToolResult,
  ClientMessage,
  ClientNotifications,
  ClientRequests,
  ClientResult,
  CompleteRequest,
  CompleteResult,
  CreateMessageRequest,
  CreateMessageResult,
  GetPromptRequest,
  GetPromptResult,
  InitializeResult,
  Log,
  LoggingLevel,
  ProgressNotification,
  Prompt,
  ReadResourceRequest,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  Root,
  ServerMessage,
  ServerNotification,
  ServerRequest,
  SingleServerMessage,
  Tool,
} from '@mokei/context-protocol'
import { ContextRPC, RPCError, type SentRequest } from '@mokei/context-rpc'

import type { ClientTransport } from './types.js'

const validateServerMessage = createValidator(singleServerMessage)

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
  HandleMessage: SingleServerMessage
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

export type ClientParams = {
  createMessage?: CreateMessageHandler
  listRoots?: Array<Root> | ListRootsHandler
  transport: ClientTransport
}

export class ContextClient<
  T extends ContextTypes = UnknownContextTypes,
> extends ContextRPC<ClientTypes> {
  #createMessage?: CreateMessageHandler
  #initialized: PromiseLike<InitializeResult>
  #listRoots?: Array<Root> | ListRootsHandler
  #notificationController: ReadableStreamDefaultController<HandleNotification>
  #notifications: ReadableStream<HandleNotification>

  constructor(params: ClientParams) {
    super({ validateMessageIn: validateServerMessage, transport: params.transport })
    const [stream, controller] = createReadable<HandleNotification>()
    this.#createMessage = params.createMessage
    this.#initialized = lazy(() => this.#initialize())
    this.#listRoots = params.listRoots
    this.#notificationController = controller
    this.#notifications = stream
  }

  async #initialize(): Promise<InitializeResult> {
    const id = this._getNextRequestID()
    // Send initialize request
    await super._write({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: {
          name: 'Mokei',
          version: '0.1.0',
        },
        protocolVersion: LATEST_PROTOCOL_VERSION,
      },
    })
    // Wait for initialize response
    const next = await this._read()
    if (next.done) {
      throw new Error('Server did not respond to initialize request')
    }
    if (Array.isArray(next.value) || next.value.id !== id) {
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

  setLoggingLevel(level: LoggingLevel): SentRequest<void> {
    return this.requestValue('logging/setLevel', { level }, () => {})
  }

  complete(params: CompleteRequest['params']): SentRequest<CompleteResult['completion']> {
    return this.requestValue('completion/complete', params, (result) => result.completion)
  }

  listPrompts(): SentRequest<Array<Prompt>> {
    return this.requestValue('prompts/list', {}, (result) => result.prompts)
  }

  getPrompt<Name extends keyof T['Prompts'] & string>(
    name: Name,
    args: T['Prompts'][Name] extends undefined ? never : T['Prompts'][Name],
  ): SentRequest<GetPromptResult> {
    return this.request('prompts/get', { name, arguments: args } as GetPromptRequest['params'])
  }

  listResources(): SentRequest<Array<Resource>> {
    return this.requestValue('resources/list', {}, (result) => result.resources)
  }

  listResourceTemplates(): SentRequest<Array<ResourceTemplate>> {
    return this.requestValue('resources/templates/list', {}, (result) => result.resourceTemplates)
  }

  readResource(params: ReadResourceRequest['params']): SentRequest<ReadResourceResult> {
    return this.request('resources/read', params)
  }

  listTools(): SentRequest<Array<Tool>> {
    return this.requestValue('tools/list', {}, (result) => result.tools)
  }

  callTool<Name extends keyof T['Tools'] & string>(
    name: Name,
    args: T['Tools'][Name],
  ): SentRequest<CallToolResult> {
    return this.request('tools/call', { name, arguments: args } as CallToolRequest['params'])
  }
}
