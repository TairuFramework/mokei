import type { TraceSummary } from '@mokei/host-protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useHostConnection } from '../host/useHostConnection.js'
import { mergeSummaries } from './trace-merge.js'

export type TraceListFilters = {
  kind?: TraceSummary['kind']
  active?: boolean
  outcome?: TraceSummary['outcome']
  name?: string
  since?: number
  until?: number
}

export function useTraceList(filters: TraceListFilters): {
  traces: Array<TraceSummary>
  loadMore(): void
  loading: boolean
} {
  const { client, epoch, connected, subscribe } = useHostConnection()
  const { kind, active, outcome, name, since, until } = filters
  const [summaries, setSummaries] = useState(new Map<string, TraceSummary>())
  const [loading, setLoading] = useState(false)
  const fetchMore = useRef(() => {})
  const loadMore = useCallback(() => fetchMore.current(), [])

  useEffect(() => {
    let stopped = false
    let pending = false
    let cursor: string | undefined
    let current = new Map<string, TraceSummary>()
    let buffered: Array<TraceSummary> = []
    const queryFilters = { kind, active, outcome, name, since, until }
    setSummaries(current)
    setLoading(false)
    if (!connected) return

    function publish(incoming: Array<TraceSummary>) {
      current = mergeSummaries(current, incoming)
      setSummaries(current)
    }
    // Keep nonmatching revisions too, so delayed events cannot restore filtered-out traces.
    const off = subscribe(['trace:summary'], (event, eventEpoch) => {
      if (stopped || eventEpoch !== epoch) return
      if (pending) buffered.push(event.data)
      else publish([event.data])
    })
    async function read() {
      if (stopped || pending) return
      pending = true
      setLoading(true)
      try {
        const result = await client.request('traces.list', {
          param: { ...queryFilters, limit: 50, ...(cursor == null ? {} : { cursor }) },
        })
        if (stopped) return
        cursor = result.cursor
        publish([...result.traces, ...buffered])
      } catch {
        if (!stopped) publish(buffered)
      } finally {
        if (!stopped) {
          buffered = []
          pending = false
          setLoading(false)
        }
      }
    }
    fetchMore.current = () => {
      if (cursor != null) void read()
    }
    void read()
    return () => {
      stopped = true
      off()
      fetchMore.current = () => {}
    }
  }, [client, epoch, connected, subscribe, kind, active, outcome, name, since, until])

  const traces = [...summaries.values()]
    .filter((summary) => {
      return (
        (kind == null || summary.kind === kind) &&
        (active == null || summary.active === active) &&
        (outcome === undefined || summary.outcome === outcome) &&
        (name == null || summary.name.toLowerCase().includes(name.toLowerCase())) &&
        (since == null || summary.startTime >= since) &&
        (until == null || summary.startTime <= until)
      )
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.startTime - a.startTime)
  return { traces, loadMore, loading }
}
