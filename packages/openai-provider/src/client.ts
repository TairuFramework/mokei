import type { RequestParams } from '@mokei/model-provider'
import type { AnyReplyRequest, SingleReplyRequest, StreamReplyRequest } from '@mokei/model-provider'
import { type EventSourceMessage, EventSourceParserStream } from 'eventsource-parser/stream'
import ky, { type KyInstance, type ResponsePromise } from 'ky'

import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, type OpenAIConfiguration } from './config.js'
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  Embedding,
  Message,
  Model,
  Tool,
} from './types.js'

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
            // Check for end of run - https://platform.openai.com/docs/api-reference/runs/createRun#runs-createrun-stream
            if (!message.data.startsWith('[DONE]')) {
              controller.enqueue(JSON.parse(message.data.trim()))
            }
          },
        }),
      )
  })
}

export type ListModelParams = RequestParams

export type EmbeddingsParams = RequestParams & {
  input: string | Array<string>
  model: string
  dimensions?: number
  encoding_format?: 'float' | 'base64'
  user?: string
}

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

export type { ChatCompletionChunk }

export class OpenAIClient {
  #api: KyInstance

  constructor(params: OpenAIClientParams = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (params.apiKey != null) {
      headers.Authorization = `Bearer ${params.apiKey}`
    }
    this.#api = ky.create({
      prefixUrl: params.baseURL ?? DEFAULT_BASE_URL,
      timeout: params.timeout ?? DEFAULT_TIMEOUT,
      headers,
    })
  }

  async listModels(params: ListModelParams = {}): Promise<Array<Model>> {
    const res = await this.#api
      .get<{ data: Array<Model> }>('models', { signal: params.signal })
      .json()
    return res.data
  }

  async embeddings(params: EmbeddingsParams): Promise<Array<Embedding>> {
    const { signal, ...request } = params
    const res = await this.#api
      .post<{ data: Array<Embedding> }>('embeddings', { json: request, signal })
      .json()
    return res.data
  }

  chat(params: ChatParams & { stream?: false }): SingleReplyRequest<ChatCompletionResponse>
  chat(params: ChatParams & { stream: true }): StreamReplyRequest<ChatCompletionChunk>
  chat(params: ChatParams): AnyReplyRequest<ChatCompletionResponse | ChatCompletionChunk> {
    const controller = new AbortController()
    const request = this.#api.post<ChatCompletionResponse | ChatCompletionChunk>(
      'chat/completions',
      {
        json: {
          model: params.model,
          messages: params.messages,
          stream: params.stream,
          stream_options: { include_usage: true }, // Ensure we get usage stats
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
      },
    )
    const response = params.stream ? toResponseStream(request) : request.json()
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
  }
}
