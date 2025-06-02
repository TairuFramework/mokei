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
} from '@mokei/model-provider'

export type AddContextParams = {
  key: string
  file: string
  arguments?: Array<string>
  signal?: AbortSignal
}

export type ChatParams<T extends ProviderTypes = ProviderTypes> = {
  model: string
  messages: Array<Message<T['MessagePart'], T['ToolCall']>>
  tools?: Array<T['Tool']>
  signal?: AbortSignal
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
  provider: ModelProvider<T>
}

export class Session<T extends ProviderTypes = ProviderTypes> extends Disposer {
  #events: EventEmitter<SessionEvents<T>>
  #host: ContextHost
  #provider: ModelProvider<T>

  constructor(params: SessionParams<T>) {
    super({
      dispose: async () => {
        await this.#host.dispose()
      },
    })
    this.#events = new EventEmitter()
    this.#host = new ContextHost()
    this.#provider = params.provider
  }

  get events(): EventEmitter<SessionEvents<T>> {
    return this.#events
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

  getToolsForProvider(): Array<T['Tool']> {
    return this.#host.getCallableTools().map(this.#provider.toolFromMCP)
  }

  async chat(params: ChatParams): Promise<AggregatedMessage<T['ToolCall']>> {
    const tools = params.tools ?? this.getToolsForProvider()
    const stream = await this.#provider.streamChat({ ...params, tools })

    const messagesParts: Array<ServerMessage<T['MessagePart'], T['ToolCall']>> = []
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

    return this.#provider.aggregateMessage(messagesParts)
  }

  executeToolCall(
    toolCall: FunctionToolCall<T['ToolCall']>,
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
