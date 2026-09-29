import type { CallToolResult, ElicitResult } from '@mokei/context-protocol'
import {
  type ElicitFallback,
  getContextToolInfo,
  type HostElicitRequest,
  isLocalToolID,
} from '@mokei/host'
import type {
  ClientToolMessage,
  FunctionToolCall,
  Message,
  ProviderTypes,
} from '@mokei/model-provider'
import { Disposer } from '@sozai/async'
import { EventEmitter } from '@sozai/event'

import { AgentEventChannel } from './agent-event-channel.js'
import {
  AGENT_DEFAULTS,
  type AgentCompleteEvent,
  type AgentEvent,
  type AgentFinishReason,
  type AgentParams,
  type AgentResult,
  type AgentRunParams,
  type AgentToolCallRecord,
  type ResolvedAgentParams,
  type ToolApprovalContext,
  type ToolApprovalFn,
  type ToolApprovalStrategy,
} from './agent-types.js'
import { ToolCallCancelledError, ToolCallTimeoutError, UnknownToolError } from './errors.js'
import type { ChatTurn } from './session.js'

/** Abort reason set when the per-tool timeout timer fires. */
const TOOL_TIMEOUT_REASON = Symbol('mokei.tool-timeout')
/** Abort reason set when the user cancels the active tool call. */
const TOOL_CANCEL_REASON = Symbol('mokei.tool-cancel')
const TOOL_SETTLED_REASON = new Error('Tool call settled')

type AgentToolState = {
  key: string
  toolCall: FunctionToolCall<unknown>
  signal: AbortSignal
  controllers: Set<AbortController>
  settlements: Set<Promise<void>>
}

type AgentRunState<T extends ProviderTypes> = {
  channel: AgentEventChannel<T>
  signal: AbortSignal
  activeTool?: AgentToolState
}

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
 * const session = new NodeSession({ providers: { openai: openaiProvider } })
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
 * const result = await agent.run({ prompt: 'Create a users table' })
 *
 * // Or stream events
 * for await (const event of agent.stream({ prompt: 'Create a users table' })) {
 *   console.log(event.type, event)
 * }
 * ```
 */
export class AgentSession<T extends ProviderTypes = ProviderTypes> extends Disposer {
  #params: ResolvedAgentParams<T>
  #events: EventEmitter<AgentSessionEvents<T>>
  #activeToolController: AbortController | null = null
  #removeElicitation: (() => void) | undefined
  #nextElicitationID = 0
  #activeRuns = new Set<AgentRunState<T>>()

  constructor(params: AgentParams<T>) {
    super({ dispose: async () => this.#removeElicitation?.() })
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
      onElicitation: params.onElicitation,
    }

    if (session.contextHost.elicitationEnabled) {
      this.#removeElicitation = session.contextHost.handleElicitation((request, fallback) =>
        this.#handleElicitation(request, fallback),
      )
    } else if (params.onElicitation != null) {
      throw new Error('Elicitation is not enabled for this host')
    }
  }

  async #handleElicitation(
    request: HostElicitRequest,
    fallback: ElicitFallback,
  ): Promise<ElicitResult> {
    const requestID = String(++this.#nextElicitationID)
    const run = this.#activeRuns.size === 1 ? this.#activeRuns.values().next().value : undefined
    const activeTool = run?.activeTool?.key === request.key ? run.activeTool : undefined
    const toolCall = activeTool?.toolCall
    const attributedRun = toolCall == null ? undefined : run
    const attribution = toolCall == null ? {} : { toolCall }
    const controller = activeTool == null ? undefined : new AbortController()
    const signal = AbortSignal.any(
      activeTool == null || controller == null
        ? [request.signal, this.signal]
        : [request.signal, this.signal, activeTool.signal, controller.signal],
    )
    let settle: (() => void) | undefined
    let settlement: Promise<void> | undefined
    if (activeTool != null && controller != null) {
      settlement = new Promise<void>((resolve) => {
        settle = resolve
      })
      activeTool.controllers.add(controller)
      activeTool.settlements.add(settlement)
    }
    this.#emitElicitationEvent(
      {
        type: 'elicitation-request',
        requestID,
        key: request.key,
        params: request.params,
        ...attribution,
        timestamp: Date.now(),
      },
      attributedRun,
    )

    try {
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error('Aborted')
      }
      const result = this.#params.onElicitation
        ? this.#params.onElicitation({ ...request, signal, ...attribution })
        : fallback({ signal })
      const answer = await raceAbort(Promise.resolve(result), signal)
      this.#emitElicitationEvent(
        {
          type: 'elicitation-response',
          requestID,
          key: request.key,
          action: answer.action,
          ...attribution,
          timestamp: Date.now(),
        },
        attributedRun,
      )
      return answer
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.#emitElicitationEvent(
        {
          type: 'elicitation-error',
          requestID,
          key: request.key,
          error: err,
          ...attribution,
          timestamp: Date.now(),
        },
        attributedRun,
      )
      throw err
    } finally {
      if (controller != null) activeTool?.controllers.delete(controller)
      settle?.()
      if (settlement != null) activeTool?.settlements.delete(settlement)
    }
  }

  #emitElicitationEvent(event: AgentEvent<T>, run?: AgentRunState<T>): void {
    run?.channel.push(event)
    void this.#events.emit('event', event).catch(() => undefined)
    try {
      this.#params.onEvent?.(event)
    } catch {
      // Observer failures must not change the elicitation result or event pair.
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
   * @param params - The prompt, optional prior messages, and AbortSignal for cancellation
   * @returns The final result of agent execution
   */
  async run(params: AgentRunParams<T>): Promise<AgentResult<T>> {
    let result: AgentResult<T> | undefined

    for await (const event of this.stream(params)) {
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
   * @param params - The prompt, optional prior messages, and AbortSignal for cancellation
   * @yields AgentEvent for each stage of execution
   */
  async *stream(params: AgentRunParams<T>): AsyncGenerator<AgentEvent<T>> {
    const { prompt, messages: priorMessages, signal } = params
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
    const timeoutID = setTimeout(() => timeoutController.abort(), timeout)
    // Tracks the in-flight chat turn so the outer finally can return it if the
    // consumer abandons this generator mid-stream.
    let activeChatTurn: ChatTurn<T> | null = null

    // Link caller and timeout cancellation to the run, which also aborts when
    // a consumer abandons the generator.
    const runController = new AbortController()
    const upstreamSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal
    const onUpstreamAbort = () => runController.abort(upstreamSignal.reason)
    if (upstreamSignal.aborted) onUpstreamAbort()
    else upstreamSignal.addEventListener('abort', onUpstreamAbort, { once: true })
    const combinedSignal = runController.signal
    const run: AgentRunState<T> = { channel: new AgentEventChannel<T>(), signal: combinedSignal }
    this.#activeRuns.add(run)

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
      // Canonical callable tool names (namespaced IDs), used to reject tool
      // calls the model hallucinates with an unknown/malformed name before they
      // reach execution and surface as an opaque error.
      const callableToolNames = new Set(
        session.contextHost.getCallableTools().map((tool) => tool.name),
      )

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
        let iterationReasoning = ''
        const chatTurn = session.streamChatTurn({
          provider,
          model,
          messages,
          tools,
          signal: combinedSignal,
        })
        activeChatTurn = chatTurn

        // Iterate through chunks, yielding text events in real-time.
        //
        // Aborting the turn signal must interrupt the stream even when the
        // provider has stopped yielding entirely (a model hung mid-stream): in
        // that case `chatTurn.next()` parks forever waiting for data that never
        // arrives, so a between-chunk abort check would never run. Race each
        // pull against the abort signal so a parked read is unblocked the moment
        // the turn is aborted or times out. On abort we close the provider
        // stream (releases the reader / HTTP connection) and throw; the catch
        // below emits the timeout/error event.
        const pull = (): ReturnType<typeof chatTurn.next> => {
          if (combinedSignal.aborted) {
            return Promise.reject(
              combinedSignal.reason instanceof Error ? combinedSignal.reason : new Error('Aborted'),
            )
          }
          return new Promise((resolve, reject) => {
            const onAbort = () => {
              reject(
                combinedSignal.reason instanceof Error
                  ? combinedSignal.reason
                  : new Error('Aborted'),
              )
            }
            combinedSignal.addEventListener('abort', onAbort, { once: true })
            chatTurn.next().then(
              (value) => {
                combinedSignal.removeEventListener('abort', onAbort)
                resolve(value)
              },
              (error) => {
                combinedSignal.removeEventListener('abort', onAbort)
                reject(error)
              },
            )
          })
        }

        let result: Awaited<ReturnType<typeof chatTurn.next>>
        try {
          result = await pull()
          while (!result.done) {
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
            } else if (chunk.type === 'reasoning-delta') {
              iterationReasoning += chunk.reasoning
              const reasoningEvent = emitEvent({
                type: 'reasoning-delta',
                reasoning: chunk.reasoning,
                timestamp: Date.now(),
              })
              yield reasoningEvent
              eventHistory.push(reasoningEvent)
            } else if (chunk.type === 'done') {
              totalInputTokens += chunk.inputTokens
              totalOutputTokens += chunk.outputTokens
            }
            result = await pull()
          }
          activeChatTurn = null
        } catch (streamError) {
          // Best-effort close so the provider releases its reader / HTTP
          // connection. Fire-and-forget, never awaited: a generator parked on a
          // read that ignores cancellation would queue `.return()` behind that
          // never-settling read and deadlock the turn. In production the abort
          // rejects the read and this settles promptly. Rethrow for the outer
          // catch to surface as a timeout/error event.
          void chatTurn.return(undefined as never).catch(() => {})
          throw streamError
        }

        // Emit reasoning complete if the model produced any reasoning
        if (iterationReasoning) {
          const reasoningCompleteEvent = emitEvent({
            type: 'reasoning-complete',
            reasoning: iterationReasoning,
            timestamp: Date.now(),
          })
          yield reasoningCompleteEvent
          eventHistory.push(reasoningCompleteEvent)
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
          // Handle approval. Stream its events as they happen -- the
          // `tool-call-pending` event must reach the UI *before* the approval
          // resolves so an interactive prompt can render and the turn signal can
          // interrupt the wait, rather than buffering every event until after
          // the user decides.
          const approval = this.#streamToolApproval(
            toolCall,
            toolApproval,
            { iteration, history: eventHistory, tool: this.#findTool(toolCall.name) },
            emitEvent,
            combinedSignal,
          )
          let approvalStep = await approval.next()
          while (!approvalStep.done) {
            yield approvalStep.value
            eventHistory.push(approvalStep.value)
            approvalStep = await approval.next()
          }
          const { approved: stepApproved, reason: stepReason } = approvalStep.value

          const record: AgentToolCallRecord = {
            call: toolCall,
            approved: stepApproved,
            denialReason: stepReason,
          }

          if (!stepApproved) {
            // Tool denied - add error message
            toolMessages.push({
              source: 'client',
              role: 'tool',
              toolCallID: toolCall.id,
              toolCallName: toolCall.name,
              text: JSON.stringify({
                error: stepReason ?? 'Tool call denied',
              }),
            })
          } else if (!callableToolNames.has(toolCall.name)) {
            // The model asked for a tool that does not exist (hallucinated or
            // malformed name). Capture it as a tool-call-error and feed the list
            // of valid tools back so the model can retry with a real name,
            // rather than letting execution throw an opaque "Invalid context
            // tool ID" deep in the host.
            const error = new UnknownToolError({
              toolName: toolCall.name,
              availableTools: [...callableToolNames],
            })
            const errorEvent = emitEvent({
              type: 'tool-call-error',
              toolCall,
              error,
              timestamp: Date.now(),
            })
            yield errorEvent
            eventHistory.push(errorEvent)
            record.error = error
            toolMessages.push({
              source: 'client',
              role: 'tool',
              toolCallID: toolCall.id,
              toolCallName: toolCall.name,
              text: JSON.stringify({ error: error.message }),
            })
          } else {
            // Execute tool
            let settled = false
            const execution = this.#executeToolCall(toolCall, emitEvent, run).finally(() => {
              settled = true
            })
            // A consumer can abandon the generator while execution is still pending.
            void execution.catch(() => undefined)
            let pending = run.channel.takeAll()
            while (pending.length > 0 || !settled) {
              // Drain before waiting: an immediate callback may fill the channel
              // before the generator gets its first turn after starting the call.
              for (const event of pending) {
                yield event
                eventHistory.push(event)
              }
              // A taken batch stays in flight until every yield has resumed.
              run.channel.acknowledge(pending.length)
              if (!settled) await Promise.race([run.channel.waitForEvent(), execution])
              pending = run.channel.takeAll()
            }
            const execResult = await execution

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
      runController.abort(new Error('Agent stream closed'))
      clearTimeout(timeoutID)
      upstreamSignal.removeEventListener('abort', onUpstreamAbort)
      this.#activeRuns.delete(run)
      run.channel.close()
      // A consumer that breaks out of this generator leaves the current turn's
      // provider stream open; return it so the provider releases the reader.
      void activeChatTurn?.return(undefined as never).catch(() => {})
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

  /**
   * Resolve a tool call's approval, yielding lifecycle events as they happen.
   *
   * Crucially, the `tool-call-pending` event is yielded *before* the approval
   * decision is awaited, so an interactive UI can render an approval prompt and
   * the turn signal can interrupt the wait. The terminal decision is the
   * generator's return value.
   */
  async *#streamToolApproval(
    toolCall: FunctionToolCall<unknown>,
    strategy: ToolApprovalStrategy,
    context: ToolApprovalContext,
    emitEvent: (event: AgentEvent<T>) => AgentEvent<T>,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent<T>, { approved: boolean; reason?: string }> {
    if (strategy === 'auto') {
      yield emitEvent({ type: 'tool-call-approved', toolCall, timestamp: Date.now() })
      return { approved: true }
    }

    if (strategy === 'never') {
      const reason = 'Tool execution disabled'
      yield emitEvent({ type: 'tool-call-denied', toolCall, reason, timestamp: Date.now() })
      return { approved: false, reason }
    }

    if (strategy === 'ask') {
      // No async approval bridge wired -- refuse so host does not execute a tool
      // the user never approved. Callers supply a ToolApprovalFn to interactively approve.
      const reason = 'Tool approval required but no handler configured'
      yield emitEvent({ type: 'tool-call-pending', toolCall, timestamp: Date.now() })
      yield emitEvent({ type: 'tool-call-denied', toolCall, reason, timestamp: Date.now() })
      return { approved: false, reason }
    }

    // Custom function: surface the pending state, then await the decision while
    // letting the turn signal (user cancel / timeout) interrupt the wait.
    const fn = strategy as ToolApprovalFn
    yield emitEvent({ type: 'tool-call-pending', toolCall, timestamp: Date.now() })
    const result = await raceAbort(Promise.resolve(fn({ ...context, toolCall, signal })), signal)

    let approved: boolean
    let reason: string | undefined
    if (typeof result === 'boolean') {
      approved = result
    } else {
      approved = result.approved
      reason = result.reason
    }

    if (approved) {
      yield emitEvent({ type: 'tool-call-approved', toolCall, timestamp: Date.now() })
    } else {
      yield emitEvent({ type: 'tool-call-denied', toolCall, reason, timestamp: Date.now() })
    }
    return { approved, reason }
  }

  async #executeToolCall(
    toolCall: FunctionToolCall<unknown>,
    emitEvent: (event: AgentEvent<T>) => AgentEvent<T>,
    run: AgentRunState<T>,
  ): Promise<{ result?: CallToolResult; error?: Error }> {
    const { signal } = run

    // Per-call controller: fires on timeout or user cancel, independent of the turn.
    // Set up BEFORE emitting tool-call-start so that cancelToolCall() called from
    // within a tool-call-start handler takes effect on the live controller.
    const callController = new AbortController()
    this.#activeToolController = callController
    let activeTool: AgentToolState | undefined
    if (!isLocalToolID(toolCall.name)) {
      const [key] = getContextToolInfo(toolCall.name)
      activeTool = {
        key,
        toolCall,
        signal: callController.signal,
        controllers: new Set(),
        settlements: new Set(),
      }
      run.activeTool = activeTool
    }
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
      const startEvent: AgentEvent<T> = {
        type: 'tool-call-start',
        toolCall,
        timestamp: Date.now(),
      }
      run.channel.push(startEvent)
      emitEvent(startEvent)
      if (signal.aborted) {
        callController.abort(signal.reason)
      } else {
        signal.addEventListener('abort', onTurnAbort)
      }

      // Execute via session (handles namespaced tool parsing internally)
      const result = await this.#params.session.executeToolCall({
        toolCall,
        signal: callController.signal,
      })
      await this.#settleToolEvents(run, activeTool, () => ({
        type: 'tool-call-complete',
        toolCall,
        result,
        timestamp: Date.now(),
      }))

      return { result }
    } catch (error) {
      // Discriminate why the call ended. The turn-level signal taking priority
      // preserves user-abort / turn-timeout semantics (turn ends elsewhere).
      let err: Error
      if (signal.aborted) {
        err = error instanceof Error ? error : new Error(String(error))
      } else if (callController.signal.reason === TOOL_TIMEOUT_REASON) {
        err = new ToolCallTimeoutError({
          toolName: toolCall.name,
          timeoutMs: this.#params.toolTimeout,
        })
      } else if (callController.signal.reason === TOOL_CANCEL_REASON) {
        err = new ToolCallCancelledError({ toolName: toolCall.name })
      } else {
        err = error instanceof Error ? error : new Error(String(error))
      }

      await this.#settleToolEvents(run, activeTool, () => ({
        type: 'tool-call-error',
        toolCall,
        error: err,
        timestamp: Date.now(),
      }))

      return { error: err }
    } finally {
      clearTimeout(callTimer)
      signal.removeEventListener('abort', onTurnAbort)
      this.#activeToolController = null
      run.activeTool = undefined
    }
  }

  async #settleToolEvents(
    run: AgentRunState<T>,
    activeTool: AgentToolState | undefined,
    terminal: () => AgentEvent<T>,
  ): Promise<void> {
    while (true) {
      for (const controller of activeTool?.controllers ?? []) {
        controller.abort(TOOL_SETTLED_REASON)
      }
      await Promise.all(activeTool?.settlements ?? [])
      await run.channel.waitForDrain()
      if (!run.channel.isDrained() || (activeTool != null && activeTool.settlements.size > 0))
        continue

      // Detach at publication so a terminal observer cannot attribute another request to this call.
      run.activeTool = undefined
      this.#emitElicitationEvent(terminal(), run)
      return
    }
  }
}

/**
 * Reject as soon as `signal` aborts, otherwise settle with `promise`. Used to
 * make an otherwise un-cancellable await (e.g. waiting on interactive tool
 * approval) responsive to a turn cancel / timeout.
 */
function raceAbort<R>(promise: Promise<R>, signal: AbortSignal): Promise<R> {
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
  }
  return new Promise<R>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
