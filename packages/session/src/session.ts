import { Disposer, raceSignal } from '@enkaku/async'
import { EventEmitter } from '@enkaku/event'
import { fromStream } from '@enkaku/generator'
import type { CallToolResult } from '@mokei/context-protocol'
import type { SentRequest } from '@mokei/context-rpc'
import {
  ContextHost,
  type ContextTool,
  type EnableToolsArg,
  type LocalToolDefinition,
} from '@mokei/host'
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
  /**
   * Local tools that can be called directly without setting up an MCP server.
   * These tools are registered with the `local:` namespace prefix.
   *
   * @example
   * ```typescript
   * const session = new Session({
   *   providers: { openai },
   *   localTools: [{
   *     name: 'calculate',
   *     description: 'Evaluate a math expression',
   *     inputSchema: {
   *       type: 'object',
   *       properties: { expression: { type: 'string' } },
   *       required: ['expression']
   *     },
   *     execute: async ({ expression }) => {
   *       const result = eval(expression)
   *       return { content: [{ type: 'text', text: String(result) }] }
   *     }
   *   }]
   * })
   * ```
   */
  localTools?: Array<LocalToolDefinition>
}

/**
 * Convert a message part chunk to a ServerMessage for aggregation.
 * Returns null for error chunks which should be handled separately.
 */
function chunkToServerMessage<M, TC>(chunk: MessagePart<M, TC>): ServerMessage<M, TC> | null {
  switch (chunk.type) {
    case 'tool-call':
      return {
        source: 'server',
        role: 'assistant',
        toolCalls: chunk.toolCalls,
        raw: chunk.raw as M,
      }
    case 'text-delta':
      return {
        source: 'server',
        role: 'assistant',
        text: chunk.text,
        raw: chunk.raw as M,
      }
    case 'reasoning-delta':
      return {
        source: 'server',
        role: 'assistant',
        reasoning: chunk.reasoning,
        raw: chunk.raw as M,
      }
    case 'done':
      return {
        source: 'server',
        role: 'assistant',
        inputTokens: chunk.inputTokens,
        outputTokens: chunk.outputTokens,
        raw: chunk.raw as M,
      }
    case 'error':
    default:
      return null
  }
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

    // Register local tools if provided
    if (params.localTools) {
      this.#contextHost.addLocalTools(params.localTools)
    }
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
    await this.#contextHost.addLocalContext({ key, command, args, env })
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

  /**
   * Add a local tool that can be called directly without setting up an MCP server.
   * Local tools are namespaced as `local:toolName`.
   */
  addLocalTool(definition: LocalToolDefinition): void {
    this.#contextHost.addLocalTool(definition)
  }

  /**
   * Add multiple local tools at once.
   */
  addLocalTools(definitions: Array<LocalToolDefinition>): void {
    this.#contextHost.addLocalTools(definitions)
  }

  /**
   * Remove a local tool by name.
   */
  removeLocalTool(name: string): boolean {
    return this.#contextHost.removeLocalTool(name)
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

  /**
   * Resolve a provider from a string key or return the provider directly.
   */
  resolveProvider<P extends T = T>(provider: string | ModelProvider<P>): ModelProvider<P> {
    return typeof provider === 'string' ? this.getProvider<P>(provider) : provider
  }

  /**
   * Stream a single chat turn, yielding message parts as they arrive.
   * Returns the aggregated message when the stream completes.
   *
   * This is a lower-level method that can be used to build custom chat loops
   * while sharing the streaming infrastructure with `chat()`.
   *
   * @example
   * ```typescript
   * const generator = session.streamChatTurn({
   *   provider: 'openai',
   *   model: 'gpt-4',
   *   messages: [{ source: 'client', role: 'user', text: 'Hello' }],
   * })
   *
   * for await (const chunk of generator) {
   *   if (chunk.type === 'text-delta') {
   *     process.stdout.write(chunk.text)
   *   }
   * }
   *
   * const aggregated = await generator.next().then(r => r.value)
   * ```
   */
  async *streamChatTurn<P extends T = T>(params: {
    provider: string | ModelProvider<P>
    model: string
    messages: Array<Message<P['MessagePart'], P['ToolCall']>>
    tools?: Array<P['Tool']>
    signal?: AbortSignal
  }): AsyncGenerator<
    MessagePart<P['MessagePart'], P['ToolCall']>,
    AggregatedMessage<P['ToolCall']>,
    unknown
  > {
    const provider = this.resolveProvider(params.provider)
    const tools = params.tools ?? this.getToolsForProvider(provider)

    const request = provider.streamChat({ ...params, tools })
    const stream = await request

    const messageParts: Array<ServerMessage<P['MessagePart'], P['ToolCall']>> = []

    for await (const chunk of fromStream(stream)) {
      this.#events.emit('message-part', chunk)

      if (chunk.type === 'error') {
        throw chunk.error
      }

      const serverMessage = chunkToServerMessage(chunk)
      if (serverMessage != null) {
        messageParts.push(serverMessage)
      }

      yield chunk
    }

    return provider.aggregateMessage(messageParts)
  }

  /**
   * Perform a single chat completion and return the aggregated response.
   * Emits 'message-part' events for each chunk received.
   */
  async chat<P extends T = T>(params: ChatParams<P>): Promise<AggregatedMessage<P['ToolCall']>> {
    if (this.#activeChatRequest != null) {
      if (params.abortActiveRequest) {
        this.#activeChatRequest.abort()
      } else {
        throw new Error('A chat request is already active')
      }
    }

    const provider = this.resolveProvider(params.provider)
    const tools = params.tools ?? this.getToolsForProvider(provider)

    try {
      this.#activeChatRequest = provider.streamChat({ ...params, tools })
      const stream = await this.#activeChatRequest

      const messageParts: Array<ServerMessage<P['MessagePart'], P['ToolCall']>> = []

      for await (const chunk of fromStream(stream)) {
        this.#events.emit('message-part', chunk)

        if (chunk.type === 'error') {
          throw chunk.error
        }

        const serverMessage = chunkToServerMessage(chunk)
        if (serverMessage != null) {
          messageParts.push(serverMessage)
        }
      }

      return provider.aggregateMessage(messageParts)
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
    const request = this.#contextHost.callNamespacedTool(
      toolCall.name,
      JSON.parse(toolCall.arguments),
    )
    signal.addEventListener('abort', () => request.cancel())
    return request
  }
}
