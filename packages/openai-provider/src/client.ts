import { fromJSONLines } from '@enkaku/stream'
import type { RequestParams } from '@mokei/model-provider'
import type { AnyReplyRequest, SingleReplyRequest, StreamReplyRequest } from '@mokei/model-provider'
import ky, { type KyInstance, type ResponsePromise } from 'ky'

import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, type OpenAIConfiguration } from './config.js'
import type { ChatCompletionChunk, ChatCompletionResponse, Message, Model, Tool } from './types.js'

function toResponseStream<T>(response: ResponsePromise<T>): Promise<ReadableStream<T>> {
  return response.then((res) => {
    if (res.body == null) {
      throw new Error('No response body')
    }
    return res.body.pipeThrough(fromJSONLines<T>())
  })
}

export type ListModelParams = RequestParams

export type ChatParams = RequestParams & {
  model: string
  messages: Array<Message>
  stream?: boolean
  tools?: Array<Tool>
  temperature?: number
  top_p?: number
  n?: number
  max_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
}

export type OpenAIClientParams = OpenAIConfiguration

export { type ChatCompletionChunk }

export class OpenAIClient {
  #api: KyInstance

  constructor(params: OpenAIClientParams) {
    this.#api = ky.create({
      prefixUrl: params.baseURL ?? DEFAULT_BASE_URL,
      timeout: params.timeout ?? DEFAULT_TIMEOUT,
      headers: {
        'Authorization': `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
    })
  }

  async listModels(params: ListModelParams = {}): Promise<Array<Model>> {
    const res = await this.#api.get<{ data: Array<Model> }>('models', {
      signal: params.signal,
    }).json()
    return res.data
  }

  chat(params: ChatParams & { stream?: false }): SingleReplyRequest<ChatCompletionResponse>
  chat(params: ChatParams & { stream: true }): StreamReplyRequest<ChatCompletionChunk>
  chat(params: ChatParams): AnyReplyRequest<ChatCompletionResponse | ChatCompletionChunk> {
    const controller = new AbortController()
    const request = this.#api.post<ChatCompletionResponse | ChatCompletionChunk>('chat/completions', {
      json: {
        model: params.model,
        messages: params.messages,
        stream: params.stream,
        tools: params.tools,
        temperature: params.temperature,
        top_p: params.top_p,
        n: params.n,
        max_tokens: params.max_tokens,
        presence_penalty: params.presence_penalty,
        frequency_penalty: params.frequency_penalty,
      },
      signal: params.signal
        ? AbortSignal.any([params.signal, controller.signal])
        : controller.signal,
    })
    const response = params.stream ? toResponseStream(request) : request.json()
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
  }
} 