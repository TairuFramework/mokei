/**
 * Mokei Ollama provider.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/ollama-provider
 * ```
 *
 * @module ollama-provider
 */

import { fromJSONLines } from '@enkaku/stream'
import type { Tool as ContextTool } from '@mokei/context-protocol'
import { tryParseJSON } from '@mokei/model-provider'
import type {
  AggregatedMessage,
  FunctionToolCall,
  MessagePart,
  ModelProvider,
  ServerMessage,
  SingleOrStreamResponse,
  SingleResponse,
  StreamChatParams,
  StreamResponse,
} from '@mokei/model-provider'
import ky, { type KyInstance, type ResponsePromise } from 'ky'

function toResponseStream<T>(response: ResponsePromise<T>): Promise<ReadableStream<T>> {
  return response.then((res) => {
    if (res.body == null) {
      throw new Error('No response body')
    }
    return res.body.pipeThrough(fromJSONLines<T>())
  })
}

export type ModelDetails = {
  parent_model: string
  format: string
  family: string
  families: Array<string>
  parameter_size: string
  quantization_level: string
}

export type Model = {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details?: ModelDetails
}

export type ToolCallFunction = {
  name: string
  arguments: Record<string, unknown>
}

export type ToolCall = {
  function: ToolCallFunction
}

export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: Array<string>
  tool_calls?: Array<ToolCall>
}

export type ToolFunctionProperty = {
  type: string
  description: string
  enum?: Array<string>
}

export type ToolFunctionParameters = {
  type: string
  required: Array<string>
  properties: Record<string, ToolFunctionProperty>
}

export type ToolFunction = {
  name: string
  description: string
  parameters: ToolFunctionParameters
}

export type Tool = {
  type: string
  function: ToolFunction
}

export type GenerateParams = {
  model: string
  prompt: string
  suffix?: string
  images?: Array<string>
  format?: 'json' | Record<string, unknown> // JSON schema
  options?: Record<string, unknown>
  system?: string
  template?: string
  stream?: boolean
  raw?: boolean
  keep_alive?: string
}

export type GenerateResponse = {
  model: string
  created_at: string
  response: string
  done: boolean
  done_reason?: string
}

export type ChatParams = {
  model: string
  messages: Array<Message>
  stream?: boolean
  format?: 'json' | Record<string, unknown> // JSON schema
  keep_alive?: string // duration
  tools?: Array<Tool>
  options?: Record<string, unknown>
}

export type ChatResponse = {
  model: string
  created_at: string
  message: Message
  done: boolean
  done_reason?: string
}

export type OllamaClientParams = {
  baseURL?: string
}

export class OllamaClient {
  #api: KyInstance

  constructor(params: OllamaClientParams = {}) {
    this.#api = ky.create({
      prefixUrl: params.baseURL ?? 'http://localhost:11434/api',
      timeout: 30_000,
    })
  }

  async listModels(): Promise<Array<Model>> {
    const res = await this.#api.get<{ models: Array<Model> }>('tags').json()
    return res.models
  }

  generate(params: GenerateParams & { stream?: false }): SingleResponse<GenerateResponse>
  generate(params: GenerateParams & { stream: true }): StreamResponse<GenerateResponse>
  generate(params: GenerateParams): SingleOrStreamResponse<GenerateResponse> {
    const controller = new AbortController()
    const request = this.#api.post<GenerateResponse>('generate', {
      json: params,
      signal: controller.signal,
    })
    const response = params.stream ? toResponseStream(request) : request.json()
    return Object.assign(response, controller)
  }

  chat(params: ChatParams & { stream?: false }): SingleResponse<ChatResponse>
  chat(params: ChatParams & { stream: true }): StreamResponse<ChatResponse>
  chat(params: ChatParams): SingleOrStreamResponse<ChatResponse> {
    const controller = new AbortController()
    const request = this.#api.post<ChatResponse>('chat', {
      json: params,
      signal: controller.signal,
    })
    const response = params.stream ? toResponseStream(request) : request.json()
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
  }
}

export type OllamaTypes = {
  Message: Message
  MessagePart: ChatResponse
  Model: Model
  Tool: Tool
  ToolCall: ToolCall
}

export type OllamaProviderParams = {
  client: OllamaClient | OllamaClientParams
}

export class OllamaProvider implements ModelProvider<OllamaTypes> {
  #client: OllamaClient

  constructor(params: OllamaProviderParams) {
    this.#client =
      params.client instanceof OllamaClient ? params.client : new OllamaClient(params.client)
  }

  async listModels() {
    const models = await this.#client.listModels()
    return models.map((model) => ({ id: model.name, raw: model }))
  }

  aggregateMessage(
    parts: Array<ServerMessage<ChatResponse, ToolCall>>,
  ): AggregatedMessage<ToolCall> {
    let text = ''
    let toolCalls: Array<FunctionToolCall<ToolCall>> = []
    for (const part of parts) {
      if (part.text != null) {
        text += part.text
      }
      if (part.toolCalls != null) {
        toolCalls = toolCalls.concat(part.toolCalls)
      }
    }
    return { source: 'aggregated', role: 'assistant', text, toolCalls }
  }

  streamChat(params: StreamChatParams<Message, ToolCall, Tool>) {
    const request = this.#client.chat({
      messages: params.messages.map((msg) => {
        switch (msg.source) {
          case 'aggregated':
            return {
              role: msg.role,
              content: msg.text,
              tool_calls: msg.toolCalls.map((c) => c.raw),
            }
          case 'client':
            return { role: msg.role, content: msg.text }
          case 'server':
            return msg.raw
        }
      }),
      model: params.model,
      stream: true,
      tools: params.tools,
    })
    const response = request.then((stream) => {
      return stream.pipeThrough(
        new TransformStream<ChatResponse, MessagePart<ChatResponse, ToolCall>>({
          transform(part, controller) {
            if (part.message.content !== '') {
              controller.enqueue({ type: 'text-delta', text: part.message.content, raw: part })
            }
            if (part.message.tool_calls != null) {
              controller.enqueue({
                type: 'tool-call',
                toolCalls: part.message.tool_calls.map((call) => {
                  return {
                    name: call.function.name,
                    input: tryParseJSON(call.function.arguments),
                    id: globalThis.crypto.randomUUID(),
                    raw: call,
                  }
                }),
                raw: part,
              })
            }
            if (part.done) {
              controller.enqueue({ type: 'done', reason: part.done_reason })
            }
          },
        }),
      )
    })
    return Object.assign(response, { abort: request.abort, signal: request.signal })
  }

  toolFromMCP(tool: ContextTool): Tool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.inputSchema,
      },
    } as Tool
  }
}
