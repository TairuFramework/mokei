/**
 * Anthropic API types
 */

export type Model = {
  id: string
  type: 'model'
  display_name: string
  created_at: string
}

/**
 * Content block types in Anthropic messages
 */
export type TextBlock = {
  type: 'text'
  text: string
}

export type ImageBlock = {
  type: 'image'
  source: {
    type: 'base64'
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    data: string
  }
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | Array<TextBlock | ImageBlock>
  is_error?: boolean
}

export type ThinkingBlock = {
  type: 'thinking'
  thinking: string
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock

/**
 * Message types
 */
export type MessageRole = 'user' | 'assistant'

export type Message = {
  role: MessageRole
  content: string | Array<ContentBlock>
}

/**
 * Tool definition for Anthropic
 */
export type Tool = {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: Array<string>
    [key: string]: unknown
  }
}

/**
 * Tool call representation (internal)
 */
export type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * Usage statistics
 */
export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

/**
 * Stop reason
 */
export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'

/**
 * Message response (non-streaming)
 */
export type MessageResponse = {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<ContentBlock>
  model: string
  stop_reason: StopReason | null
  stop_sequence: string | null
  usage: Usage
}

/**
 * Streaming event types
 */
export type MessageStartEvent = {
  type: 'message_start'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    content: Array<never>
    model: string
    stop_reason: null
    stop_sequence: null
    usage: Usage
  }
}

export type ContentBlockStartEvent = {
  type: 'content_block_start'
  index: number
  content_block: ContentBlock
}

export type ContentBlockDeltaEvent = {
  type: 'content_block_delta'
  index: number
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
    | { type: 'thinking_delta'; thinking: string }
}

export type ContentBlockStopEvent = {
  type: 'content_block_stop'
  index: number
}

export type MessageDeltaEvent = {
  type: 'message_delta'
  delta: {
    stop_reason: StopReason
    stop_sequence: string | null
  }
  usage: {
    output_tokens: number
  }
}

export type MessageStopEvent = {
  type: 'message_stop'
}

export type PingEvent = {
  type: 'ping'
}

export type ErrorEvent = {
  type: 'error'
  error: {
    type: string
    message: string
  }
}

export type StreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | ErrorEvent
