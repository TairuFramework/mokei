import { mapStreamErrors, type RequestParams, type StreamReplyRequest } from '@mokei/model-provider'
import { type EventSourceMessage, EventSourceParserStream } from 'eventsource-parser/stream'
import ky, { type KyInstance, type ResponsePromise, type RetryOptions } from 'ky'

import {
  type AnthropicConfiguration,
  DEFAULT_ANTHROPIC_VERSION,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT,
} from './config.js'
import { toAnthropicError } from './errors.js'
import type { Message, Model, StreamEvent, Tool } from './types.js'

/** Retry for idempotent requests (model listing); messages are retried by the caller. */
export const IDEMPOTENT_RETRY: RetryOptions = {
  limit: 2,
  methods: ['get'],
  statusCodes: [408, 429, 500, 502, 503, 504, 529],
  afterStatusCodes: [429, 503, 529],
  maxRetryAfter: 30_000,
  backoffLimit: 30_000,
  jitter: true,
}

function rethrow(error: unknown): never {
  throw toAnthropicError(error)
}

function toResponseStream<T>(response: ResponsePromise<T>): Promise<ReadableStream<T>> {
  return response.then((res) => {
    if (res.body == null) {
      throw new Error('No response body')
    }
    return mapStreamErrors(res.body, toAnthropicError)
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
  }, rethrow)
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
  providerOptions?: Record<string, unknown>
}

export type AnthropicClientParams = AnthropicConfiguration

export type { StreamEvent }

export class AnthropicClient {
  #api: KyInstance
  #anthropicVersion: string
  #baseURL: string

  constructor(params: AnthropicClientParams = {}) {
    this.#anthropicVersion = params.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': this.#anthropicVersion,
    }
    if (params.apiKey != null) {
      headers['x-api-key'] = params.apiKey
    }
    this.#baseURL = params.baseURL ?? DEFAULT_BASE_URL
    this.#api = ky.create({
      prefix: this.#baseURL,
      timeout: params.timeout ?? DEFAULT_TIMEOUT,
      headers,
    })
  }

  get baseURL(): string {
    return this.#baseURL
  }

  /**
   * List available models via the Anthropic `GET /v1/models` endpoint
   */
  async listModels(params: ListModelParams = {}): Promise<ListModelResult> {
    return await this.#api
      .get('models', { signal: params.signal, retry: IDEMPOTENT_RETRY })
      .json<ListModelResult>()
      .catch(rethrow)
  }

  /**
   * Create a message with streaming
   */
  messages(params: MessagesParams & { stream: true }): StreamReplyRequest<StreamEvent>
  messages(params: MessagesParams): StreamReplyRequest<StreamEvent> {
    const controller = new AbortController()
    const {
      signal,
      system,
      providerOptions,
      model,
      messages,
      tools,
      tool_choice,
      ...samplingRest
    } = params
    const request = this.#api.post<StreamEvent>('messages', {
      json: {
        // sampling / tuning (temperature, top_p, top_k, max_tokens,
        // stop_sequences, metadata) -- overridable
        ...samplingRest,
        ...providerOptions,
        // structural / transport -- asserted last so providerOptions cannot override them
        model,
        messages,
        tools,
        tool_choice,
        stream: true,
        system: system ? [{ type: 'text', text: system }] : undefined,
      },
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    })

    const response = toResponseStream(request)
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
  }
}
