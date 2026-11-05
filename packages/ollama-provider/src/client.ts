import {
  type AnyReplyRequest,
  mapStreamErrors,
  type RequestParams,
  type SingleReplyRequest,
  type StreamReplyRequest,
} from '@mokei/model-provider'
import { fromJSONLines } from '@sozai/stream'
import ky, { type KyInstance, type ResponsePromise, type RetryOptions } from 'ky'

import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, type OllamaConfiguration } from './config.js'
import { toOllamaError } from './errors.js'
import type { Message, Model, Tool } from './types.js'

/**
 * Retry for idempotent requests (embeddings, model listing); chat and generate are retried by
 * the caller. `request.retry` overrides it.
 */
export const IDEMPOTENT_RETRY: RetryOptions = {
  limit: 2,
  methods: ['get', 'post'],
  statusCodes: [408, 429, 500, 502, 503, 504],
  afterStatusCodes: [429, 503],
  maxRetryAfter: 30_000,
  backoffLimit: 30_000,
  jitter: true,
}

function rethrow(error: unknown): never {
  throw toOllamaError(error)
}

function toResponseStream<T>(response: ResponsePromise<T>): Promise<ReadableStream<T>> {
  return response.then((res) => {
    if (res.body == null) {
      throw new Error('No response body')
    }
    return mapStreamErrors(res.body, toOllamaError).pipeThrough(fromJSONLines<T>())
  }, rethrow)
}

export type RequestOptions = {
  retry?: RetryOptions | number
  timeout?: number | false
}

export type ListModelParams = RequestParams & { request?: RequestOptions }

export type EmbedParams = RequestParams & {
  model: string
  input: string | Array<string>
  truncate?: boolean
}

export type EmbedResponse = {
  model: string
  embeddings: Array<Array<number>>
}

export type GenerateParams = RequestParams & {
  model: string
  prompt: string
  suffix?: string
  images?: Array<string>
  format?: 'json' | Record<string, unknown> // JSON schema
  options?: Record<string, unknown>
  system?: string
  template?: string
  stream?: boolean
  raw?: boolean
  keep_alive?: string
  think?: boolean
  request?: RequestOptions
}

export type GenerateResponse = {
  model: string
  created_at: string
  response: string
  done: boolean
  done_reason?: string
}

export type ChatParams = RequestParams & {
  model: string
  messages: Array<Message>
  stream?: boolean
  format?: 'json' | Record<string, unknown> // JSON schema
  keep_alive?: string // duration
  tools?: Array<Tool>
  think?: boolean
  options?: Record<string, unknown>
  request?: RequestOptions
}

export type ChatResponseStreaming = {
  model: string
  created_at: string
  message: Message
  done: false
  done_reason?: never
  prompt_eval_count?: never
  eval_count?: never
}

export type ChatResponseFinal = {
  model: string
  created_at: string
  message: Message
  done: true
  done_reason?: string
  prompt_eval_count: number
  eval_count: number
}

export type ChatResponse = ChatResponseStreaming | ChatResponseFinal

export type OllamaClientParams = OllamaConfiguration

export class OllamaClient {
  #api: KyInstance
  #baseURL: string

  constructor(params: OllamaClientParams = {}) {
    this.#baseURL = params.baseURL ?? DEFAULT_BASE_URL
    this.#api = ky.create({
      prefix: this.#baseURL,
      timeout: params.timeout ?? DEFAULT_TIMEOUT,
    })
  }

  get baseURL(): string {
    return this.#baseURL
  }

  async listModels(params: ListModelParams = {}): Promise<Array<Model>> {
    const options = { retry: IDEMPOTENT_RETRY, ...params.request, signal: params.signal }
    const res = await this.#api.get<{ models: Array<Model> }>('tags', options).json().catch(rethrow)
    return res.models
  }

  async embed(params: EmbedParams): Promise<EmbedResponse> {
    const { signal, ...request } = params
    return await this.#api
      .post<EmbedResponse>('embed', { json: request, signal, retry: IDEMPOTENT_RETRY })
      .json()
      .catch(rethrow)
  }

  generate(params: GenerateParams & { stream?: false }): SingleReplyRequest<GenerateResponse>
  generate(params: GenerateParams & { stream: true }): StreamReplyRequest<GenerateResponse>
  generate(params: GenerateParams): AnyReplyRequest<GenerateResponse> {
    const controller = new AbortController()
    const options = params.request ?? {}
    const request = this.#api.post<GenerateResponse>('generate', {
      ...options,
      json: params,
      signal: params.signal
        ? AbortSignal.any([params.signal, controller.signal])
        : controller.signal,
    })
    const response = params.stream ? toResponseStream(request) : request.json().catch(rethrow)
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
  }

  chat(params: ChatParams & { stream?: false }): SingleReplyRequest<ChatResponseFinal>
  chat(params: ChatParams & { stream: true }): StreamReplyRequest<ChatResponse>
  chat(params: ChatParams): AnyReplyRequest<ChatResponse> {
    const controller = new AbortController()
    const options = params.request ?? {}
    const request = this.#api.post<ChatResponse>('chat', {
      ...options,
      json: params,
      signal: params.signal
        ? AbortSignal.any([params.signal, controller.signal])
        : controller.signal,
    })
    const response = params.stream ? toResponseStream(request) : request.json().catch(rethrow)
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
  }
}
