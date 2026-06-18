import { unlink } from 'node:fs/promises'
import { Disposer, lazy } from '@enkaku/async'
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
  Message as ProviderMessage,
  RequestParams,
  ServerMessage,
  StreamChatParams,
  StreamChatRequest,
} from '@mokei/model-provider'
import type {
  ChatHistoryItem,
  ChatSessionModelFunctions,
  Llama,
  LlamaContext,
  LlamaEmbeddingContext,
  LlamaModel,
} from 'node-llama-cpp'

import { type LlamaConfiguration, type LlamaModelConfig, validateConfiguration } from './config.js'
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
  #llamaPromise: Promise<Llama> | null = null
  #loadedModels: Map<string, LlamaModel> = new Map()
  #loadingModels: Map<string, Promise<LlamaModel>> = new Map()
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
    if (this.#llamaPromise == null) {
      this.#llamaPromise = lazy(async () => {
        const { getLlama } = await import('node-llama-cpp')
        return await getLlama()
      })
    }
    return this.#llamaPromise
  }

  async #loadModel(name: string): Promise<LlamaModel> {
    const existing = this.#loadedModels.get(name)
    if (existing != null) {
      return existing
    }
    const loading = this.#loadingModels.get(name)
    if (loading != null) {
      return loading
    }
    const config = this.#registry.get(name)
    if (config == null) {
      throw new Error(`Model "${name}" is not registered`)
    }
    const promise = this.#doLoadModel(name, config)
    this.#loadingModels.set(name, promise)
    return promise
  }

  async #doLoadModel(name: string, config: LlamaModelConfig): Promise<LlamaModel> {
    try {
      const llama = await this.#getLlama()
      const gpuLayers =
        config.gpu === true || config.gpu === 'auto' ? 'auto' : config.gpu === false ? 0 : undefined
      const model = await llama.loadModel({
        modelPath: config.path,
        ...(gpuLayers != null ? { gpuLayers } : {}),
      })
      this.#loadedModels.set(name, model)
      return model
    } finally {
      this.#loadingModels.delete(name)
    }
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

    if (this.#llamaPromise != null) {
      const llama = await this.#llamaPromise
      await llama.dispose()
      this.#llamaPromise = null
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

  async createContext(model: string, options?: { contextSize?: number }): Promise<LlamaContext> {
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

  async downloadModel(
    name: string,
    uri: string,
    options?: {
      contextSize?: number
      gpu?: boolean | 'auto'
      onProgress?: (progress: { downloaded: number; total: number; percent: number }) => void
    },
  ): Promise<LlamaModelConfig> {
    const { createModelDownloader } = await import('node-llama-cpp')
    const onProgress = options?.onProgress
    const downloader = await createModelDownloader({
      modelUri: uri,
      onProgress: onProgress
        ? (status: { totalSize: number; downloadedSize: number }) => {
            onProgress({
              downloaded: status.downloadedSize,
              total: status.totalSize,
              percent: status.totalSize > 0 ? status.downloadedSize / status.totalSize : 0,
            })
          }
        : undefined,
    })
    const modelPath = await downloader.download()

    const config: LlamaModelConfig = {
      path: modelPath,
      ...(options?.contextSize != null ? { contextSize: options.contextSize } : {}),
      ...(options?.gpu != null ? { gpu: options.gpu } : {}),
    }
    this.#registry.set(name, config)
    return config
  }

  async deleteModel(name: string): Promise<void> {
    const config = this.#registry.get(name)
    if (config == null) {
      throw new Error(`Model "${name}" is not registered`)
    }

    const defaultCtx = this.#defaultContexts.get(name)
    if (defaultCtx != null) {
      await this.disposeContext(defaultCtx)
    }
    const embedCtx = this.#embeddingContexts.get(name)
    if (embedCtx != null) {
      await this.disposeContext(embedCtx)
    }

    const model = this.#loadedModels.get(name)
    if (model != null) {
      await model.dispose()
      this.#loadedModels.delete(name)
    }

    await unlink(config.path)
    this.#registry.delete(name)
  }

  async inspectRemoteModel(uri: string): Promise<unknown> {
    const { readGgufFileInfo } = await import('node-llama-cpp')
    return await readGgufFileInfo(uri)
  }

  async listModels(_params?: RequestParams): Promise<Array<Model<ModelInfo>>> {
    return Array.from(this.#registry.entries()).map(([name, config]) => ({
      id: name,
      raw: { name, path: config.path },
    }))
  }

  async embed(params: EmbedParams): Promise<EmbedResponse> {
    const config = this.#registry.get(params.model)
    if (config == null) {
      throw new Error(`Model "${params.model}" is not registered`)
    }

    let embeddingContext = this.#embeddingContexts.get(params.model)
    if (embeddingContext == null) {
      const model = await this.#loadModel(params.model)
      embeddingContext = await model.createEmbeddingContext()
      this.#embeddingContexts.set(params.model, embeddingContext)
      this.#managedContexts.add(embeddingContext)
    }

    const inputs = Array.isArray(params.input) ? params.input : [params.input]
    const embeddings: Array<Array<number>> = []

    for (const input of inputs) {
      const embedding = await embeddingContext.getEmbeddingFor(input)
      embeddings.push(Array.from(embedding.vector))
    }

    return { embeddings }
  }

  streamChat(
    params: StreamChatParams<Message, ToolCall, Tool> & {
      context?: LlamaContext
      newContext?: boolean
    },
  ): StreamChatRequest<ChatResponseChunk, ToolCall> {
    const controller = new AbortController()
    const signal =
      params.signal != null
        ? AbortSignal.any([params.signal, controller.signal])
        : controller.signal
    const abort = () => controller.abort()
    let cancelled = false

    const response = (async () => {
      if (params.output != null && params.tools != null && params.tools.length > 0) {
        throw new Error(
          'Structured output (grammar) and tool calling (functions) cannot be used together with node-llama-cpp. Provide either output or tools, but not both.',
        )
      }

      const context =
        params.context ??
        (params.newContext
          ? await this.createContext(params.model)
          : await this.getContext(params.model))

      const { history, prompt } = this.#convertMessages(params.messages)

      const { LlamaChatSession } = await import('node-llama-cpp')
      const sequence = context.getSequence()
      const tokensBefore = sequence.tokenMeter.getState()
      const session = new LlamaChatSession({ contextSequence: sequence })

      if (history.length > 0) {
        session.setChatHistory(history)
      }

      const onTextChunk =
        (
          streamController: ReadableStreamDefaultController<
            MessagePart<ChatResponseChunk, ToolCall>
          >,
        ) =>
        (chunk: string) => {
          if (cancelled) return
          const raw: ChatResponseChunk = { text: chunk, done: false }
          streamController.enqueue({ type: 'text-delta', text: chunk, raw })
        }

      const promptOptions = params.output
        ? {
            signal,
            grammar: await (await this.#getLlama()).createGrammarForJsonSchema(
              params.output.schema as Parameters<Llama['createGrammarForJsonSchema']>[0],
            ),
            onTextChunk: undefined as ((chunk: string) => void) | undefined,
          }
        : {
            signal,
            functions: this.#buildFunctions(params.tools),
            onTextChunk: undefined as ((chunk: string) => void) | undefined,
          }

      return new ReadableStream<MessagePart<ChatResponseChunk, ToolCall>>({
        start(streamController) {
          const safeEnqueue = (part: MessagePart<ChatResponseChunk, ToolCall>) => {
            if (!cancelled) streamController.enqueue(part)
          }
          const safeClose = () => {
            if (!cancelled) streamController.close()
          }
          promptOptions.onTextChunk = onTextChunk(streamController)
          session
            .promptWithMeta(prompt, promptOptions)
            .then((result) => {
              const response = result.response as Array<unknown>
              const stopReason = result.stopReason as string

              if (stopReason === 'functionCalls') {
                for (const item of response) {
                  if (
                    typeof item === 'object' &&
                    item != null &&
                    'type' in item &&
                    (item as { type: string }).type === 'functionCall'
                  ) {
                    const fnCall = item as { type: 'functionCall'; name: string; params: unknown }
                    const toolCall: ToolCall = {
                      function: {
                        name: fnCall.name,
                        arguments:
                          fnCall.params != null && typeof fnCall.params === 'object'
                            ? (fnCall.params as Record<string, unknown>)
                            : {},
                      },
                    }
                    const raw: ChatResponseChunk = {
                      toolCalls: [toolCall],
                      done: false,
                    }
                    safeEnqueue({
                      type: 'tool-call',
                      toolCalls: [
                        {
                          name: fnCall.name,
                          arguments: JSON.stringify(fnCall.params ?? {}),
                          id: globalThis.crypto.randomUUID(),
                          raw: toolCall,
                        },
                      ],
                      raw,
                    })
                  }
                }
              }

              const tokensDiff = sequence.tokenMeter.diff(tokensBefore)
              const doneRaw: ChatResponseChunk = { done: true }
              safeEnqueue({
                type: 'done',
                reason: stopReason === 'functionCalls' ? 'tool_calls' : 'stop',
                inputTokens: tokensDiff.usedInputTokens,
                outputTokens: tokensDiff.usedOutputTokens,
                raw: doneRaw,
              })
              safeClose()
            })
            .catch((error: unknown) => {
              if (signal.aborted) {
                const tokensDiff = sequence.tokenMeter.diff(tokensBefore)
                const doneRaw: ChatResponseChunk = { done: true }
                safeEnqueue({
                  type: 'done',
                  reason: 'abort',
                  inputTokens: tokensDiff.usedInputTokens,
                  outputTokens: tokensDiff.usedOutputTokens,
                  raw: doneRaw,
                })
                safeClose()
              } else {
                const errorRaw: ChatResponseChunk = { done: true }
                safeEnqueue({ type: 'error', error, raw: errorRaw })
                safeClose()
              }
            })
            .finally(() => {
              session.dispose()
            })
        },
        cancel() {
          cancelled = true
          controller.abort()
        },
      })
    })()

    return Object.assign(response, { abort, signal })
  }

  #convertMessages(messages: Array<ProviderMessage<Message, ToolCall>>): {
    history: Array<ChatHistoryItem>
    prompt: string
  } {
    const history: Array<ChatHistoryItem> = []
    let prompt = ''

    // Find the last user message index - it becomes the prompt
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.source === 'client' && msg.role === 'user') {
        lastUserIdx = i
        break
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      if (msg.source === 'client' && msg.role === 'system') {
        history.push({ type: 'system', text: msg.text } as ChatHistoryItem)
      } else if (msg.source === 'client' && msg.role === 'user') {
        if (i === lastUserIdx) {
          prompt = msg.text
        } else {
          history.push({ type: 'user', text: msg.text } as ChatHistoryItem)
        }
      } else if (
        (msg.source === 'aggregated' || msg.source === 'server') &&
        msg.role === 'assistant'
      ) {
        const response: Array<unknown> = []
        if (msg.text) {
          response.push(msg.text)
        }
        if ('toolCalls' in msg && msg.toolCalls != null) {
          for (const tc of msg.toolCalls) {
            response.push({
              type: 'functionCall',
              name: tc.name,
              params: JSON.parse(tc.arguments),
            })
          }
        }
        history.push({ type: 'model', response } as ChatHistoryItem)
      } else if (msg.source === 'client' && msg.role === 'tool') {
        // Find the last model response in history and attach result to the matching function call
        for (let j = history.length - 1; j >= 0; j--) {
          const item = history[j] as { type: string; response?: Array<unknown> }
          if (item.type === 'model' && item.response != null) {
            for (const respItem of item.response) {
              if (
                typeof respItem === 'object' &&
                respItem != null &&
                'type' in respItem &&
                (respItem as { type: string }).type === 'functionCall' &&
                'name' in respItem &&
                (respItem as { name: string }).name === msg.toolCallName
              ) {
                ;(respItem as { result?: string }).result = msg.text
                break
              }
            }
            break
          }
        }
      }
    }

    return { history, prompt }
  }

  #buildFunctions(tools?: Array<Tool>): ChatSessionModelFunctions | undefined {
    if (tools == null || tools.length === 0) {
      return undefined
    }
    const functions: Record<string, ChatSessionModelFunctions[string]> = {}
    for (const tool of tools) {
      functions[tool.function.name] = {
        description: tool.function.description,
        params: tool.function.parameters,
        handler: async (_params: Record<string, unknown>) => {
          return ''
        },
      }
    }
    return functions
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
