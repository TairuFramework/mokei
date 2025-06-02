import { fromJSONLines } from '@enkaku/stream'
import type {
  AnyReplyRequest,
  RequestParams,
  SingleReplyRequest,
  StreamReplyRequest,
} from '@mokei/model-provider'
import ky, { type KyInstance, type ResponsePromise, type RetryOptions } from 'ky'

import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, type OllamaConfiguration } from './config.js'
import type { Message, Model, Tool } from './types.js'

function toResponseStream<T>(response: ResponsePromise<T>): Promise<ReadableStream<T>> {
  return response.then((res) => {
    if (res.body == null) {
      throw new Error('No response body')
    }
    return res.body.pipeThrough(fromJSONLines<T>())
  })
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

  constructor(params: OllamaClientParams = {}) {
    this.#api = ky.create({
      prefixUrl: params.baseURL ?? DEFAULT_BASE_URL,
      timeout: params.timeout ?? DEFAULT_TIMEOUT,
    })
  }

  async listModels(params: ListModelParams = {}): Promise<Array<Model>> {
    const options = params.request
      ? { ...params.request, signal: params.signal }
      : { signal: params.signal }
    const res = await this.#api.get<{ models: Array<Model> }>('tags', options).json()
    return res.models
  }

  async embed(params: EmbedParams): Promise<EmbedResponse> {
    const { signal, ...request } = params
    return await this.#api.post<EmbedResponse>('embed', { json: request, signal }).json()
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
    const response = params.stream ? toResponseStream(request) : request.json()
    return Object.assign(response, controller)
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
    const response = params.stream ? toResponseStream(request) : request.json()
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
  }
}
