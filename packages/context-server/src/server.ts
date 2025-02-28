import { Disposer } from '@enkaku/async'
import { EventEmitter } from '@enkaku/event'
import { NodeStreamsTransport } from '@enkaku/node-streams-transport'
import { createValidator } from '@enkaku/schema'
import type { TransportType } from '@enkaku/transport'
import {
  INVALID_PARAMS,
  INVALID_REQUEST,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  clientMessage,
} from '@mokei/context-protocol'
import type {
  CallToolRequest,
  CallToolResult,
  ClientMessage,
  ClientNotification,
  ClientRequest,
  GetPromptRequest,
  GetPromptResult,
  Implementation,
  InitializeResult,
  Log,
  LoggingLevel,
  Prompt,
  RequestID,
  ServerCapabilities,
  ServerMessage,
  ServerResult,
  Tool,
} from '@mokei/context-protocol'

import { toResourceHandlers } from './definitions.js'
import { RPCError, errorResponse } from './error.js'
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

function isRequestID(id: unknown): id is RequestID {
  return typeof id === 'string' || typeof id === 'number'
}

export type ServerParams = {
  name: string
  version: string
  transport?: ServerTransport
  complete?: CompleteHandler
  prompts?: PromptDefinitions
  resources?: ResourceDefinitions
  tools?: ToolDefinitions
}

export type ServerEvents = {
  initialize: ClientInitialize
  initialized: undefined
  log: Log
}

export class ContextServer extends Disposer {
  #capabilities: ServerCapabilities = {}
  #clientInitialize?: ClientInitialize
  #clientLoggingLevel?: LoggingLevel
  #completeHandler?: CompleteHandler
  #events: EventEmitter<ServerEvents>
  #serverInfo: Implementation
  #promptHandlers: Record<string, GenericPromptHandler> = {}
  #promptsList: Array<Prompt> = []
  #resources?: ResourceHandlers
  #toolHandlers: Record<string, GenericToolHandler> = {}
  #toolsList: Array<Tool> = []
  #transports: Array<TransportType<ClientMessage, ServerMessage>> = []

  constructor(params: ServerParams) {
    super({
      dispose: async () => {
        await Promise.all(this.#transports.map((transport) => transport.dispose()))
      },
    })

    this.#completeHandler = params.complete
    this.#events = new EventEmitter<ServerEvents>()
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

    const transport =
      params.transport ??
      new NodeStreamsTransport<ClientMessage, ServerMessage>({
        streams: { readable: process.stdin, writable: process.stdout },
      })
    this.handle(transport)
  }

  get clientInitialize(): ClientInitialize | undefined {
    return this.#clientInitialize
  }

  get events(): EventEmitter<ServerEvents> {
    return this.#events
  }

  log = (level: LoggingLevel, data: unknown, logger?: string) => {
    this.#events.emit('log', { level, data, logger })
  }

  handle(transport: ServerTransport) {
    this.#transports.push(transport)
    const inflight: Record<string, AbortController> = {}

    this.#events.on('log', (log) => {
      // Only send log if client has opted-in and it's at least as verbose as the client has requested
      if (
        this.#clientLoggingLevel != null &&
        LOGGING_LEVELS[log.level] <= LOGGING_LEVELS[this.#clientLoggingLevel]
      ) {
        transport.write({ jsonrpc: '2.0', method: 'notifications/message', params: log })
      }
    })

    const handleNext = async () => {
      const next = await transport.read()
      if (next.done) {
        return
      }

      const id = next.value.id
      const validated = validateClientMessage(next.value)
      if (validated.issues == null) {
        this.#handleMessage(validated.value, inflight)
          .then(
            (result) => {
              if (result != null && isRequestID(id)) {
                transport.write({ jsonrpc: '2.0', id, result })
              }
            },
            (cause) => {
              if (isRequestID(id)) {
                transport.write(errorResponse(id, cause))
              } else {
                // TODO: call optional error handler
              }
            },
          )
          .finally(() => {
            if (isRequestID(id)) {
              delete inflight[id]
            }
          })
      } else {
        if (next.value.method != null && isRequestID(id)) {
          // Send an error response if incoming message is a request
          transport.write({
            jsonrpc: '2.0',
            id,
            error: { code: INVALID_REQUEST, message: 'Invalid request' },
          })
        } else {
          // TODO: call optional error handler
        }
      }

      handleNext()
    }

    handleNext()
  }

  async #handleMessage(
    message: ClientMessage,
    inflight: Record<string, AbortController>,
  ): Promise<ServerResult | null> {
    if (message.id == null) {
      const notification = message as ClientNotification
      switch (notification.method) {
        case 'notifications/cancelled': {
          const controller = inflight[notification.params.requestId]
          if (controller != null) {
            controller.abort()
            delete inflight[notification.params.requestId]
          }
          break
        }
        case 'notifications/initialized':
          this.#events.emit('initialized')
          break
      }
      return null
    }

    if (message.method == null) {
      // TODO: handle response or error
      return null
    }

    const request = message as ClientRequest
    const controller = new AbortController()
    inflight[request.id] = controller
    return await this.#handleRequest(request, controller.signal)
  }

  async #handleRequest(request: ClientRequest, signal: AbortSignal): Promise<ServerResult> {
    switch (request.method) {
      case 'completion/complete':
        if (this.#completeHandler == null) {
          break
        }
        return await this.#completeHandler({ log: this.log, params: request.params, signal })
      case 'initialize':
        this.#clientInitialize = request.params
        this.#events.emit('initialize', request.params)
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

export function serve(params: ServerParams): ContextServer {
  return new ContextServer(params)
}
