export type ModelDetails = {
  parent_model: string
  format: string
  family: string
  families: Array<string>
  parameter_size: string
  quantization_level: string
}

export type Model = {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details?: ModelDetails
}

export type ToolCallFunction = {
  name: string
  arguments: Record<string, unknown>
}

export type ToolCall = {
  function: ToolCallFunction
}

export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: Array<string>
  tool_calls?: Array<ToolCall>
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
