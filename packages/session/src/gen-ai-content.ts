import type { Tool } from '@mokei/context-protocol'
import type { FunctionToolCall, Message } from '@mokei/model-provider'

/** Message part shapes of the GenAI semantic conventions content attributes. */
export type GenAIPart =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown }
  | { type: 'tool_call_response'; id: string; response: unknown }

export type GenAIMessage = {
  role: 'user' | 'assistant' | 'tool'
  parts: Array<GenAIPart>
}

export type GenAIOutputMessage = GenAIMessage & { finish_reason: string }

export type GenAIToolDefinition = {
  type: 'function'
  name: string
  description?: string
  parameters: Tool['inputSchema']
}

export type OutputContent = {
  text?: string
  reasoning?: string
  toolCalls?: Array<FunctionToolCall<unknown>>
}

// Parsed so redaction reaches secrets inside the arguments object.
function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function assistantParts(content: OutputContent): Array<GenAIPart> {
  const parts: Array<GenAIPart> = []
  if (content.reasoning) parts.push({ type: 'reasoning', content: content.reasoning })
  if (content.text) parts.push({ type: 'text', content: content.text })
  for (const call of content.toolCalls ?? []) {
    parts.push({
      type: 'tool_call',
      id: call.id,
      name: call.name,
      arguments: parseArguments(call.arguments),
    })
  }
  return parts
}

/** Conversation history without system messages, which go to `gen_ai.system_instructions`. */
export function toInputMessages<M, C>(messages: Array<Message<M, C>>): Array<GenAIMessage> {
  const result: Array<GenAIMessage> = []
  for (const message of messages) {
    if (message.source !== 'client') {
      result.push({ role: 'assistant', parts: assistantParts(message) })
    } else if (message.role === 'user') {
      result.push({ role: 'user', parts: [{ type: 'text', content: message.text }] })
    } else if (message.role === 'tool') {
      result.push({
        role: 'tool',
        parts: [{ type: 'tool_call_response', id: message.toolCallID, response: message.text }],
      })
    }
  }
  return result
}

export function toSystemInstructions<M, C>(
  messages: Array<Message<M, C>>,
): Array<GenAIPart> | undefined {
  const parts: Array<GenAIPart> = []
  for (const message of messages) {
    if (message.source === 'client' && message.role === 'system') {
      parts.push({ type: 'text', content: message.text })
    }
  }
  return parts.length === 0 ? undefined : parts
}

export function toOutputMessages(
  aggregated: OutputContent,
  finishReason: string,
): Array<GenAIOutputMessage> {
  return [{ role: 'assistant', parts: assistantParts(aggregated), finish_reason: finishReason }]
}

export function toToolDefinitions(tools: Array<Tool>): Array<GenAIToolDefinition> {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }))
}
