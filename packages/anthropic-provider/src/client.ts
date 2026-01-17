import type { RequestParams, StreamReplyRequest } from '@mokei/model-provider'
import { type EventSourceMessage, EventSourceParserStream } from 'eventsource-parser/stream'
import ky, { type KyInstance, type ResponsePromise } from 'ky'

import {
  type AnthropicConfiguration,
  DEFAULT_ANTHROPIC_VERSION,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT,
} from './config.js'
import type { Message, Model, StreamEvent, Tool } from './types.js'

function toResponseStream<T>(response: ResponsePromise<T>): Promise<ReadableStream<T>> {
  return response.then((res) => {
    if (res.body == null) {
      throw new Error('No response body')
    }
    return res.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .pipeThrough(
        new TransformStream<EventSourceMessage, T>({
          transform(message, controller) {
            if (message.data?.trim()) {
              try {
                controller.enqueue(JSON.parse(message.data.trim()))
              } catch {
                // Ignore parse errors for non-JSON events
              }
            }
          },
        }),
      )
  })
}

export type ListModelParams = RequestParams

export type ListModelResult = {
  data: Array<Model>
  first_id: string
  has_more: boolean
  last_id: string
}

export type ToolChoice = { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string }

export type MessagesParams = RequestParams & {
  model: string
  messages: Array<Message>
  max_tokens: number
  system?: string
  tools?: Array<Tool>
  tool_choice?: ToolChoice
  stream?: boolean
  temperature?: number
  top_p?: number
  top_k?: number
  stop_sequences?: Array<string>
  metadata?: {
    user_id?: string
  }
}

export type AnthropicClientParams = AnthropicConfiguration

export type { StreamEvent }

export class AnthropicClient {
  #api: KyInstance
  #anthropicVersion: string

  constructor(params: AnthropicClientParams = {}) {
    this.#anthropicVersion = params.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': this.#anthropicVersion,
    }
    if (params.apiKey != null) {
      headers['x-api-key'] = params.apiKey
    }
    this.#api = ky.create({
      prefixUrl: params.baseURL ?? DEFAULT_BASE_URL,
      timeout: params.timeout ?? DEFAULT_TIMEOUT,
      headers,
    })
  }

  /**
   * List available models (returns known models since Anthropic doesn't have a list endpoint)
   */
  async listModels(_params: ListModelParams = {}): Promise<ListModelResult> {
    return await this.#api.get('models').json<ListModelResult>()
  }

  /**
   * Create a message with streaming
   */
  messages(params: MessagesParams & { stream: true }): StreamReplyRequest<StreamEvent>
  messages(params: MessagesParams): StreamReplyRequest<StreamEvent> {
    const controller = new AbortController()
    const { signal, system, ...restParams } = params

    const request = this.#api.post<StreamEvent>('messages', {
      json: {
        ...restParams,
        stream: true,
        system: system ? [{ type: 'text', text: system }] : undefined,
      },
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    })

    const response = toResponseStream(request)
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
  }
}
