export type ToolCallFunction = {
  name: string
  arguments: Record<string, unknown>
}

export type ToolCall = {
  function: ToolCallFunction
}

export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_calls?: Array<ToolCall>
}

export type ToolFunction = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type Tool = {
  type: string
  function: ToolFunction
}

export type ModelInfo = {
  name: string
  path: string
}

export type ChatResponseChunk = {
  text?: string
  toolCalls?: Array<ToolCall>
  done: boolean
  inputTokens?: number
  outputTokens?: number
}
