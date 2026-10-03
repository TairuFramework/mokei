import type { FlowEvent } from '@mokei/flow-client'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useFlow } from './FlowProvider.js'
import { createGenerationGuard } from './reconcile.js'

export type ReconciledQuery<Data, Entry> = {
  initial: Data
  read(): Promise<Data>
  affected(event: FlowEvent): string | undefined
  readAffected(id: string): Promise<Entry>
  merge(data: Data, id: string, entry: Entry): Data
  apply(data: Data, event: FlowEvent): Data
  observe?(event: FlowEvent): void
}

export function useReconciledQuery<Data, Entry>(query: ReconciledQuery<Data, Entry>) {
  const { connected, epoch, on, status } = useFlow()
  const ready = connected && status?.state === 'ready'
  const guard = useRef(createGenerationGuard())
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ data: Data; loading: boolean; error?: unknown }>({
    data: query.initial,
    loading: ready,
  })
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    const generation = guard.current.next()
    const current = () => guard.current.isCurrent(generation)
    setState({ data: query.initial, loading: ready })
    if (!ready) return
    let buffering = true
    const buffered = new Set<string>()
    const versions = new Map<string, number>()
    const off = on((event) => {
      query.observe?.(event)
      const id = query.affected(event)
      if (id == null) return
      versions.set(id, (versions.get(id) ?? 0) + 1)
      if (buffering) buffered.add(id)
      else setState((value) => ({ ...value, data: query.apply(value.data, event) }))
    })
    void (async () => {
      try {
        const snapshot = await query.read()
        if (!current()) return
        setState({ data: snapshot, loading: true })
      } catch (error) {
        if (!current()) return
        setState((value) => ({ ...value, error }))
      }
      // Failed snapshots still drain affected IDs and resume live updates.
      buffering = false
      await Promise.all(
        [...buffered].map(async (id) => {
          const version = versions.get(id)
          try {
            const entry = await query.readAffected(id)
            if (current() && versions.get(id) === version) {
              setState((value) => ({ ...value, data: query.merge(value.data, id, entry) }))
            }
          } catch (error) {
            if (current() && versions.get(id) === version)
              setState((value) => ({ ...value, error }))
          }
        }),
      )
      if (current()) setState((value) => ({ ...value, loading: false }))
    })()
    return () => {
      off()
      guard.current.next()
    }
  }, [epoch, on, query, ready, revision])

  return { ...state, refresh }
}
