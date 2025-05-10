import { assertType } from '@enkaku/schema'
import type { Tool as ContextTool } from '@mokei/context-protocol'
import { tryParseJSON } from '@mokei/model-provider'
import type {
  AggregatedMessage,
  ClientMessage,
  FunctionToolCall,
  MessagePart,
  ModelProvider,
  RequestParams,
  ServerMessage,
  StreamChatParams,
} from '@mokei/model-provider'

import { OpenAIClient } from './client.js'
import type { ChatCompletionChunk, OpenAIClientParams } from './client.js'
import { type OpenAIConfiguration, validateConfiguration } from './config.js'
import type { Message, Model, Tool, ToolCall } from './types.js'

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
    if (!params.client) {
      throw new Error('OpenAI client configuration is required')
    }
    this.#client =
      params.client instanceof OpenAIClient ? params.client : new OpenAIClient(params.client)
  }

  async listModels(params?: RequestParams) {
    const models = await this.#client.listModels(params)
    return models.map((model) => ({ id: model.id, raw: model }))
  }

  aggregateMessage(
    parts: Array<ServerMessage<ChatCompletionChunk, ToolCall>>,
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
      messages: params.messages.map((msg: ClientMessage | ServerMessage<Message, ToolCall> | AggregatedMessage<ToolCall>) => {
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
        }
      }),
      model: params.model,
      signal: params.signal,
      stream: true,
      tools: params.tools,
    })
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
                    input: tryParseJSON(call.function.arguments),
                    id: call.id,
                    raw: call,
                  }
                }),
                raw: part,
              })
            }
            if (part.choices[0]?.finish_reason) {
              controller.enqueue({ type: 'done', reason: part.choices[0].finish_reason })
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