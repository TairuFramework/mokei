import { fromJSONLines } from '@enkaku/stream'
import ky, { type KyInstance, type ResponsePromise } from 'ky'

function toResponseStream<T>(response: ResponsePromise<T>): Promise<ReadableStream<T>> {
  return response.then((res) => {
    if (res.body == null) {
      throw new Error('No response body')
    }
    return res.body.pipeThrough(fromJSONLines<T>())
  })
}

export type SingleResponse<T> = AbortController & Promise<T>
export type StreamResponse<T> = AbortController & Promise<ReadableStream<T>>
export type SingleOrStreamResponse<T> = SingleResponse<T> | StreamResponse<T>

export type ToolCallFunction = {
  name: string
  index?: number
  arguments: Record<string, unknown>
}

export type ToolCall = {
  function: ToolCallFunction
}

export type Message = {
  role: string
  content: string
  images?: Array<string>
  tool_calls?: Array<ToolCall>
}

export type ModelDetails = {
  parent_model: string
  format: string
  family: string
  families: Array<string>
  parameter_size: string
  quantization_level: string
}

export type ToolFunctionProperty = {
  type: string
  description: string
  enum?: Array<string>
}

export type ToolFunctionParameters = {
  type: string
  required: Array<string>
  properties: Record<string, ToolFunctionProperty>
}

export type ToolFunction = {
  name: string
  description: string
  parameters: ToolFunctionParameters
}

export type Tool = {
  type: string
  function: ToolFunction
}

export type AvailableModel = {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details?: ModelDetails
}

export type GenerateParams = {
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
}

export type GenerateResponse = {
  model: string
  created_at: string
  response: string
  done: boolean
  done_reason?: string
}

export type ChatParams = {
  model: string
  messages: Array<Message>
  stream?: boolean
  format?: 'json' | Record<string, unknown> // JSON schema
  keep_alive?: string // duration
  tools?: Array<Tool>
  options?: Record<string, unknown>
}

export type ChatResponse = {
  model: string
  created_at: string
  message: Message
  done: boolean
  done_reason?: string
}

export type OllamaClientParams = {
  url?: string
}

export class OllamaClient {
  #api: KyInstance

  constructor(params: OllamaClientParams = {}) {
    this.#api = ky.create({
      prefixUrl: params.url ?? 'http://localhost:11434/api/',
    })
  }

  async listModels(): Promise<Array<AvailableModel>> {
    const res = await this.#api.get<{ models: Array<AvailableModel> }>('tags').json()
    return res.models
  }

  generate(params: GenerateParams & { stream?: false }): SingleResponse<GenerateResponse>
  generate(params: GenerateParams & { stream: true }): StreamResponse<GenerateResponse>
  generate(params: GenerateParams): SingleOrStreamResponse<GenerateResponse> {
    const controller = new AbortController()
    const request = this.#api.post<GenerateResponse>('generate', {
      json: params,
      signal: controller.signal,
    })
    const response = params.stream ? toResponseStream(request) : request.json()
    return Object.assign(response, controller)
  }

  chat(params: ChatParams & { stream?: false }): SingleResponse<ChatResponse>
  chat(params: ChatParams & { stream: true }): StreamResponse<ChatResponse>
  chat(params: ChatParams): SingleOrStreamResponse<ChatResponse> {
    const controller = new AbortController()
    const request = this.#api.post<ChatResponse>('chat', {
      json: params,
      signal: controller.signal,
    })
    const response = params.stream ? toResponseStream(request) : request.json()
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
  }
}

export const ollama = new OllamaClient()
