import { Disposer } from '@enkaku/async'
import { EventEmitter } from '@enkaku/event'
import { fromStream } from '@enkaku/generator'
import type { CallToolResult } from '@mokei/context-protocol'
import { getContextToolInfo } from '@mokei/host'
import type {
  ClientToolMessage,
  FunctionToolCall,
  Message,
  ModelProvider,
  ProviderTypes,
  ServerMessage,
} from '@mokei/model-provider'
import { tryParseJSON } from '@mokei/model-provider'

import {
  AGENT_DEFAULTS,
  type AgentCompleteEvent,
  type AgentEvent,
  type AgentFinishReason,
  type AgentParams,
  type AgentResult,
  type AgentToolCallRecord,
  type ResolvedAgentParams,
  type ToolApprovalContext,
  type ToolApprovalFn,
  type ToolApprovalStrategy,
} from './agent-types.js'

/**
 * Events emitted by AgentSession.
 */
export type AgentSessionEvents = {
  event: AgentEvent
}

/**
 * AgentSession provides an automatic agent loop that handles
 * chat completion, tool calling, and iteration until completion.
 *
 * @example
 * ```typescript
 * const agent = new AgentSession({
 *   provider: openaiProvider,
 *   model: 'gpt-4',
 *   host: contextHost,
 *   toolApproval: 'auto',
 * })
 *
 * // Run to completion
 * const result = await agent.run('Create a users table')
 *
 * // Or stream events
 * for await (const event of agent.stream('Create a users table')) {
 *   console.log(event.type, event)
 * }
 * ```
 */
export class AgentSession<T extends ProviderTypes = ProviderTypes> extends Disposer {
  #params: ResolvedAgentParams<T>
  #events: EventEmitter<AgentSessionEvents>
  #providers: Map<string, ModelProvider<T>>

  constructor(params: AgentParams<T>, providers?: Map<string, ModelProvider<T>>) {
    super()
    this.#events = new EventEmitter()
    this.#providers = providers ?? new Map()

    // Resolve provider
    let provider: ModelProvider<T>
    if (typeof params.provider === 'string') {
      const p = this.#providers.get(params.provider)
      if (p == null) {
        throw new Error(`Provider "${params.provider}" not found`)
      }
      provider = p
    } else {
      provider = params.provider
    }

    this.#params = {
      provider,
      model: params.model,
      host: params.host,
      systemPrompt: params.systemPrompt,
      toolApproval: params.toolApproval ?? AGENT_DEFAULTS.toolApproval,
      maxIterations: params.maxIterations ?? AGENT_DEFAULTS.maxIterations,
      timeout: params.timeout ?? AGENT_DEFAULTS.timeout,
      onEvent: params.onEvent,
    }
  }

  /**
   * Event emitter for subscribing to agent events.
   */
  get events(): EventEmitter<AgentSessionEvents> {
    return this.#events
  }

  /**
   * Run the agent to completion with the given prompt.
   *
   * @param prompt - The user prompt to process
   * @param signal - Optional AbortSignal for cancellation
   * @returns The final result of agent execution
   */
  async run(prompt: string, signal?: AbortSignal): Promise<AgentResult> {
    let result: AgentResult | undefined

    for await (const event of this.stream(prompt, signal)) {
      if (event.type === 'complete') {
        result = event.result
      }
    }

    if (result == null) {
      throw new Error('Agent stream ended without completion')
    }

    return result
  }

  /**
   * Stream agent execution events.
   *
   * @param prompt - The user prompt to process
   * @param signal - Optional AbortSignal for cancellation
   * @yields AgentEvent for each stage of execution
   */
  async *stream(prompt: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const startTime = Date.now()
    const { provider, model, host, systemPrompt, toolApproval, maxIterations, timeout, onEvent } =
      this.#params

    // Set up timeout
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), timeout)

    // Combine signals
    const combinedSignal = signal
      ? anySignal([signal, timeoutController.signal])
      : timeoutController.signal

    const emitEvent = (event: AgentEvent): AgentEvent => {
      this.#events.emit('event', event)
      onEvent?.(event)
      return event
    }

    try {
      // Emit start event
      yield emitEvent({
        type: 'start',
        prompt,
        timestamp: Date.now(),
      })

      // Build initial messages
      const messages: Array<Message<T['MessagePart'], T['ToolCall']>> = []
      if (systemPrompt) {
        messages.push({ source: 'client', role: 'system', text: systemPrompt })
      }
      messages.push({ source: 'client', role: 'user', text: prompt })

      // Get tools from host
      const tools = host.getCallableTools().map((tool) => provider.toolFromMCP(tool))

      // Tracking
      const eventHistory: Array<AgentEvent> = []
      const allToolCalls: Array<AgentToolCallRecord> = []
      let totalInputTokens = 0
      let totalOutputTokens = 0
      let iteration = 0
      let currentText = ''
      let finishReason: AgentFinishReason = 'complete'

      // Agent loop
      while (iteration < maxIterations) {
        // Check for abort
        if (combinedSignal.aborted) {
          if (timeoutController.signal.aborted) {
            yield emitEvent({ type: 'timeout', timestamp: Date.now() })
            finishReason = 'timeout'
          } else {
            finishReason = 'aborted'
          }
          break
        }

        iteration++

        // Emit iteration start
        const iterStartEvent = emitEvent({
          type: 'iteration-start',
          iteration,
          timestamp: Date.now(),
        })
        yield iterStartEvent
        eventHistory.push(iterStartEvent)

        // Call the model
        const request = provider.streamChat({ model, messages, tools, signal: combinedSignal })
        const stream = await request

        // Collect response parts
        const responseParts: Array<ServerMessage<T['MessagePart'], T['ToolCall']>> = []
        let iterationText = ''

        for await (const chunk of fromStream(stream)) {
          if (chunk.type === 'text-delta') {
            iterationText += chunk.text
            const textEvent = emitEvent({
              type: 'text-delta',
              text: chunk.text,
              timestamp: Date.now(),
            })
            yield textEvent
            eventHistory.push(textEvent)
            responseParts.push({
              source: 'server',
              role: 'assistant',
              text: chunk.text,
              raw: chunk.raw,
            })
          } else if (chunk.type === 'tool-call') {
            responseParts.push({
              source: 'server',
              role: 'assistant',
              toolCalls: chunk.toolCalls,
              raw: chunk.raw,
            })
          } else if (chunk.type === 'done') {
            totalInputTokens += chunk.inputTokens
            totalOutputTokens += chunk.outputTokens
            responseParts.push({
              source: 'server',
              role: 'assistant',
              inputTokens: chunk.inputTokens,
              outputTokens: chunk.outputTokens,
              raw: chunk.raw,
            })
          } else if (chunk.type === 'error') {
            throw chunk.error
          }
        }

        // Aggregate response
        const aggregated = provider.aggregateMessage(responseParts)
        currentText = aggregated.text || currentText

        // Emit text complete if we got text
        if (iterationText) {
          const textCompleteEvent = emitEvent({
            type: 'text-complete',
            text: iterationText,
            timestamp: Date.now(),
          })
          yield textCompleteEvent
          eventHistory.push(textCompleteEvent)
        }

        // Add assistant message to history
        messages.push(aggregated)

        // Check for tool calls
        const toolCalls = aggregated.toolCalls
        const hasToolCalls = toolCalls.length > 0

        // Emit iteration complete
        const iterCompleteEvent = emitEvent({
          type: 'iteration-complete',
          iteration,
          hasToolCalls,
          timestamp: Date.now(),
        })
        yield iterCompleteEvent
        eventHistory.push(iterCompleteEvent)

        // If no tool calls, we're done
        if (!hasToolCalls) {
          finishReason = 'complete'
          break
        }

        // Process tool calls
        const toolMessages: Array<ClientToolMessage> = []

        for (const toolCall of toolCalls) {
          // Handle approval
          const approvalResult = await this.#handleToolApproval(
            toolCall,
            toolApproval,
            { iteration, history: eventHistory, tool: this.#findTool(toolCall.name) },
            emitEvent,
          )

          for (const event of approvalResult.events) {
            yield event
            eventHistory.push(event)
          }

          const record: AgentToolCallRecord = {
            call: toolCall,
            approved: approvalResult.approved,
            denialReason: approvalResult.reason,
          }

          if (!approvalResult.approved) {
            // Tool denied - add error message
            toolMessages.push({
              source: 'client',
              role: 'tool',
              toolCallID: toolCall.id,
              toolCallName: toolCall.name,
              text: JSON.stringify({
                error: approvalResult.reason ?? 'Tool call denied',
              }),
            })
          } else {
            // Execute tool
            const execResult = await this.#executeToolCall(toolCall, emitEvent, combinedSignal)

            for (const event of execResult.events) {
              yield event
              eventHistory.push(event)
            }

            record.result = execResult.result
            record.error = execResult.error

            // Add result message
            const resultText =
              execResult.error != null
                ? JSON.stringify({ error: execResult.error.message })
                : (execResult.result?.content.find((c) => c.type === 'text')?.text ??
                  JSON.stringify(execResult.result?.content))

            toolMessages.push({
              source: 'client',
              role: 'tool',
              toolCallID: toolCall.id,
              toolCallName: toolCall.name,
              text: resultText,
            })
          }

          allToolCalls.push(record)
        }

        // Add tool messages to conversation
        messages.push(...toolMessages)
      }

      // Check if we hit max iterations
      if (iteration >= maxIterations && finishReason === 'complete') {
        const maxIterEvent = emitEvent({
          type: 'max-iterations',
          iteration,
          timestamp: Date.now(),
        })
        yield maxIterEvent
        eventHistory.push(maxIterEvent)
        finishReason = 'max-iterations'
      }

      // Build final result
      const result: AgentResult = {
        text: currentText,
        iterations: iteration,
        toolCalls: allToolCalls,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        duration: Date.now() - startTime,
        finishReason,
      }

      // Emit complete event
      const completeEvent: AgentCompleteEvent = {
        type: 'complete',
        result,
        timestamp: Date.now(),
      }
      yield emitEvent(completeEvent)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      yield emitEvent({
        type: 'error',
        error: err,
        timestamp: Date.now(),
      })
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
  }

  #findTool(namespacedName: string) {
    try {
      const [contextKey, toolName] = getContextToolInfo(namespacedName)
      const context = this.#params.host.getContext(contextKey)
      return context.tools.find((t) => t.tool.name === toolName)
    } catch {
      return undefined
    }
  }

  async #handleToolApproval(
    toolCall: FunctionToolCall<unknown>,
    strategy: ToolApprovalStrategy,
    context: ToolApprovalContext,
    emitEvent: (event: AgentEvent) => AgentEvent,
  ): Promise<{ approved: boolean; reason?: string; events: Array<AgentEvent> }> {
    const events: Array<AgentEvent> = []

    if (strategy === 'auto') {
      const event = emitEvent({
        type: 'tool-call-approved',
        toolCall,
        timestamp: Date.now(),
      })
      events.push(event)
      return { approved: true, events }
    }

    if (strategy === 'never') {
      const event = emitEvent({
        type: 'tool-call-denied',
        toolCall,
        reason: 'Tool execution disabled',
        timestamp: Date.now(),
      })
      events.push(event)
      return { approved: false, reason: 'Tool execution disabled', events }
    }

    if (strategy === 'ask') {
      // Emit pending event - external code should handle approval
      // For now, we auto-approve since we don't have async approval mechanism
      const pendingEvent = emitEvent({
        type: 'tool-call-pending',
        toolCall,
        timestamp: Date.now(),
      })
      events.push(pendingEvent)

      // Note: In a full implementation, this would wait for external approval
      // For now, we auto-approve after emitting pending
      const approvedEvent = emitEvent({
        type: 'tool-call-approved',
        toolCall,
        timestamp: Date.now(),
      })
      events.push(approvedEvent)
      return { approved: true, events }
    }

    // Custom function
    const fn = strategy as ToolApprovalFn
    const result = await fn(toolCall, context)

    let approved: boolean
    let reason: string | undefined

    if (typeof result === 'boolean') {
      approved = result
    } else {
      approved = result.approved
      reason = result.reason
    }

    if (approved) {
      const event = emitEvent({
        type: 'tool-call-approved',
        toolCall,
        timestamp: Date.now(),
      })
      events.push(event)
    } else {
      const event = emitEvent({
        type: 'tool-call-denied',
        toolCall,
        reason,
        timestamp: Date.now(),
      })
      events.push(event)
    }

    return { approved, reason, events }
  }

  async #executeToolCall(
    toolCall: FunctionToolCall<unknown>,
    emitEvent: (event: AgentEvent) => AgentEvent,
    signal: AbortSignal,
  ): Promise<{ result?: CallToolResult; error?: Error; events: Array<AgentEvent> }> {
    const events: Array<AgentEvent> = []

    // Emit start event
    const startEvent = emitEvent({
      type: 'tool-call-start',
      toolCall,
      timestamp: Date.now(),
    })
    events.push(startEvent)

    try {
      // Parse tool name to get context and tool
      const [contextKey, toolName] = getContextToolInfo(toolCall.name)
      const args = tryParseJSON(toolCall.arguments)

      // Execute via host
      const request = this.#params.host.callTool(contextKey, { name: toolName, arguments: args })

      // Handle abort
      if (signal.aborted) {
        request.cancel()
        throw new Error('Aborted')
      }
      signal.addEventListener('abort', () => request.cancel(), { once: true })

      const result = await request

      // Emit complete event
      const completeEvent = emitEvent({
        type: 'tool-call-complete',
        toolCall,
        result,
        timestamp: Date.now(),
      })
      events.push(completeEvent)

      return { result, events }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      // Emit error event
      const errorEvent = emitEvent({
        type: 'tool-call-error',
        toolCall,
        error: err,
        timestamp: Date.now(),
      })
      events.push(errorEvent)

      return { error: err, events }
    }
  }
}

/**
 * Combine multiple AbortSignals into one.
 */
function anySignal(signals: Array<AbortSignal>): AbortSignal {
  const controller = new AbortController()

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }

  return controller.signal
}
