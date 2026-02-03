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

import type {
  Llama,
  LlamaContext,
  LlamaEmbeddingContext,
  LlamaModel,
} from 'node-llama-cpp'

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
  #llama: Llama | null = null
  #loadedModels: Map<string, LlamaModel> = new Map()
  #defaultContexts: Map<string, LlamaContext> = new Map()
  #embeddingContexts: Map<string, LlamaEmbeddingContext> = new Map()
  #managedContexts: Set<LlamaContext | LlamaEmbeddingContext> = new Set()

  constructor(params: LlamaProviderParams = {}) {
    super({
      dispose: async () => {
        await this.#disposeAll()
      },
    })
    this.#registry = new Map(Object.entries(params.models ?? {}))
  }

  async #getLlama(): Promise<Llama> {
    if (this.#llama == null) {
      const { getLlama } = await import('node-llama-cpp')
      this.#llama = await getLlama()
    }
    return this.#llama
  }

  async #loadModel(name: string): Promise<LlamaModel> {
    const existing = this.#loadedModels.get(name)
    if (existing != null) {
      return existing
    }
    const config = this.#registry.get(name)
    if (config == null) {
      throw new Error(`Model "${name}" is not registered`)
    }
    const llama = await this.#getLlama()
    const model = await llama.loadModel({ modelPath: config.path })
    this.#loadedModels.set(name, model)
    return model
  }

  async #disposeAll(): Promise<void> {
    for (const context of this.#managedContexts) {
      await context.dispose()
    }
    this.#managedContexts.clear()
    this.#defaultContexts.clear()
    this.#embeddingContexts.clear()

    for (const model of this.#loadedModels.values()) {
      await model.dispose()
    }
    this.#loadedModels.clear()

    if (this.#llama != null) {
      await this.#llama.dispose()
      this.#llama = null
    }
  }

  async getContext(model: string): Promise<LlamaContext> {
    const existing = this.#defaultContexts.get(model)
    if (existing != null) {
      return existing
    }
    const config = this.#registry.get(model)
    if (config == null) {
      throw new Error(`Model "${model}" is not registered`)
    }
    const loadedModel = await this.#loadModel(model)
    const context = await loadedModel.createContext({
      contextSize: config.contextSize,
    })
    this.#defaultContexts.set(model, context)
    this.#managedContexts.add(context)
    return context
  }

  async createContext(
    model: string,
    options?: { contextSize?: number },
  ): Promise<LlamaContext> {
    const loadedModel = await this.#loadModel(model)
    const context = await loadedModel.createContext({
      contextSize: options?.contextSize,
    })
    this.#managedContexts.add(context)
    return context
  }

  async disposeContext(context: LlamaContext | LlamaEmbeddingContext): Promise<void> {
    this.#managedContexts.delete(context)
    for (const [name, ctx] of this.#defaultContexts) {
      if (ctx === context) {
        this.#defaultContexts.delete(name)
        break
      }
    }
    for (const [name, ctx] of this.#embeddingContexts) {
      if (ctx === context) {
        this.#embeddingContexts.delete(name)
        break
      }
    }
    await context.dispose()
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
