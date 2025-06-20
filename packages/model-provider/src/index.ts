/**
 * Mokei model provider.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/model-provider
 * ```
 *
 * @module model-provider
 */

import { asType, createValidator, type Validator } from '@enkaku/schema'
import type { Tool } from '@mokei/context-protocol'

const objectValidator = createValidator({ type: 'object' })

export function tryParseJSON<T = Record<string, unknown>>(
  value: unknown,
  validator: Validator<T> = objectValidator as Validator<T>,
): T {
  let parsedValue: unknown
  if (typeof value === 'string') {
    try {
      parsedValue = JSON.parse(value)
    } catch {
      throw new Error(`Failed to parse JSON string: ${value}`)
    }
  } else {
    parsedValue = value
  }
  return asType(validator, parsedValue)
}

export type Model<Raw> = {
  id: string
  raw: Raw
}

export type FunctionToolCall<Raw> = {
  name: string
  id: string
  arguments: string
  raw: Raw
}

export type ClientTextMessage = {
  source: 'client'
  role: 'system' | 'user'
  text: string
}

export type ClientToolMessage = {
  source: 'client'
  role: 'tool'
  toolCallID: string
  toolCallName: string
  text: string
}

export type ClientMessage = ClientTextMessage | ClientToolMessage

export type ServerMessage<RawMessage, RawToolCall> = {
  source: 'server'
  role: 'assistant'
  text?: string
  reasoning?: string
  toolCalls?: Array<FunctionToolCall<RawToolCall>>
  inputTokens?: number
  outputTokens?: number
  raw: RawMessage
}

export type AggregatedMessage<RawToolCall> = {
  source: 'aggregated'
  role: 'assistant'
  text: string
  toolCalls: Array<FunctionToolCall<RawToolCall>>
  reasoning?: string
  inputTokens: number
  outputTokens: number
}

export type Message<RawMessage, RawToolCall> =
  | ClientMessage
  | ServerMessage<RawMessage, RawToolCall>
  | AggregatedMessage<RawToolCall>

export type MessagePart<RawMessagePart, RawToolCall> =
  | { type: 'text-delta'; raw: RawMessagePart; text: string; role?: string }
  | { type: 'reasoning-delta'; raw: RawMessagePart; reasoning: string; role?: string }
  | {
      type: 'tool-call'
      raw: RawMessagePart
      toolCalls: Array<FunctionToolCall<RawToolCall>>
      role?: string
    }
  | { type: 'unsupported'; raw: RawMessagePart }
  | {
      type: 'done'
      raw?: RawMessagePart
      reason?: string
      inputTokens: number
      outputTokens: number
    }
  | { type: 'error'; raw?: RawMessagePart; error: unknown }

export type MessageAggregate<RawMessage, RawToolCall, State> = {
  message: Message<RawMessage, RawToolCall>
  state: State
}

export type RequestParams = {
  signal?: AbortSignal
}

export type EmbedParams = RequestParams & {
  model: string
  input: string | Array<string>
}

export type EmbedResponse = {
  embeddings: Array<Array<number>>
}

export type SingleReplyRequest<T> = AbortController & Promise<T>
export type StreamReplyRequest<T> = AbortController & Promise<ReadableStream<T>>
export type AnyReplyRequest<T> = SingleReplyRequest<T> | StreamReplyRequest<T>

export type StreamChatParams<RawMessage, RawToolCall, RawTool> = RequestParams & {
  model: string
  messages: Array<Message<RawMessage, RawToolCall>>
  tools?: Array<RawTool>
}

export type StreamChatResponse<RawMessagePart, RawToolCall> = ReadableStream<
  MessagePart<RawMessagePart, RawToolCall>
>

export type StreamChatRequest<RawMessagePart, RawToolCall> = AbortController &
  Promise<StreamChatResponse<RawMessagePart, RawToolCall>>

export type ProviderTypes = {
  Message: unknown
  MessagePart: unknown
  Model: unknown
  Tool: unknown
  ToolCall: unknown
}

export type ModelProvider<T extends ProviderTypes> = {
  aggregateMessage: (
    parts: Array<ServerMessage<T['MessagePart'], T['ToolCall']>>,
  ) => AggregatedMessage<T['ToolCall']>
  embed: (params: EmbedParams) => Promise<EmbedResponse>
  listModels: (params?: RequestParams) => Promise<Array<Model<T['Model']>>>
  streamChat: (
    params: StreamChatParams<T['Message'], T['ToolCall'], T['Tool']>,
  ) => StreamChatRequest<T['MessagePart'], T['ToolCall']>
  toolFromMCP(tool: Tool): T['Tool']
}
