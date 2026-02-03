import { Disposer } from '@enkaku/async'
import { assertType } from '@enkaku/schema'
import type { Tool as ContextTool } from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  EmbedParams,
  EmbedResponse,
  FunctionToolCall,
  MessagePart,
  Model,
  ModelProvider,
  RequestParams,
  ServerMessage,
  StreamChatParams,
  StreamChatRequest,
} from '@mokei/model-provider'

import {
  type LlamaConfiguration,
  type LlamaModelConfig,
  validateConfiguration,
} from './config.js'
import type { ChatResponseChunk, Message, ModelInfo, Tool, ToolCall } from './types.js'

export type LlamaTypes = {
  Message: Message
  MessagePart: ChatResponseChunk
  Model: ModelInfo
  Tool: Tool
  ToolCall: ToolCall
}

export type LlamaProviderParams = {
  models?: Record<string, LlamaModelConfig>
}

export class LlamaProvider extends Disposer implements ModelProvider<LlamaTypes> {
  static fromConfig(config: LlamaConfiguration): LlamaProvider {
    assertType(validateConfiguration, config)
    return new LlamaProvider({ models: config.models })
  }

  #registry: Map<string, LlamaModelConfig>

  constructor(params: LlamaProviderParams = {}) {
    super({
      dispose: async () => {
        await this.#disposeAll()
      },
    })
    this.#registry = new Map(Object.entries(params.models ?? {}))
  }

  async #disposeAll(): Promise<void> {
    // Will be implemented in Task 4 (context management)
  }

  async listModels(_params?: RequestParams): Promise<Array<Model<ModelInfo>>> {
    return Array.from(this.#registry.entries()).map(([name, config]) => ({
      id: name,
      raw: { name, path: config.path },
    }))
  }

  async embed(_params: EmbedParams): Promise<EmbedResponse> {
    // Will be implemented in Task 6 (embeddings)
    throw new Error('Not implemented')
  }

  streamChat(
    _params: StreamChatParams<Message, ToolCall, Tool>,
  ): StreamChatRequest<ChatResponseChunk, ToolCall> {
    // Will be implemented in Task 5 (streamChat)
    throw new Error('Not implemented')
  }

  aggregateMessage(
    parts: Array<ServerMessage<ChatResponseChunk, ToolCall>>,
  ): AggregatedMessage<ToolCall> {
    let text = ''
    let reasoning = ''
    let toolCalls: Array<FunctionToolCall<ToolCall>> = []
    let inputTokens = 0
    let outputTokens = 0
    let doneReason: string | undefined
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
    return {
      source: 'aggregated',
      role: 'assistant',
      text,
      reasoning,
      toolCalls,
      doneReason,
      inputTokens,
      outputTokens,
    }
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
