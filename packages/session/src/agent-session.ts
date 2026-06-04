import { Disposer } from '@enkaku/async'
import { EventEmitter } from '@enkaku/event'
import type { CallToolResult } from '@mokei/context-protocol'
import { getContextToolInfo } from '@mokei/host'
import type {
  ClientToolMessage,
  FunctionToolCall,
  Message,
  ProviderTypes,
} from '@mokei/model-provider'

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
import { ToolCallCancelledError, ToolCallTimeoutError } from './errors.js'

/** Abort reason set when the per-tool timeout timer fires. */
const TOOL_TIMEOUT_REASON = Symbol('mokei.tool-timeout')
/** Abort reason set when the user cancels the active tool call. */
const TOOL_CANCEL_REASON = Symbol('mokei.tool-cancel')

/**
 * Events emitted by AgentSession.
 */
export type AgentSessionEvents<T extends ProviderTypes = ProviderTypes> = {
  event: AgentEvent<T>
}

/**
 * AgentSession provides an automatic agent loop that handles
 * chat completion, tool calling, and iteration until completion.
 *
 * @example
 * ```typescript
 * const session = new Session({ providers: { openai: openaiProvider } })
 * await session.addContext({ key: 'db', command: 'mcp-sqlite' })
 *
 * const agent = new AgentSession({
 *   session,
 *   provider: 'openai',
 *   model: 'gpt-4',
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
  #events: EventEmitter<AgentSessionEvents<T>>
  #activeToolController: AbortController | null = null

  constructor(params: AgentParams<T>) {
    super()
    this.#events = new EventEmitter()

    const { session } = params

    // Resolve provider from session or use direct instance
    const provider =
      typeof params.provider === 'string'
        ? session.getProvider<T>(params.provider)
        : params.provider

    this.#params = {
      session,
      provider,
      model: params.model,
      systemPrompt: params.systemPrompt,
      toolApproval: params.toolApproval ?? AGENT_DEFAULTS.toolApproval,
      maxIterations: params.maxIterations ?? AGENT_DEFAULTS.maxIterations,
      timeout: params.timeout ?? AGENT_DEFAULTS.timeout,
      toolTimeout: params.toolTimeout ?? AGENT_DEFAULTS.toolTimeout,
      onEvent: params.onEvent,
    }
  }

  /**
   * Event emitter for subscribing to agent events.
   */
  get events(): EventEmitter<AgentSessionEvents<T>> {
    return this.#events
  }

  /**
   * Cancel the tool call currently being executed, if any. The current turn
   * continues with the remaining tool calls / iterations. No-op when idle.
   */
  cancelToolCall(): void {
    this.#activeToolController?.abort(TOOL_CANCEL_REASON)
  }

  /**
   * Run the agent to completion with the given prompt.
   *
   * @param prompt - The user prompt to process
   * @param opts - Optional prior messages and AbortSignal for cancellation
   * @returns The final result of agent execution
   */
  async run(
    prompt: string,
    opts: { messages?: Array<Message<T['MessagePart'], T['ToolCall']>>; signal?: AbortSignal } = {},
  ): Promise<AgentResult<T>> {
    let result: AgentResult<T> | undefined

    for await (const event of this.stream(prompt, opts)) {
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
   * @param opts - Optional prior messages and AbortSignal for cancellation
   * @yields AgentEvent for each stage of execution
   */
  async *stream(
    prompt: string,
    opts: { messages?: Array<Message<T['MessagePart'], T['ToolCall']>>; signal?: AbortSignal } = {},
  ): AsyncGenerator<AgentEvent<T>> {
    const { messages: priorMessages, signal } = opts
    const startTime = Date.now()
    const {
      session,
      provider,
      model,
      systemPrompt,
      toolApproval,
      maxIterations,
      timeout,
      onEvent,
    } = this.#params

    // Set up timeout
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), timeout)

    // Combine signals
    const combinedSignal = signal
      ? anySignal([signal, timeoutController.signal])
      : timeoutController.signal

    const emitEvent = (event: AgentEvent<T>): AgentEvent<T> => {
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
      if (priorMessages != null && priorMessages.length > 0) {
        const hasSystem = priorMessages.some((m) => m.role === 'system')
        if (systemPrompt && !hasSystem) {
          messages.push({ source: 'client', role: 'system', text: systemPrompt })
        }
        messages.push(...priorMessages)
      } else if (systemPrompt) {
        messages.push({ source: 'client', role: 'system', text: systemPrompt })
      }
      messages.push({ source: 'client', role: 'user', text: prompt })

      // Get tools from session
      const tools = session.getToolsForProvider(provider)

      // Tracking
      const eventHistory: Array<AgentEvent<T>> = []
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

        // Call the model via session's streamChatTurn
        let iterationText = ''
        const chatTurn = session.streamChatTurn({
          provider,
          model,
          messages,
          tools,
          signal: combinedSignal,
        })

        // Iterate through chunks, yielding text events in real-time.
        // Check the abort signal between chunks: aborting the signal does not
        // reliably interrupt an actively-streaming provider response (the stream
        // keeps yielding buffered chunks), so the loop must stop on its own and
        // close the stream rather than wait for it to end. The throw is handled
        // by the catch below, which emits the timeout/error event.
        let result = await chatTurn.next()
        while (!result.done) {
          if (combinedSignal.aborted) {
            // Close the provider stream (releases the reader / HTTP connection).
            // `never` satisfies the generator's TReturn without a real value.
            await chatTurn.return(undefined as never)
            throw combinedSignal.reason instanceof Error
              ? combinedSignal.reason
              : new Error('Aborted')
          }
          const chunk = result.value
          if (chunk.type === 'text-delta') {
            iterationText += chunk.text
            const textEvent = emitEvent({
              type: 'text-delta',
              text: chunk.text,
              timestamp: Date.now(),
            })
            yield textEvent
            eventHistory.push(textEvent)
          } else if (chunk.type === 'done') {
            totalInputTokens += chunk.inputTokens
            totalOutputTokens += chunk.outputTokens
          }
          result = await chatTurn.next()
        }

        // Get aggregated message from generator return value
        const aggregated = result.value
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
      const result: AgentResult<T> = {
        text: currentText,
        messages,
        iterations: iteration,
        toolCalls: allToolCalls,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        duration: Date.now() - startTime,
        finishReason,
      }

      // Emit complete event
      const completeEvent: AgentCompleteEvent<T> = {
        type: 'complete',
        result,
        timestamp: Date.now(),
      }
      yield emitEvent(completeEvent)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      if (timeoutController.signal.aborted) {
        yield emitEvent({ type: 'timeout', timestamp: Date.now() })
      } else {
        yield emitEvent({
          type: 'error',
          error: err,
          timestamp: Date.now(),
        })
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
  }

  #findTool(namespacedName: string) {
    try {
      const [contextKey, toolName] = getContextToolInfo(namespacedName)
      const context = this.#params.session.contextHost.getContext(contextKey)
      return context.tools.find((t) => t.tool.name === toolName)
    } catch {
      return undefined
    }
  }

  async #handleToolApproval(
    toolCall: FunctionToolCall<unknown>,
    strategy: ToolApprovalStrategy,
    context: ToolApprovalContext,
    emitEvent: (event: AgentEvent<T>) => AgentEvent<T>,
  ): Promise<{ approved: boolean; reason?: string; events: Array<AgentEvent<T>> }> {
    const events: Array<AgentEvent<T>> = []

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
      // No async approval bridge wired — refuse so host does not execute a tool
      // the user never approved. Callers supply a ToolApprovalFn to interactively approve.
      const reason = 'Tool approval required but no handler configured'
      const pendingEvent = emitEvent({
        type: 'tool-call-pending',
        toolCall,
        timestamp: Date.now(),
      })
      events.push(pendingEvent)
      const deniedEvent = emitEvent({
        type: 'tool-call-denied',
        toolCall,
        reason,
        timestamp: Date.now(),
      })
      events.push(deniedEvent)
      return { approved: false, reason, events }
    }

    // Custom function
    const fn = strategy as ToolApprovalFn
    const pendingEvent = emitEvent({
      type: 'tool-call-pending',
      toolCall,
      timestamp: Date.now(),
    })
    events.push(pendingEvent)
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
    emitEvent: (event: AgentEvent<T>) => AgentEvent<T>,
    signal: AbortSignal,
  ): Promise<{ result?: CallToolResult; error?: Error; events: Array<AgentEvent<T>> }> {
    const events: Array<AgentEvent<T>> = []

    // Per-call controller: fires on timeout or user cancel, independent of the turn.
    // Set up BEFORE emitting tool-call-start so that cancelToolCall() called from
    // within a tool-call-start handler takes effect on the live controller.
    const callController = new AbortController()
    this.#activeToolController = callController
    // Forward a turn-level abort onto the per-call controller. The listener is
    // removed in `finally` so listeners don't accumulate on the turn signal
    // across many sequential tool calls.
    const onTurnAbort = () => {
      callController.abort(signal.reason)
    }
    // Declared here so `finally` can always clear it, even if emitting the
    // start event (which invokes a user `onEvent` callback) throws.
    let callTimer: ReturnType<typeof setTimeout> | undefined

    try {
      callTimer = setTimeout(() => {
        callController.abort(TOOL_TIMEOUT_REASON)
      }, this.#params.toolTimeout)

      // Emit start event
      const startEvent = emitEvent({
        type: 'tool-call-start',
        toolCall,
        timestamp: Date.now(),
      })
      events.push(startEvent)
      if (signal.aborted) {
        callController.abort(signal.reason)
      } else {
        signal.addEventListener('abort', onTurnAbort)
      }

      // Execute via session (handles namespaced tool parsing internally)
      const result = await this.#params.session.executeToolCall(toolCall, callController.signal)

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
      // Discriminate why the call ended. The turn-level signal taking priority
      // preserves user-abort / turn-timeout semantics (turn ends elsewhere).
      let err: Error
      if (signal.aborted) {
        err = error instanceof Error ? error : new Error(String(error))
      } else if (callController.signal.reason === TOOL_TIMEOUT_REASON) {
        err = new ToolCallTimeoutError(toolCall.name, this.#params.toolTimeout)
      } else if (callController.signal.reason === TOOL_CANCEL_REASON) {
        err = new ToolCallCancelledError(toolCall.name)
      } else {
        err = error instanceof Error ? error : new Error(String(error))
      }

      // Emit error event
      const errorEvent = emitEvent({
        type: 'tool-call-error',
        toolCall,
        error: err,
        timestamp: Date.now(),
      })
      events.push(errorEvent)

      return { error: err, events }
    } finally {
      clearTimeout(callTimer)
      signal.removeEventListener('abort', onTurnAbort)
      this.#activeToolController = null
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
