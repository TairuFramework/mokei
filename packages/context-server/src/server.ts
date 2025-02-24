import { NodeStreamsTransport } from '@enkaku/node-streams-transport'
import type { Schema, Validator } from '@enkaku/schema'
import {
  INVALID_PARAMS,
  INVALID_REQUEST,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
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
import {
  createCallToolsValidator,
  createGetPromptsValidator,
  validateClientMessage,
} from './validation.js'

export type NoSpecification = { prompts: undefined; tools: undefined }

export type ServerParams<Spec extends SpecificationDefinition = NoSpecification> = {
  name: string
  version: string
  specification?: Spec
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

export class ContextServer<Spec extends SpecificationDefinition = NoSpecification> {
  #capabilities: ServerCapabilities = {}
  #serverInfo: Implementation
  #promptHandlers: Spec['prompts'] extends Record<string, unknown>
    ? ToPromptHandlers<Spec['prompts']>
    : Record<string, never>
  #promptsList: Array<Prompt> = []
  #resources?: ResourceHandlers
  #toolHandlers: Spec['tools'] extends Record<string, unknown>
    ? ToToolHandlers<Spec['tools']>
    : Record<string, never>
  #toolsList: Array<Tool> = []
  #validateCallTool?: Validator<CallToolRequest>
  #validateGetPrompt?: Validator<GetPromptRequest>

  constructor(params: ServerParams<Spec>) {
    this.#serverInfo = { name: params.name, version: params.version }
    // @ts-ignore type instantiation too deep
    this.#promptHandlers = params.prompts ?? {}
    this.#resources = params.resources
    // @ts-ignore type instantiation too deep
    this.#toolHandlers = params.tools ?? {}

    const promptArguments: Record<string, Schema | undefined> = {}
    for (const [name, prompt] of Object.entries(params.specification?.prompts ?? {})) {
      promptArguments[name] = prompt.arguments
      this.#promptsList.push({
        name,
        description: prompt.description,
        argumentsSchema: prompt.arguments,
      })
    }
    if (this.#promptsList.length !== 0) {
      this.#capabilities.prompts = {}
      this.#validateGetPrompt = createGetPromptsValidator(promptArguments)
    }

    if (this.#resources != null) {
      this.#capabilities.resources = {}
    }

    const toolInputs: Record<string, Schema> = {}
    for (const [name, tool] of Object.entries(params.specification?.tools ?? {})) {
      toolInputs[name] = tool.input
      this.#toolsList.push({ name, description: tool.description, inputSchema: tool.input })
    }
    if (this.#toolsList.length !== 0) {
      this.#capabilities.tools = {}
      this.#validateCallTool = createCallToolsValidator(toolInputs)
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
    if (this.#validateCallTool != null) {
      const validated = this.#validateCallTool(request)
      if (validated.issues != null) {
        throw new RPCError(INVALID_PARAMS, 'Tool call validation failed', {
          issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
        })
      }
    }

    const handler = this.#toolHandlers[request.params.name] as ToolHandler<Schema>
    if (handler == null) {
      throw new RPCError(INVALID_PARAMS, `Tool ${request.params.name} not found`)
    }

    return await handler({ input: request.params.arguments, signal })
  }

  async getPrompt(request: GetPromptRequest, signal: AbortSignal): Promise<GetPromptResult> {
    if (this.#validateGetPrompt != null) {
      const validated = this.#validateGetPrompt(request)
      if (validated.issues != null) {
        throw new RPCError(INVALID_PARAMS, 'Prompt validation failed', {
          issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
        })
      }
    }

    const handler = this.#promptHandlers[request.params.name] as PromptHandler<Schema>
    if (handler == null) {
      throw new RPCError(INVALID_PARAMS, `Prompt ${request.params.name} not found`)
    }

    return await handler({ arguments: request.params.arguments, signal })
  }
}

export function serve<Spec extends SpecificationDefinition = NoSpecification>(
  params: ServerParams<Spec>,
): ContextServer<Spec> {
  return new ContextServer<Spec>(params)
}
