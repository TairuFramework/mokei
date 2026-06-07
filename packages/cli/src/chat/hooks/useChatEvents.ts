import type { ProviderTypes } from '@mokei/model-provider'
import type { AgentEvent } from '@mokei/session'
import { useCallback, useRef, useState } from 'react'

import type { PushEntry } from '../transcript.js'

export type UseChatEventsParams = {
  pushEntry: PushEntry
  timeout?: number
  // Tools available to the model, queried lazily to explain an empty completion.
  getToolCount: () => number
}

export type UseChatEventsReturn<T extends ProviderTypes> = {
  onEvent: (event: AgentEvent<T>) => void
  showReasoning: boolean
  setShowReasoning: (next: boolean) => void
  getLastReasoning: () => string
  getLastErrorDetail: () => string | null
}

// Maps the agent event stream onto transcript entries and owns the reasoning /
// error bookkeeping the slash commands (`/details`, `/reasoning last`) read back.
export function useChatEvents<T extends ProviderTypes>({
  pushEntry,
  timeout,
  getToolCount,
}: UseChatEventsParams): UseChatEventsReturn<T> {
  const [showReasoning, setShowReasoning] = useState(true)
  const toolStartRef = useRef<Map<string, number>>(new Map())
  const lastErrorDetailRef = useRef<string | null>(null)
  // Reasoning accumulated during the current turn, committed to lastReasoningRef
  // when the turn ends so `/reasoning last` can reprint it.
  const reasoningBufRef = useRef<string>('')
  const lastReasoningRef = useRef<string>('')
  // Mirror of showReasoning readable from the (possibly stale) onEvent closure.
  const showReasoningRef = useRef(showReasoning)
  showReasoningRef.current = showReasoning

  const onEvent = useCallback(
    (event: AgentEvent<T>) => {
      switch (event.type) {
        case 'start':
          reasoningBufRef.current = ''
          break
        case 'reasoning-delta':
          reasoningBufRef.current += event.reasoning
          break
        case 'reasoning-complete':
          // Persist reasoning into the transcript so it stays visible after the
          // response text, when reasoning display is enabled.
          if (showReasoningRef.current && event.reasoning !== '') {
            pushEntry({ kind: 'reasoning', text: event.reasoning })
          }
          break
        case 'text-complete':
          if (event.text.length > 0) {
            pushEntry({ kind: 'assistant', text: event.text })
          }
          break
        case 'tool-call-start':
          toolStartRef.current.set(event.toolCall.id, event.timestamp)
          break
        case 'tool-call-complete': {
          const content = event.result?.content
          const text = Array.isArray(content)
            ? (
                content.find((c: { type: string }) => c.type === 'text') as
                  | { type: 'text'; text: string }
                  | undefined
              )?.text
            : undefined
          const startedAt = toolStartRef.current.get(event.toolCall.id)
          toolStartRef.current.delete(event.toolCall.id)
          pushEntry({
            kind: 'tool',
            name: event.toolCall.name,
            result: text ?? '',
            ...(startedAt != null ? { durationMs: event.timestamp - startedAt } : {}),
          })
          break
        }
        case 'tool-call-error': {
          const startedAt = toolStartRef.current.get(event.toolCall.id)
          toolStartRef.current.delete(event.toolCall.id)
          const outcome =
            event.error.name === 'ToolCallTimeoutError'
              ? 'timeout'
              : event.error.name === 'ToolCallCancelledError'
                ? 'cancelled'
                : 'error'
          lastErrorDetailRef.current = event.error.stack ?? event.error.message
          pushEntry({
            kind: 'tool',
            name: event.toolCall.name,
            error: event.error.message,
            outcome,
            ...(startedAt != null ? { durationMs: event.timestamp - startedAt } : {}),
          })
          if (outcome === 'cancelled') {
            pushEntry({
              kind: 'notice',
              variant: 'warning',
              text: `tool cancelled: ${event.toolCall.name}`,
            })
          }
          break
        }
        case 'tool-call-denied':
          pushEntry({
            kind: 'notice',
            variant: 'warning',
            text: `tool denied: ${event.toolCall.name}${event.reason ? ` — ${event.reason}` : ''}`,
          })
          break
        case 'error': {
          const err = event.error
          lastReasoningRef.current = reasoningBufRef.current
          lastErrorDetailRef.current = err.stack ?? err.message
          const cause =
            err.cause instanceof Error ? ` (cause: ${err.cause.name}: ${err.cause.message})` : ''
          pushEntry({
            kind: 'notice',
            variant: 'error',
            text: `${err.name}: ${err.message}${cause}`,
          })
          break
        }
        case 'timeout': {
          const secs = timeout != null ? Math.round(timeout / 1000) : null
          pushEntry({
            kind: 'notice',
            variant: 'warning',
            text:
              secs != null
                ? `turn timed out after ${secs}s — pass --timeout to adjust`
                : 'turn timed out — pass --timeout to adjust',
          })
          lastReasoningRef.current = reasoningBufRef.current
          break
        }
        case 'max-iterations':
          lastReasoningRef.current = reasoningBufRef.current
          pushEntry({
            kind: 'notice',
            variant: 'warning',
            text: 'max iterations reached',
          })
          break
        case 'complete':
          lastReasoningRef.current = reasoningBufRef.current
          if (event.result.text === '' && event.result.toolCalls.length === 0) {
            const toolCount = getToolCount()
            const hint =
              toolCount === 0
                ? ' — no tools are enabled for the model to call (add a context and enable its tools with /tools)'
                : ` — ${toolCount} tool(s) available, but the model produced no text or tool call`
            pushEntry({
              kind: 'notice',
              variant: 'warning',
              text: `stream ended with no output (finish: ${event.result.finishReason})${hint}`,
            })
          }
          break
      }
    },
    [pushEntry, timeout, getToolCount],
  )

  const getLastReasoning = useCallback(() => lastReasoningRef.current, [])
  const getLastErrorDetail = useCallback(() => lastErrorDetailRef.current, [])

  return { onEvent, showReasoning, setShowReasoning, getLastReasoning, getLastErrorDetail }
}
