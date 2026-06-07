import { useCallback, useMemo, useState } from 'react'

import type { SystemNoticeVariant } from './components/SystemNotice.js'

export type TranscriptEntry =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string }
  | {
      kind: 'tool'
      id: number
      name: string
      result?: string
      error?: string
      outcome?: 'error' | 'timeout' | 'cancelled'
      durationMs?: number
    }
  | { kind: 'notice'; id: number; variant: SystemNoticeVariant; text: string }
  | { kind: 'reasoning'; id: number; text: string }

// Distributive omit preserves the discriminated union (plain `Omit<TranscriptEntry, 'id'>`
// collapses into an intersection that drops variant-specific fields).
export type TranscriptEntryInput = TranscriptEntry extends infer E
  ? E extends { id: number }
    ? Omit<E, 'id'>
    : never
  : never

export type PushEntry = (entry: TranscriptEntryInput) => void

export type UseTranscriptReturn = {
  transcript: Array<TranscriptEntry>
  pushEntry: PushEntry
}

// Owns the committed transcript and hands out monotonic ids so callers append
// without tracking keys themselves.
export function useTranscript(): UseTranscriptReturn {
  const [transcript, setTranscript] = useState<Array<TranscriptEntry>>([])
  const nextID = useMemo(() => {
    let n = 0
    return () => ++n
  }, [])
  const pushEntry = useCallback<PushEntry>(
    (entry) => setTranscript((prev) => [...prev, { ...entry, id: nextID() } as TranscriptEntry]),
    [nextID],
  )
  return { transcript, pushEntry }
}
