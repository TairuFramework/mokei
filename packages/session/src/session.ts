import { Disposer, raceSignal } from '@enkaku/async'
import { EventEmitter } from '@enkaku/event'
import { fromStream } from '@enkaku/generator'
import type { CallToolResult } from '@mokei/context-protocol'
import type { SentRequest } from '@mokei/context-rpc'
import { ContextHost, type ContextTool } from '@mokei/host'
import type {
  AggregatedMessage,
  FunctionToolCall,
  Message,
  MessagePart,
  ModelProvider,
  ProviderTypes,
  ServerMessage,
  StreamChatRequest,
} from '@mokei/model-provider'

export type AddContextParams = {
  key: string
  file: string
  arguments?: Array<string>
  signal?: AbortSignal
}

export type ChatParams<T extends ProviderTypes = ProviderTypes> = {
  provider: string | ModelProvider<T>
  model: string
  messages: Array<Message<T['MessagePart'], T['ToolCall']>>
  tools?: Array<T['Tool']>
  signal?: AbortSignal
  abortActiveRequest?: boolean
}

export type ContextAddedEvent = {
  key: string
  tools: Array<ContextTool>
}

export type ContextRemovedEvent = {
  key: string
}

export type SessionEvents<T extends ProviderTypes = ProviderTypes> = {
  'context-added': ContextAddedEvent
  'context-removed': ContextRemovedEvent
  'message-part': MessagePart<T['MessagePart'], T['ToolCall']>
}

export type SessionParams<T extends ProviderTypes = ProviderTypes> = {
  providers?: Record<string, ModelProvider<T>>
}

export class Session<T extends ProviderTypes = ProviderTypes> extends Disposer {
  #activeChatRequest: StreamChatRequest<T['MessagePart'], T['ToolCall']> | null = null
  #events: EventEmitter<SessionEvents<T>>
  #host: ContextHost
  #providers: Map<string, ModelProvider<T>>

  constructor(params: SessionParams<T> = {}) {
    super({
      dispose: async () => {
        await this.#host.dispose()
      },
    })
    this.#events = new EventEmitter()
    this.#host = new ContextHost()
    this.#providers = new Map(Object.entries(params.providers ?? {}))
  }

  get activeChatRequest(): StreamChatRequest<T['MessagePart'], T['ToolCall']> | null {
    return this.#activeChatRequest
  }

  get events(): EventEmitter<SessionEvents<T>> {
    return this.#events
  }

  get providers(): Map<string, ModelProvider<T>> {
    return this.#providers
  }

  async #setupContext(key: string, file: string, args: Array<string>): Promise<Array<ContextTool>> {
    await this.#host.spawn(key, file, args)
    const tools = await this.#host.setup(key)
    this.#events.emit('context-added', { key, tools })
    return tools
  }

  addContext(params: AddContextParams): Promise<Array<ContextTool>> {
    const key = params.key
    const args = params.arguments ?? []
    return params.signal
      ? raceSignal(this.#setupContext(key, params.file, args), params.signal).catch((err) => {
          this.#host.remove(key)
          throw err
        })
      : this.#setupContext(key, params.file, args)
  }

  removeContext(key: string): void {
    this.#host.remove(key)
    this.#events.emit('context-removed', { key })
  }

  addProvider<P extends T = T>(key: string, provider: ModelProvider<P>): void {
    if (this.#providers.has(key)) {
      throw new Error(`Provider with key ${key} already exists`)
    }
    this.#providers.set(key, provider as unknown as ModelProvider<T>)
  }

  getProvider<P extends T = T>(key: string): ModelProvider<P> {
    const provider = this.#providers.get(key)
    if (provider == null) {
      throw new Error(`Provider with key ${key} does not exist`)
    }
    return provider as unknown as ModelProvider<P>
  }

  removeProvider(key: string): void {
    this.#providers.delete(key)
  }

  getToolsForProvider<P extends T = T>(provider: ModelProvider<P>): Array<P['Tool']> {
    return this.#host.getCallableTools().map(provider.toolFromMCP)
  }

  async chat<P extends T = T>(params: ChatParams<P>): Promise<AggregatedMessage<P['ToolCall']>> {
    if (this.#activeChatRequest != null) {
      if (params.abortActiveRequest) {
        this.#activeChatRequest.abort()
      } else {
        throw new Error('A chat request is already active')
      }
    }

    const provider =
      typeof params.provider === 'string' ? this.getProvider<P>(params.provider) : params.provider
    const tools = params.tools ?? this.getToolsForProvider(provider)

    try {
      this.#activeChatRequest = provider.streamChat({ ...params, tools })
      const stream = await this.#activeChatRequest

      const messagesParts: Array<ServerMessage<P['MessagePart'], P['ToolCall']>> = []
      for await (const chunk of fromStream(stream)) {
        this.#events.emit('message-part', chunk)
        switch (chunk.type) {
          case 'tool-call':
            messagesParts.push({
              source: 'server',
              role: 'assistant',
              toolCalls: chunk.toolCalls,
              raw: chunk.raw,
            })
            break
          case 'text-delta':
            messagesParts.push({
              source: 'server',
              role: 'assistant',
              text: chunk.text,
              raw: chunk.raw,
            })
            break
          case 'reasoning-delta':
            messagesParts.push({
              source: 'server',
              role: 'assistant',
              reasoning: chunk.reasoning,
              raw: chunk.raw,
            })
            break
          case 'done':
            messagesParts.push({
              source: 'server',
              role: 'assistant',
              inputTokens: chunk.inputTokens,
              outputTokens: chunk.outputTokens,
              raw: chunk.raw,
            })
            break
          case 'error':
            throw chunk.error
        }
      }
      return provider.aggregateMessage(messagesParts)
    } finally {
      this.#activeChatRequest = null
    }
  }

  executeToolCall<P extends T = T>(
    toolCall: FunctionToolCall<P['ToolCall']>,
    signal?: AbortSignal,
  ): SentRequest<CallToolResult> {
    if (signal == null) {
      return this.#host.callNamespacedTool(toolCall.name, JSON.parse(toolCall.input))
    }
    if (signal.aborted) {
      throw signal.reason
    }
    const request = this.#host.callNamespacedTool(toolCall.name, JSON.parse(toolCall.input))
    signal.addEventListener('abort', () => request.cancel())
    return request
  }
}
