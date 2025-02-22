import { NodeStreamsTransport } from '@enkaku/node-streams-transport'
import { type Schema, type Validator, createValidator } from '@enkaku/schema'
import {
  INVALID_REQUEST,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  clientMessage,
  createClientMessage,
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

import type { SpecificationDefinition } from './definitions.js'
import { RPCError, errorResponse } from './error.js'
import type {
  PromptHandler,
  ResourceHandlers,
  ServerTransport,
  ToPromptHandlers,
  ToToolHandlers,
  ToolHandler,
} from './types.js'

export type ServerParams<Spec extends SpecificationDefinition> = {
  name: string
  version: string
  specification: Spec
  transport?: ServerTransport
  resources?: ResourceHandlers
} & (Spec['prompts'] extends Record<string, unknown>
  ? { prompts: ToPromptHandlers<Spec['prompts']> }
  : { prompts?: never }) &
  (Spec['tools'] extends Record<string, unknown>
    ? { tools: ToToolHandlers<Spec['tools']> }
    : { tools?: never })

function isRequestID(id: unknown): id is RequestID {
  return typeof id === 'string' || typeof id === 'number'
}

export class ContextServer<Spec extends SpecificationDefinition> {
  #capabilities: ServerCapabilities = {}
  #serverInfo: Implementation
  #promptHandlers: Spec['prompts'] extends Record<string, unknown>
    ? ToPromptHandlers<Spec['prompts']>
    : Record<string, never>
  #promptsList: Array<Prompt> = []
  #toolHandlers: Spec['tools'] extends Record<string, unknown>
    ? ToToolHandlers<Spec['tools']>
    : Record<string, never>
  #toolsList: Array<Tool> = []
  #validator: Validator<ClientMessage>

  constructor(params: ServerParams<Spec>) {
    this.#serverInfo = { name: params.name, version: params.version }
    // @ts-ignore type instantiation too deep
    this.#promptHandlers = params.prompts ?? {}
    // @ts-ignore type instantiation too deep
    this.#toolHandlers = params.tools ?? {}

    const promptArguments: Record<string, Schema | undefined> = {}
    for (const [name, prompt] of Object.entries(params.specification.prompts ?? {})) {
      promptArguments[name] = prompt.arguments
      this.#promptsList.push({
        name,
        description: prompt.description,
        argumentsSchema: prompt.arguments,
      })
    }
    if (this.#promptsList.length !== 0) {
      this.#capabilities.prompts = {}
    }

    const toolInputs: Record<string, Schema> = {}
    for (const [name, tool] of Object.entries(params.specification.tools ?? {})) {
      toolInputs[name] = tool.input
      this.#toolsList.push({ name, description: tool.description, inputSchema: tool.input })
    }
    if (this.#toolsList.length !== 0) {
      this.#capabilities.tools = {}
    }

    this.#validator = createValidator(
      this.#promptsList.length === 0 && this.#toolsList.length === 0
        ? clientMessage
        : createClientMessage({ promptArguments, callTools: toolInputs }),
    )

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
      const validated = this.#validator(next.value)
      if (validated.issues == null) {
        this.handleMessage(validated.value, inflight).then(
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
    const handledRequest = this.handleRequest(request, controller.signal)
    handledRequest.finally(() => {
      delete inflight[request.id]
    })
    return await handledRequest
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
      case 'tools/call':
        return await this.callTool(request, signal)
      case 'tools/list':
        return { tools: this.#toolsList }
      default:
        throw new RPCError(METHOD_NOT_FOUND, `Unsupported method: ${request.method}`)
    }
  }

  async callTool(request: CallToolRequest, signal: AbortSignal): Promise<CallToolResult> {
    const handler = this.#toolHandlers[request.params.name] as ToolHandler<Schema>
    if (handler == null) {
      throw new Error(`Tool ${request.params.name} not found`)
    }
    return await handler({ input: request.params.arguments, signal })
  }

  async getPrompt(request: GetPromptRequest, signal: AbortSignal): Promise<GetPromptResult> {
    const handler = this.#promptHandlers[request.params.name] as PromptHandler<Schema>
    if (handler == null) {
      throw new Error(`Prompt ${request.params.name} not found`)
    }
    return await handler({ arguments: request.params.arguments, signal })
  }
}

export function serve<Spec extends SpecificationDefinition>(
  params: ServerParams<Spec>,
): ContextServer<Spec> {
  return new ContextServer<Spec>(params)
}
