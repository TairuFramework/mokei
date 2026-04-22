import type { Message, ProviderTypes } from '@mokei/model-provider'

import type { AgentEvent } from '@mokei/session'
import { useCallback, useMemo, useReducer, useRef } from 'react'

import { initialTurnState, type TurnState, turnReducer } from '../turn-reducer.js'

export type AgentSessionLike<T extends ProviderTypes = ProviderTypes> = {
  stream(
    prompt: string,
    opts?: { messages?: Array<Message<T['MessagePart'], T['ToolCall']>>; signal?: AbortSignal },
  ): AsyncGenerator<AgentEvent<T>>
}

export type UseAgentTurnParams<T extends ProviderTypes = ProviderTypes> = {
  createAgent: () => AgentSessionLike<T>
  onEvent?: (event: AgentEvent<T>) => void
}

export type UseAgentTurnReturn<T extends ProviderTypes = ProviderTypes> = TurnState<T> & {
  submit: (text: string) => Promise<void>
  abort: () => void
}

export function useAgentTurn<T extends ProviderTypes = ProviderTypes>(
  params: UseAgentTurnParams<T>,
): UseAgentTurnReturn<T> {
  const [state, dispatch] = useReducer(
    turnReducer as (s: TurnState<T>, e: AgentEvent<T>) => TurnState<T>,
    undefined,
    initialTurnState<T>,
  )
  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef<Array<Message<T['MessagePart'], T['ToolCall']>>>([])
  const { createAgent, onEvent } = params

  const submit = useCallback(
    async (text: string) => {
      if (text.trim() === '') return
      const controller = new AbortController()
      abortRef.current = controller
      const agent = createAgent()
      try {
        for await (const event of agent.stream(text, {
          messages: messagesRef.current,
          signal: controller.signal,
        })) {
          dispatch(event)
          onEvent?.(event)
          if (event.type === 'complete') {
            messagesRef.current = event.result.messages
          }
        }
      } finally {
        abortRef.current = null
      }
    },
    [createAgent, onEvent],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return useMemo(() => ({ ...state, submit, abort }), [state, submit, abort])
}
