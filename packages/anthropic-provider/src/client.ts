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

/**
 * Known Claude models - Anthropic doesn't have a list models endpoint
 */
export const KNOWN_MODELS: Array<Model> = [
  {
    id: 'claude-sonnet-4-20250514',
    type: 'model',
    display_name: 'Claude Sonnet 4',
    created_at: '2025-05-14',
  },
  {
    id: 'claude-3-7-sonnet-20250219',
    type: 'model',
    display_name: 'Claude 3.7 Sonnet',
    created_at: '2025-02-19',
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    type: 'model',
    display_name: 'Claude 3.5 Sonnet',
    created_at: '2024-10-22',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    type: 'model',
    display_name: 'Claude 3.5 Haiku',
    created_at: '2024-10-22',
  },
  {
    id: 'claude-3-opus-20240229',
    type: 'model',
    display_name: 'Claude 3 Opus',
    created_at: '2024-02-29',
  },
]

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
  async listModels(_params: ListModelParams = {}): Promise<Array<Model>> {
    return KNOWN_MODELS
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
