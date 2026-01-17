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

import {
  asType,
  createValidator,
  type FromSchema,
  type Schema,
  type Validator,
} from '@enkaku/schema'
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

/**
 * Issue from schema validation
 */
export type ValidationIssue = {
  message: string
  path?: ReadonlyArray<unknown>
}

/**
 * Validates a value against a JSON schema and returns the result
 */
export function validateWithSchema<S extends Schema, T = FromSchema<S>>(
  schema: S,
  value: unknown,
): StructuredValidationResult<T> {
  const validator = createValidator<S, T>(schema)
  const result = validator(value)
  if (result.issues == null) {
    return { success: true, data: result.value }
  }
  return {
    success: false,
    error: new StructuredOutputError(
      'Validation failed',
      result.issues.map((i) => ({ message: i.message, path: i.path as ReadonlyArray<unknown> })),
    ),
  }
}

/**
 * Error thrown when structured output validation fails
 */
export class StructuredOutputError extends Error {
  readonly issues: Array<ValidationIssue>

  constructor(message: string, issues: Array<ValidationIssue>) {
    super(message)
    this.name = 'StructuredOutputError'
    this.issues = issues
  }
}

/**
 * Result of structured output validation
 */
export type StructuredValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: StructuredOutputError }

/**
 * Parameters for requesting structured output from a model
 */
export type StructuredOutputParams<S extends Schema = Schema> = {
  /** JSON Schema defining the expected output structure */
  schema: S
  /** Name for the schema (used by some providers) */
  name?: string
  /** Description of what the output should contain */
  description?: string
  /** Whether to enforce strict schema adherence (default: true) */
  strict?: boolean
}

/**
 * Result containing both raw and validated structured output
 */
export type StructuredOutputResult<T> = {
  /** The validated and typed output data */
  data: T
  /** The raw JSON string from the model */
  raw: string
}

// Re-export schema types for convenience
export type { FromSchema, Schema }

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
  doneReason?: string
  inputTokens?: number
  outputTokens?: number
  raw: RawMessage
}

export type AggregatedMessage<RawToolCall, TStructured = unknown> = {
  source: 'aggregated'
  role: 'assistant'
  text: string
  reasoning?: string
  toolCalls: Array<FunctionToolCall<RawToolCall>>
  doneReason?: string
  inputTokens: number
  outputTokens: number
  /** Structured output result when output schema was provided */
  structured?: StructuredOutputResult<TStructured>
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
  /** Request structured output conforming to a JSON schema */
  output?: StructuredOutputParams
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
