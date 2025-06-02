import { assertType } from '@enkaku/schema'
import type { Tool as ContextTool } from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  EmbedParams,
  FunctionToolCall,
  MessagePart,
  ModelProvider,
  ServerMessage,
  StreamChatParams,
} from '@mokei/model-provider'

import { OllamaClient } from './client.js'
import type { ChatResponse, ListModelParams, OllamaClientParams } from './client.js'
import { type OllamaConfiguration, validateConfiguration } from './config.js'
import type { Message, Model, Tool, ToolCall } from './types.js'

export type OllamaTypes = {
  Message: Message
  MessagePart: ChatResponse
  Model: Model
  Tool: Tool
  ToolCall: ToolCall
}

export type OllamaProviderParams = {
  client?: OllamaClient | OllamaClientParams
}

export class OllamaProvider implements ModelProvider<OllamaTypes> {
  static fromConfig(config: OllamaConfiguration): OllamaProvider {
    assertType(validateConfiguration, config)
    return new OllamaProvider({ client: new OllamaClient(config) })
  }

  #client: OllamaClient

  constructor(params: OllamaProviderParams = {}) {
    this.#client =
      params.client instanceof OllamaClient ? params.client : new OllamaClient(params.client)
  }

  // Client APIs wrappers

  async listModels(params?: ListModelParams) {
    const models = await this.#client.listModels(params)
    return models.map((model) => ({ id: model.name, raw: model }))
  }

  async embed(params: EmbedParams) {
    const res = await this.#client.embed(params)
    return { embeddings: res.embeddings }
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
      signal: params.signal,
      stream: true,
      tools: params.tools,
    })
    const response = request.then((stream) => {
      return stream.pipeThrough(
        new TransformStream<ChatResponse, MessagePart<ChatResponse, ToolCall>>({
          transform(part, controller) {
            if (part.message.content != null && part.message.content !== '') {
              controller.enqueue({ type: 'text-delta', text: part.message.content, raw: part })
            }
            if (part.message.thinking != null && part.message.thinking !== '') {
              controller.enqueue({
                type: 'reasoning-delta',
                reasoning: part.message.thinking,
                raw: part,
              })
            }
            if (part.message.tool_calls != null) {
              controller.enqueue({
                type: 'tool-call',
                toolCalls: part.message.tool_calls.map((call) => {
                  return {
                    name: call.function.name,
                    input:
                      typeof call.function.arguments === 'string'
                        ? call.function.arguments
                        : JSON.stringify(call.function.arguments),
                    id: globalThis.crypto.randomUUID(),
                    raw: call,
                  }
                }),
                raw: part,
              })
            }
            if (part.done) {
              controller.enqueue({
                type: 'done',
                reason: part.done_reason,
                inputTokens: part.prompt_eval_count ?? 0,
                outputTokens: part.eval_count ?? 0,
              })
            }
          },
        }),
      )
    })
    return Object.assign(response, { abort: request.abort, signal: request.signal })
  }

  // Utilities

  aggregateMessage(
    parts: Array<ServerMessage<ChatResponse, ToolCall>>,
  ): AggregatedMessage<ToolCall> {
    let text = ''
    let reasoning = ''
    let toolCalls: Array<FunctionToolCall<ToolCall>> = []
    let inputTokens = 0
    let outputTokens = 0
    for (const part of parts) {
      if (part.text != null) {
        text += part.text
      }
      if (part.reasoning != null) {
        reasoning += part.reasoning
      }
      if (part.toolCalls != null) {
        toolCalls = toolCalls.concat(part.toolCalls)
      }
      if (part.inputTokens != null) {
        inputTokens += part.inputTokens
      }
      if (part.outputTokens != null) {
        outputTokens += part.outputTokens
      }
    }
    return { source: 'aggregated', role: 'assistant', text, toolCalls, inputTokens, outputTokens }
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
