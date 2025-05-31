export type Model = {
  id: string
  created: number
  owned_by: string
  object: string
}

export type Embedding = {
  index: number
  embedding: Array<number>
}

export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<ToolCall>
  tool_call_id?: string
}

export type ToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type Tool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ChatCompletionUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type ChatCompletionResponse = {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: Message
    finish_reason: string | null
  }>
  usage: ChatCompletionUsage
}

export type ChatCompletionChunk = {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: Partial<Message>
    finish_reason: string | null
  }>
  usage?: ChatCompletionUsage | null
}
