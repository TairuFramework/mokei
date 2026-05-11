import type { FunctionToolCall, Message, ProviderTypes } from '@mokei/model-provider'
import type { AgentEvent } from '@mokei/session'

export type TurnStateName = 'idle' | 'streaming' | 'awaiting-approval' | 'calling-tool'

export type TurnState<T extends ProviderTypes = ProviderTypes> = {
  state: TurnStateName
  currentText: string
  lastAssistantText: string
  messages: Array<Message<T['MessagePart'], T['ToolCall']>>
  pendingCall: FunctionToolCall<unknown> | null
  lastError: string | null
  iteration: number
}

export function initialTurnState<T extends ProviderTypes = ProviderTypes>(): TurnState<T> {
  return {
    state: 'idle',
    currentText: '',
    lastAssistantText: '',
    messages: [],
    pendingCall: null,
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
      return { ...state, state: 'streaming', currentText: '', lastError: null }
    case 'iteration-start':
      return { ...state, iteration: event.iteration }
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
      return { ...state, state: 'calling-tool', pendingCall: event.toolCall }
    case 'tool-call-denied':
      return { ...state, state: 'streaming', pendingCall: null }
    case 'tool-call-start':
      return { ...state, state: 'calling-tool', pendingCall: event.toolCall }
    case 'tool-call-complete':
    case 'tool-call-error':
      return { ...state, state: 'streaming', pendingCall: null }
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
