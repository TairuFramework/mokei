import { assertType } from '@enkaku/schema'
import type { Tool as ContextTool } from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  ClientMessage,
  EmbedParams,
  FunctionToolCall,
  MessagePart,
  ModelProvider,
  RequestParams,
  ServerMessage,
  StreamChatParams,
} from '@mokei/model-provider'
import type { ChatCompletionChunk, OpenAIClientParams } from './client.js'
import { OpenAIClient } from './client.js'
import { type OpenAIConfiguration, validateConfiguration } from './config.js'
import type { ChatCompletionUsage, Message, Model, Tool, ToolCall } from './types.js'

export type OpenAITypes = {
  Message: Message
  MessagePart: ChatCompletionChunk
  Model: Model
  Tool: Tool
  ToolCall: ToolCall
}

export type OpenAIProviderParams = {
  client?: OpenAIClient | OpenAIClientParams
}

export class OpenAIProvider implements ModelProvider<OpenAITypes> {
  static fromConfig(config: OpenAIConfiguration): OpenAIProvider {
    assertType(validateConfiguration, config)
    return new OpenAIProvider({ client: new OpenAIClient(config) })
  }

  #client: OpenAIClient

  constructor(params: OpenAIProviderParams) {
    this.#client =
      params.client instanceof OpenAIClient ? params.client : new OpenAIClient(params.client)
  }

  async listModels(params?: RequestParams) {
    const models = await this.#client.listModels(params)
    return models.map((model) => ({ id: model.id, raw: model }))
  }

  async embed(params: EmbedParams) {
    const embeddings = await this.#client.embeddings(params)
    return { embeddings: embeddings.map((e) => e.embedding) }
  }

  aggregateMessage(
    parts: Array<ServerMessage<ChatCompletionChunk, ToolCall>>,
  ): AggregatedMessage<ToolCall> {
    let text = ''
    const toolCalls: Array<FunctionToolCall<ToolCall>> = []
    let currentToolCall: FunctionToolCall<ToolCall> | null = null
    let doneReason: string | undefined
    let inputTokens = 0
    let outputTokens = 0

    for (const part of parts) {
      if (part.text != null) {
        text += part.text
      }
      if (part.toolCalls != null) {
        for (const toolCall of part.toolCalls) {
          if (toolCall.id != null) {
            if (currentToolCall != null) {
              toolCalls.push(currentToolCall)
            }
            currentToolCall = toolCall
          } else if (currentToolCall != null) {
            currentToolCall.arguments += toolCall.arguments
          }
        }
      }
      if (part.doneReason != null) {
        doneReason = part.doneReason
      }
      if (part.inputTokens != null) {
        inputTokens += part.inputTokens
      }
      if (part.outputTokens != null) {
        outputTokens += part.outputTokens
      }
    }
    if (currentToolCall != null) {
      toolCalls.push(currentToolCall)
    }
    return {
      source: 'aggregated',
      role: 'assistant',
      text,
      toolCalls,
      doneReason,
      inputTokens,
      outputTokens,
    }
  }

  streamChat(params: StreamChatParams<Message, ToolCall, Tool>) {
    const request = this.#client.chat({
      messages: params.messages.map(
        (msg: ClientMessage | ServerMessage<Message, ToolCall> | AggregatedMessage<ToolCall>) => {
          switch (msg.source) {
            case 'aggregated':
              return {
                role: msg.role,
                content: msg.text,
                tool_calls: msg.toolCalls.map((c: FunctionToolCall<ToolCall>) => c.raw),
              }
            case 'client':
              return { role: msg.role, content: msg.text }
            case 'server':
              return msg.raw
            default:
              throw new Error('Unknown message source')
          }
        },
      ),
      model: params.model,
      signal: params.signal,
      stream: true,
      tools: params.tools,
      // Add response_format for structured output
      response_format: params.output
        ? {
            type: 'json_schema' as const,
            json_schema: {
              name: params.output.name ?? 'response',
              description: params.output.description,
              schema: params.output.schema as Record<string, unknown>,
              strict: params.output.strict ?? true,
            },
          }
        : undefined,
    })

    let usage: ChatCompletionUsage | null = null
    const response = request.then((stream: ReadableStream<ChatCompletionChunk>) => {
      return stream.pipeThrough(
        new TransformStream<ChatCompletionChunk, MessagePart<ChatCompletionChunk, ToolCall>>({
          transform(part, controller) {
            const delta = part.choices[0]?.delta
            if (delta?.content) {
              controller.enqueue({ type: 'text-delta', text: delta.content, raw: part })
            }
            if (delta?.tool_calls) {
              controller.enqueue({
                type: 'tool-call',
                toolCalls: delta.tool_calls.map((call: ToolCall) => {
                  return {
                    name: call.function.name,
                    arguments: call.function.arguments,
                    id: call.id,
                    raw: call,
                  }
                }),
                raw: part,
              })
            }
            if (part.choices[0]?.finish_reason) {
              controller.enqueue({
                type: 'done',
                reason: part.choices[0].finish_reason,
                inputTokens: usage?.prompt_tokens ?? 0,
                outputTokens: usage?.completion_tokens ?? 0,
              })
            }
            if (part.usage != null) {
              usage = part.usage
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
