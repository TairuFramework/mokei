import { assertType } from '@enkaku/schema'
import type { Tool as ContextTool } from '@mokei/context-protocol'
import type {
  AggregatedMessage,
  EmbedParams,
  FunctionToolCall,
  MessagePart,
  ModelProvider,
  RequestParams,
  ServerMessage,
  StreamChatParams,
} from '@mokei/model-provider'

import { AnthropicClient, type AnthropicClientParams } from './client.js'
import { type AnthropicConfiguration, validateConfiguration } from './config.js'
import type {
  ContentBlock,
  Message,
  Model,
  StreamEvent,
  Tool,
  ToolCall,
  ToolResultBlock,
  ToolUseBlock,
} from './types.js'

export type AnthropicTypes = {
  Message: Message
  MessagePart: StreamEvent
  Model: Model
  Tool: Tool
  ToolCall: ToolCall
}

export type AnthropicProviderParams = {
  client?: AnthropicClient | AnthropicClientParams
  /** Default max tokens for requests (default: 4096) */
  defaultMaxTokens?: number
}

export class AnthropicProvider implements ModelProvider<AnthropicTypes> {
  static fromConfig(config: AnthropicConfiguration): AnthropicProvider {
    assertType(validateConfiguration, config)
    return new AnthropicProvider({ client: new AnthropicClient(config) })
  }

  #client: AnthropicClient
  #defaultMaxTokens: number

  constructor(params: AnthropicProviderParams = {}) {
    this.#client =
      params.client instanceof AnthropicClient ? params.client : new AnthropicClient(params.client)
    this.#defaultMaxTokens = params.defaultMaxTokens ?? 4096
  }

  async listModels(params?: RequestParams) {
    const models = await this.#client.listModels(params)
    return models.map((model) => ({ id: model.id, raw: model }))
  }

  async embed(_params: EmbedParams): Promise<{ embeddings: Array<Array<number>> }> {
    // Anthropic doesn't have an embeddings API
    throw new Error(
      'Anthropic does not support embeddings. Use a different provider for embeddings.',
    )
  }

  aggregateMessage(
    parts: Array<ServerMessage<StreamEvent, ToolCall>>,
  ): AggregatedMessage<ToolCall> {
    let text = ''
    let reasoning = ''
    const toolCalls: Array<FunctionToolCall<ToolCall>> = []
    let doneReason: string | undefined
    let inputTokens = 0
    let outputTokens = 0

    for (const part of parts) {
      if (part.text != null) {
        text += part.text
      }
      if (part.reasoning != null) {
        reasoning += part.reasoning
      }
      if (part.toolCalls != null) {
        for (const toolCall of part.toolCalls) {
          // Find existing tool call or add new one
          const existing = toolCalls.find((tc) => tc.id === toolCall.id)
          if (existing) {
            // Append to arguments (for streaming JSON)
            existing.arguments += toolCall.arguments
          } else {
            toolCalls.push({ ...toolCall })
          }
        }
      }
      if (part.doneReason != null) {
        doneReason = part.doneReason
      }
      if (part.inputTokens != null) {
        inputTokens = part.inputTokens // Use latest value (not cumulative)
      }
      if (part.outputTokens != null) {
        outputTokens += part.outputTokens
      }
    }

    return {
      source: 'aggregated',
      role: 'assistant',
      text,
      reasoning: reasoning || undefined,
      toolCalls,
      doneReason,
      inputTokens,
      outputTokens,
    }
  }

  streamChat(params: StreamChatParams<Message, ToolCall, Tool>) {
    // Extract system message if present
    let systemPrompt: string | undefined
    const messages: Array<Message> = []

    for (const msg of params.messages) {
      if (msg.source === 'client') {
        if (msg.role === 'system') {
          systemPrompt = msg.text
        } else if (msg.role === 'user') {
          messages.push({ role: 'user', content: msg.text })
        } else if (msg.role === 'tool') {
          // Tool results need to be added to the previous assistant message
          // or as a user message with tool_result content
          const toolResult: ToolResultBlock = {
            type: 'tool_result',
            tool_use_id: msg.toolCallID,
            content: msg.text,
          }
          // Find last user message or create new one
          const lastMsg = messages[messages.length - 1]
          if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
            lastMsg.content.push(toolResult)
          } else {
            messages.push({ role: 'user', content: [toolResult] })
          }
        }
      } else if (msg.source === 'aggregated') {
        // Convert aggregated message to Anthropic format
        const content: Array<ContentBlock> = []
        if (msg.text) {
          content.push({ type: 'text', text: msg.text })
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments || '{}'),
          })
        }
        messages.push({ role: 'assistant', content })
      } else if (msg.source === 'server') {
        // Pass through raw server message
        messages.push(msg.raw)
      }
    }

    // Build tools list, potentially adding a structured output tool
    let tools = params.tools
    let toolChoice: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string } | undefined

    if (params.output) {
      // Create a tool for structured output
      const outputTool: Tool = {
        name: params.output.name ?? 'structured_response',
        description: params.output.description ?? 'Respond with structured output',
        input_schema: params.output.schema as Tool['input_schema'],
      }
      tools = [...(params.tools ?? []), outputTool]
      toolChoice = { type: 'tool', name: outputTool.name }
    }

    const request = this.#client.messages({
      messages,
      model: params.model,
      signal: params.signal,
      stream: true,
      tools,
      tool_choice: toolChoice,
      max_tokens: this.#defaultMaxTokens,
      system: systemPrompt,
    })

    // Track state for assembling tool calls
    let currentToolUse: ToolUseBlock | null = null
    let currentToolJson = ''

    const response = request.then((stream: ReadableStream<StreamEvent>) => {
      return stream.pipeThrough(
        new TransformStream<StreamEvent, MessagePart<StreamEvent, ToolCall>>({
          transform(event, controller) {
            switch (event.type) {
              case 'message_start':
                // Capture input tokens from message start
                controller.enqueue({
                  type: 'done',
                  inputTokens: event.message.usage.input_tokens,
                  outputTokens: 0,
                  raw: event,
                })
                break

              case 'content_block_start':
                if (event.content_block.type === 'tool_use') {
                  currentToolUse = event.content_block as ToolUseBlock
                  currentToolJson = ''
                }
                break

              case 'content_block_delta':
                if (event.delta.type === 'text_delta') {
                  controller.enqueue({
                    type: 'text-delta',
                    text: event.delta.text,
                    raw: event,
                  })
                } else if (event.delta.type === 'thinking_delta') {
                  controller.enqueue({
                    type: 'reasoning-delta',
                    reasoning: event.delta.thinking,
                    raw: event,
                  })
                } else if (event.delta.type === 'input_json_delta') {
                  currentToolJson += event.delta.partial_json
                }
                break

              case 'content_block_stop':
                if (currentToolUse != null) {
                  // Emit complete tool call
                  controller.enqueue({
                    type: 'tool-call',
                    toolCalls: [
                      {
                        id: currentToolUse.id,
                        name: currentToolUse.name,
                        arguments: currentToolJson || '{}',
                        raw: {
                          id: currentToolUse.id,
                          name: currentToolUse.name,
                          input: currentToolJson ? JSON.parse(currentToolJson) : {},
                        },
                      },
                    ],
                    raw: event,
                  })
                  currentToolUse = null
                  currentToolJson = ''
                }
                break

              case 'message_delta':
                controller.enqueue({
                  type: 'done',
                  reason: event.delta.stop_reason,
                  inputTokens: 0,
                  outputTokens: event.usage.output_tokens,
                  raw: event,
                })
                break

              case 'error':
                controller.enqueue({
                  type: 'error',
                  error: new Error(`${event.error.type}: ${event.error.message}`),
                  raw: event,
                })
                break

              // Ignore ping and message_stop events
              case 'ping':
              case 'message_stop':
                break
            }
          },
        }),
      )
    })

    return Object.assign(response, { abort: request.abort, signal: request.signal })
  }

  toolFromMCP(tool: ContextTool): Tool {
    return {
      name: tool.name,
      description: tool.description ?? '',
      input_schema: tool.inputSchema as Tool['input_schema'],
    }
  }
}
