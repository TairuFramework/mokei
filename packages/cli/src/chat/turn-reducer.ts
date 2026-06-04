import type { FunctionToolCall, Message, ProviderTypes } from '@mokei/model-provider'
import type { AgentEvent } from '@mokei/session'

export type TurnStateName = 'idle' | 'streaming' | 'awaiting-approval' | 'calling-tool'

export type TurnState<T extends ProviderTypes = ProviderTypes> = {
  state: TurnStateName
  currentText: string
  // Live reasoning (thinking) for the current model response, shown ephemerally
  // while the model reasons before producing text or a tool call.
  currentReasoning: string
  lastAssistantText: string
  messages: Array<Message<T['MessagePart'], T['ToolCall']>>
  pendingCall: FunctionToolCall<unknown> | null
  activeToolCall: { call: FunctionToolCall<unknown>; startedAt: number } | null
  // When the current model response began (start / each iteration-start). Drives
  // the elapsed + hang display while waiting for the first token.
  streamStartedAt: number | null
  lastError: string | null
  iteration: number
}

export function initialTurnState<T extends ProviderTypes = ProviderTypes>(): TurnState<T> {
  return {
    state: 'idle',
    currentText: '',
    currentReasoning: '',
    lastAssistantText: '',
    messages: [],
    pendingCall: null,
    activeToolCall: null,
    streamStartedAt: null,
    lastError: null,
    iteration: 0,
  }
}

export function turnReducer<T extends ProviderTypes = ProviderTypes>(
  state: TurnState<T>,
  event: AgentEvent<T>,
): TurnState<T> {
  switch (event.type) {
    case 'start':
      return {
        ...state,
        state: 'streaming',
        currentText: '',
        currentReasoning: '',
        lastError: null,
        streamStartedAt: event.timestamp,
      }
    case 'iteration-start':
      return {
        ...state,
        iteration: event.iteration,
        currentReasoning: '',
        streamStartedAt: event.timestamp,
      }
    case 'reasoning-delta':
      return { ...state, currentReasoning: state.currentReasoning + event.reasoning }
    case 'reasoning-complete':
      return state
    case 'text-delta':
      return { ...state, currentText: state.currentText + event.text }
    case 'text-complete':
      return {
        ...state,
        currentText: '',
        lastAssistantText: event.text,
      }
    case 'tool-call-pending':
      return { ...state, state: 'awaiting-approval', pendingCall: event.toolCall }
    case 'tool-call-approved':
      return {
        ...state,
        state: 'calling-tool',
        pendingCall: event.toolCall,
        activeToolCall: { call: event.toolCall, startedAt: event.timestamp },
      }
    case 'tool-call-denied':
      return { ...state, state: 'streaming', pendingCall: null, activeToolCall: null }
    case 'tool-call-start':
      return {
        ...state,
        state: 'calling-tool',
        pendingCall: event.toolCall,
        activeToolCall: { call: event.toolCall, startedAt: event.timestamp },
      }
    case 'tool-call-complete':
    case 'tool-call-error':
      return { ...state, state: 'streaming', pendingCall: null, activeToolCall: null }
    case 'iteration-complete':
      return state
    case 'complete':
      return {
        ...state,
        state: 'idle',
        messages: event.result.messages,
      }
    case 'error':
      return { ...state, state: 'idle', lastError: event.error.message }
    case 'timeout':
      return { ...state, state: 'idle', lastError: 'timeout' }
    case 'max-iterations':
      return { ...state, state: 'idle', lastError: 'max iterations reached' }
    default: {
      const _exhaustive: never = event
      return state
    }
  }
}
