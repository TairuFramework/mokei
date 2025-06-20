import { Disposer, raceSignal } from '@enkaku/async'
import { EventEmitter } from '@enkaku/event'
import { fromStream } from '@enkaku/generator'
import type { CallToolResult } from '@mokei/context-protocol'
import type { SentRequest } from '@mokei/context-rpc'
import { ContextHost, type ContextTool, type EnableToolsArg } from '@mokei/host'
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
  command: string
  args?: Array<string>
  env?: Record<string, string>
  signal?: AbortSignal
  enableTools?: EnableToolsArg
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
  #contextHost: ContextHost
  #providers: Map<string, ModelProvider<T>>

  constructor(params: SessionParams<T> = {}) {
    super({
      dispose: async () => {
        await this.#contextHost.dispose()
      },
    })
    this.#events = new EventEmitter()
    this.#contextHost = new ContextHost()
    this.#providers = new Map(Object.entries(params.providers ?? {}))
  }

  get activeChatRequest(): StreamChatRequest<T['MessagePart'], T['ToolCall']> | null {
    return this.#activeChatRequest
  }

  get contextHost(): ContextHost {
    return this.#contextHost
  }

  get events(): EventEmitter<SessionEvents<T>> {
    return this.#events
  }

  get providers(): Map<string, ModelProvider<T>> {
    return this.#providers
  }

  async #setupContext(params: AddContextParams): Promise<Array<ContextTool>> {
    const { key, command, args, env, enableTools } = params
    await this.#contextHost.spawn({ key, command, args, env })
    const tools = await this.#contextHost.setup(key, enableTools ?? true)
    this.#events.emit('context-added', { key, tools })
    return tools
  }

  addContext(params: AddContextParams): Promise<Array<ContextTool>> {
    return params.signal
      ? raceSignal(this.#setupContext(params), params.signal).catch((err) => {
          this.#contextHost.remove(params.key)
          throw err
        })
      : this.#setupContext(params)
  }

  removeContext(key: string): void {
    this.#contextHost.remove(key)
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
    return this.#contextHost.getCallableTools().map(provider.toolFromMCP)
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
      return this.#contextHost.callNamespacedTool(toolCall.name, JSON.parse(toolCall.arguments))
    }
    if (signal.aborted) {
      throw signal.reason
    }
    const request = this.#contextHost.callNamespacedTool(toolCall.name, JSON.parse(toolCall.arguments))
    signal.addEventListener('abort', () => request.cancel())
    return request
  }
}
