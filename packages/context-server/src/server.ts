import { NodeStreamsTransport } from '@enkaku/node-streams-transport'
import { createValidator } from '@enkaku/schema'
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
  Prompt,
  RequestID,
  ServerCapabilities,
  ServerMessage,
  ServerResult,
  Tool,
} from '@mokei/context-protocol'

import { RPCError, errorResponse } from './error.js'
import type {
  GenericPromptHandler,
  GenericToolHandler,
  PromptDefinitions,
  ResourceHandlers,
  ServerTransport,
  ToolDefinitions,
} from './types.js'

const validateClientMessage = createValidator(clientMessage)

export type NoSpecification = { prompts: undefined; tools: undefined }

export type ServerParams = {
  name: string
  version: string
  transport?: ServerTransport
  prompts?: PromptDefinitions
  resources?: ResourceHandlers
  tools?: ToolDefinitions
}

function isRequestID(id: unknown): id is RequestID {
  return typeof id === 'string' || typeof id === 'number'
}

export class ContextServer {
  #capabilities: ServerCapabilities = {}
  #serverInfo: Implementation
  #promptHandlers: Record<string, GenericPromptHandler> = {}
  #promptsList: Array<Prompt> = []
  #resources?: ResourceHandlers
  #toolHandlers: Record<string, GenericToolHandler> = {}
  #toolsList: Array<Tool> = []

  constructor(params: ServerParams) {
    this.#serverInfo = { name: params.name, version: params.version }
    this.#resources = params.resources

    for (const [name, prompt] of Object.entries(params.prompts ?? {})) {
      const { handler, ...info } = prompt
      this.#promptHandlers[name] = handler
      this.#promptsList.push({ name, ...info })
    }
    if (this.#promptsList.length !== 0) {
      this.#capabilities.prompts = {}
    }

    if (this.#resources != null) {
      this.#capabilities.resources = {}
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

  handle(transport: ServerTransport) {
    const inflight: Record<string, AbortController> = {}

    const handleNext = async () => {
      const next = await transport.read()
      if (next.done) {
        return
      }

      const id = next.value.id
      const validated = validateClientMessage(next.value)
      if (validated.issues == null) {
        this.handleMessage(validated.value, inflight)
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

  async handleMessage(
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
    return await this.handleRequest(request, controller.signal)
  }

  async handleRequest(request: ClientRequest, signal: AbortSignal): Promise<ServerResult> {
    switch (request.method) {
      case 'initialize':
        return {
          capabilities: this.#capabilities,
          protocolVersion: LATEST_PROTOCOL_VERSION,
          serverInfo: this.#serverInfo,
        } satisfies InitializeResult
      case 'prompts/get':
        return await this.getPrompt(request, signal)
      case 'prompts/list':
        return { prompts: this.#promptsList }
      case 'resources/list':
        if (this.#resources == null) {
          break
        }
        return this.#resources.list({ params: request.params, signal })
      case 'resources/read':
        if (this.#resources == null) {
          break
        }
        return this.#resources.read({ params: request.params, signal })
      case 'resources/templates/list':
        if (this.#resources == null) {
          break
        }
        return this.#resources.listTemplates({ params: request.params, signal })
      case 'tools/call':
        return await this.callTool(request, signal)
      case 'tools/list':
        return { tools: this.#toolsList }
    }
    throw new RPCError(METHOD_NOT_FOUND, `Unsupported method: ${request.method}`)
  }

  async callTool(request: CallToolRequest, signal: AbortSignal): Promise<CallToolResult> {
    const handler = this.#toolHandlers[request.params.name]
    if (handler == null) {
      throw new RPCError(INVALID_PARAMS, `Tool ${request.params.name} not found`)
    }
    return await handler({ input: request.params.arguments ?? {}, signal })
  }

  async getPrompt(request: GetPromptRequest, signal: AbortSignal): Promise<GetPromptResult> {
    const handler = this.#promptHandlers[request.params.name]
    if (handler == null) {
      throw new RPCError(INVALID_PARAMS, `Prompt ${request.params.name} not found`)
    }
    return await handler({ arguments: request.params.arguments, signal })
  }
}

export function serve(params: ServerParams): ContextServer {
  return new ContextServer(params)
}
