import type { Tool as ContextTool } from '@mokei/context-protocol'
import { tryParseJSON } from '@mokei/model-provider'
import type {
  AggregatedMessage,
  FunctionToolCall,
  MessagePart,
  ModelProvider,
  ServerMessage,
  SingleReplyRequest,
  StreamChatParams,
  StreamReplyRequest,
} from '@mokei/model-provider'
import { type EventSourceMessage, EventSourceParserStream } from 'eventsource-parser/stream'
import ky, { type KyInstance, type ResponsePromise } from 'ky'

function toResponseStream<T>(response: ResponsePromise<T>): Promise<ReadableStream<T | null>> {
  return response.then((res) => {
    if (res.body == null) {
      throw new Error('No response body')
    }
    return res.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .pipeThrough(
        new TransformStream<EventSourceMessage, T | null>({
          transform(message, controller) {
            // Check for end of run - https://platform.openai.com/docs/api-reference/runs/createRun#runs-createrun-stream
            if (message.data.startsWith('[DONE]')) {
              controller.enqueue(null)
            } else {
              controller.enqueue(JSON.parse(message.data.trim()))
            }
          },
        }),
      )
  })
}

export type Model = {
  id: string
  created: number // Unix timestamp in seconds.
  object: 'model'
  owned_by: string
}

export type ListModelsResponse = {
  object: 'list'
  data: Array<Model>
}

export type TextContentPart = {
  type: 'text'
  text: string
}

export type ImageURLObject = {
  url: string // URL or base64 encoded image
  details?: 'low' | 'high' | 'auto'
}

export type ImageURLContentPart = {
  type: 'image_url'
  image_url: ImageURLObject
}

export type InputAudioObject = {
  data: string // base64 encoded audio
  format: 'wav' | 'mp3'
}

export type AudioContentPart = {
  type: 'input_audio'
  input_audio: InputAudioObject
}

export type RefusalContentPart = {
  type: 'refusal'
  refusal: string
}

export type ToolCallFunction = {
  name: string
  arguments: string // stringified JSON
}

export type ToolCall = {
  type: 'function'
  id: string
  function: ToolCallFunction
}

export type DeveloperMessage = {
  role: 'developer'
  content: string | Array<unknown>
  name?: string
}

export type SystemMessage = {
  role: 'system'
  content: string | Array<unknown>
  name?: string
}

export type UserMessageContentPart = TextContentPart | ImageURLContentPart | AudioContentPart

export type UserMessage = {
  role: 'user'
  content: string | Array<UserMessageContentPart>
  name?: string
}

export type AssistantMessage = {
  role: 'assistant'
  content?: string | [TextContentPart, ...Array<TextContentPart>] | [RefusalContentPart]
  name?: string
  refusal?: string | null
  audio?: { id: string } | null
  tool_calls?: Array<ToolCall>
}

export type ToolMessage = {
  role: 'tool'
  content: string | Array<unknown>
  tool_call_id: string
}

export type Message =
  | DeveloperMessage
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage

export type ToolFunction = {
  name: string
  description?: string
  parameters?: Record<string, unknown> // JSON schema object
  strict?: boolean | null
}

export type Tool = {
  type: 'function'
  function: ToolFunction
}

export type ChatParams = {
  model: string
  messages: Array<Message>
  store?: boolean | null
  reasoning_effort?: 'low' | 'medium' | 'high'
  metadata?: Record<string, unknown> | null
  frequency_penalty?: number | null
  logit_bias?: Record<string, number>
  logprobs?: boolean | null
  top_logprobs?: number | null
  max_completion_tokens?: number | null
  n?: number
  modalities?: Array<string> | null
  prediction?: { type: 'content'; content: string | Array<TextContentPart> }
  audio?: {
    voice: 'ash' | 'ballad' | 'coral' | 'sage' | 'verse'
    format: 'wav' | 'mp3' | 'flac' | 'opus' | 'pcm16'
  } | null
  presence_penalty?: number | null
  response_format?:
    | { type: 'text' }
    | { type: 'json_object' }
    | {
        type: 'json_schema'
        json_schema: {
          name: 'string'
          description?: string
          schema?: Record<string, unknown> // JSON schema
          strict?: boolean | null
        }
      }
  seed?: number | null
  service_tier?: string | null
  stop?: string | Array<unknown> | null
  stream?: boolean | null
  stream_options?: { include_usage?: boolean }
  temperature?: number | null
  top_p?: number | null
  tools?: Array<Tool>
  tool_choices?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: 'string' } }
  parallel_tool_calls?: boolean
  user?: string
}

export type TopLogprob = { token: string; logprob: number; bytes: Array<number> | null }
export type Logprob = {
  token: string
  logprob: number
  bytes: Array<number> | null
  top_logprobs: Array<TopLogprob>
}

export type ChatCompletionFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls'

export type ChatCompletionChoice = {
  index: number
  message: {
    role: string
    content: string | null
    refusal: string | null
    tool_calls?: Array<ToolCall>
    audio?: { id: string; expires_at: number; data: string; transcript: string }
  }
  finish_reason: ChatCompletionFinishReason
  logprobs?: {
    content: Array<Logprob> | null
    refusal: Array<Logprob> | null
  }
}

export type ChatUsageStats = {
  completion_tokens: number
  prompt_tokens: number
  total_tokens: number
  completion_tokens_details: {
    accepted_prediction_tokens: number
    audio_tokens: number
    reasoning_tokens: number
    rejected_prediction_tokens: number
  }
  prompt_tokens_details: {
    audio_tokens: number
    cached_tokens: number
  }
}

export type ChatCompletion = {
  object: 'chat.completion'
  id: string
  model: string
  choices: Array<ChatCompletionChoice>
  created: number // Unix timestamp in seconds
  service_tier?: string | null
  system_fingerprint: string
  usage: ChatUsageStats
}

export type ChatCompletionChunkChoice = {
  index: number
  delta: {
    role: string
    content: string | null
    refusal: string | null
    tool_calls?: Array<ToolCall & { index: number }>
  }
  logprobs?: {
    content: Array<Logprob> | null
    refusal: Array<Logprob> | null
  }
  finish_reason: string | null
}

export type ChatCompletionChunk = {
  object: 'chat.completion.chunk'
  id: string
  model: string
  choices: Array<ChatCompletionChunkChoice>
  created: number // Unix timestamp in seconds
  service_tier?: string | null
  system_fingerprint: string
  usage?: ChatUsageStats | null
}

export type OpenAIClientParams = {
  apiKey: string
  baseURL?: string
}

export class OpenAIClient {
  #api: KyInstance

  constructor(params: OpenAIClientParams) {
    this.#api = ky.create({
      prefixUrl: params.baseURL ?? 'https://api.openai.com/v1',
      headers: { Authorization: `Bearer ${params.apiKey}` },
    })
  }

  async listModels(): Promise<Array<Model>> {
    const res = await this.#api.get<ListModelsResponse>('models').json()
    return res.data
  }

  chat(params: ChatParams & { stream?: false | null }): SingleReplyRequest<ChatCompletion>
  chat(params: ChatParams & { stream: true }): StreamReplyRequest<ChatCompletionChunk | null>
  chat(params: ChatParams) {
    const controller = new AbortController()
    const request = this.#api.post('chat/completions', {
      json: params,
      signal: controller.signal,
    })
    const response = params.stream
      ? toResponseStream<ChatCompletionChunk>(request)
      : request.json<ChatCompletion>()
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
  }
}

export type OpenAITypes = {
  Message: Message
  MessagePart: ChatCompletionChunk
  Model: Model
  Tool: Tool
  ToolCall: ToolCall
}

export type OpenAIProviderParams = {
  client: OpenAIClient | OpenAIClientParams
}

export class OpenAIProvider implements ModelProvider<OpenAITypes> {
  #client: OpenAIClient

  constructor(params: OpenAIProviderParams) {
    this.#client =
      params.client instanceof OpenAIClient ? params.client : new OpenAIClient(params.client)
  }

  async listModels() {
    const models = await this.#client.listModels()
    return models.map((model) => ({ id: model.id, raw: model }))
  }

  aggregateMessage(
    parts: Array<ServerMessage<ChatCompletionChunk, ToolCall>>,
  ): AggregatedMessage<ToolCall> {
    let text = ''
    let toolCalls: Array<FunctionToolCall<ToolCall>> = []
    for (const part of parts) {
      if (part.text != null) {
        text += part.text
      }
      if (part.toolCalls != null) {
        toolCalls = toolCalls.concat(part.toolCalls)
      }
    }
    return { source: 'aggregated', role: 'assistant', text, toolCalls }
  }

  streamChat(params: StreamChatParams<Message, ToolCall, Tool>) {
    const request = this.#client.chat({
      messages: params.messages.map((msg) => {
        switch (msg.source) {
          case 'aggregated':
            return {
              role: 'assistant',
              content: msg.text,
              tool_calls: msg.toolCalls.map((c) => c.raw),
            }
          case 'client':
            return msg.role === 'tool'
              ? { role: 'tool', tool_call_id: msg.toolCallID, content: msg.text }
              : { role: msg.role, content: msg.text }
          case 'server':
            return msg.raw
        }
      }),
      model: params.model,
      stream: true,
      tools: params.tools,
    })
    const response = request.then((stream) => {
      let isDone = false
      return stream.pipeThrough(
        new TransformStream<ChatCompletionChunk | null, MessagePart<ChatCompletionChunk, ToolCall>>(
          {
            transform(part, controller) {
              if (part === null) {
                if (!isDone) {
                  isDone = true
                  controller.enqueue({ type: 'done' })
                }
              } else {
                const choice = part.choices[0]
                if (choice.delta.content != null && choice.delta.content !== '') {
                  controller.enqueue({ type: 'text-delta', text: choice.delta.content, raw: part })
                }
                if (choice.delta.tool_calls != null) {
                  controller.enqueue({
                    type: 'tool-call',
                    toolCalls: choice.delta.tool_calls.map((call) => {
                      return {
                        name: call.function.name,
                        input: tryParseJSON(call.function.arguments),
                        id: call.id,
                        raw: call,
                      }
                    }),
                    raw: part,
                  })
                }
                if (choice.finish_reason != null) {
                  isDone = true
                  controller.enqueue({ type: 'done', reason: choice.finish_reason })
                }
              }
            },
          },
        ),
      )
    })
    return Object.assign(response, { abort: request.abort, signal: request.signal })
  }

  toolFromMCP(tool: ContextTool): Tool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }
  }
}
