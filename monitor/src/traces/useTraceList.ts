import type { TraceSummary } from '@mokei/host-protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useHostConnection } from '../host/useHostConnection.js'
import { mergeSummaries } from './trace-merge.js'
import { traceSearchText } from './trace-summary.js'

/** Live summaries beyond this count drop the oldest inactive traces, so an open page stays bounded. */
export const MAX_LIVE_TRACES = 1000

/** Drop the oldest inactive summaries above `cap`; returns the pruned map and whether it changed. */
export function pruneSummaries(
  current: Map<string, TraceSummary>,
  cap: number,
): { summaries: Map<string, TraceSummary>; pruned: boolean } {
  if (current.size <= cap) return { summaries: current, pruned: false }
  const next = new Map(current)
  const inactive = [...current.values()]
    .filter((summary) => !summary.active)
    .sort((a, b) => a.startTime - b.startTime)
  for (const summary of inactive) {
    if (next.size <= cap) break
    next.delete(summary.traceID)
  }
  return { summaries: next, pruned: next.size < current.size }
}

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
  hasMore: boolean
  loading: boolean
  error: Error | undefined
  retry(): void
} {
  const { client, epoch, connected, subscribe } = useHostConnection()
  const { kind, active, outcome, name, since, until } = filters
  const [summaries, setSummaries] = useState(new Map<string, TraceSummary>())
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error>()
  const fetchMore = useRef(() => {})
  const retryRead = useRef(() => {})
  const loadMore = useCallback(() => fetchMore.current(), [])
  const retry = useCallback(() => retryRead.current(), [])

  useEffect(() => {
    let stopped = false
    let pending = false
    let failed = false
    let cursor: string | undefined
    // After pruning, paging resumes from the oldest kept trace instead of the server cursor.
    let resumeUntil: number | undefined
    let loaded = 0
    let current = new Map<string, TraceSummary>()
    let buffered: Array<TraceSummary> = []
    const queryFilters = { kind, active, outcome, name, since, until }
    setSummaries(current)
    setLoading(false)
    setHasMore(false)
    setError(undefined)
    if (!connected) return

    function publish(incoming: Array<TraceSummary>, live = false) {
      current = mergeSummaries(current, incoming)
      if (live) {
        const result = pruneSummaries(current, Math.max(MAX_LIVE_TRACES, loaded))
        if (result.pruned) {
          current = result.summaries
          const oldest = Math.min(...[...current.values()].map((summary) => summary.startTime))
          resumeUntil = Number.isFinite(oldest) ? oldest : undefined
          cursor = undefined
          setHasMore(true)
        }
      }
      setSummaries(current)
    }
    // Keep nonmatching revisions too, so delayed events cannot restore filtered-out traces.
    const off = subscribe(['trace:summary'], (event, eventEpoch) => {
      if (stopped || eventEpoch !== epoch) return
      if (pending) buffered.push(event.data)
      else publish([event.data], true)
    })
    async function read() {
      if (stopped || pending) return
      pending = true
      setLoading(true)
      setError(undefined)
      try {
        const resume =
          cursor == null && resumeUntil != null
            ? { until: Math.min(resumeUntil, queryFilters.until ?? resumeUntil) }
            : {}
        const result = await client.request('traces.list', {
          param: { ...queryFilters, ...resume, limit: 50, ...(cursor == null ? {} : { cursor }) },
        })
        if (stopped) return
        cursor = result.cursor
        resumeUntil = undefined
        loaded = Math.max(loaded, current.size) + result.traces.length
        setHasMore(cursor != null)
        failed = false
        publish([...result.traces, ...buffered])
      } catch (error: unknown) {
        if (!stopped) {
          failed = true
          setError(error instanceof Error ? error : new Error(String(error)))
          publish(buffered)
        }
      } finally {
        if (!stopped) {
          buffered = []
          pending = false
          setLoading(false)
        }
      }
    }
    fetchMore.current = () => {
      if (cursor != null || resumeUntil != null) void read()
    }
    retryRead.current = () => {
      if (failed) void read()
    }
    void read()
    return () => {
      stopped = true
      off()
      fetchMore.current = () => {}
      retryRead.current = () => {}
    }
  }, [client, epoch, connected, subscribe, kind, active, outcome, name, since, until])

  const traces = [...summaries.values()]
    .filter((summary) => {
      return (
        (kind == null || summary.kind === kind) &&
        (active == null || summary.active === active) &&
        (outcome === undefined || summary.outcome === outcome) &&
        (name == null || traceSearchText(summary).includes(name.toLowerCase())) &&
        (since == null || summary.startTime >= since) &&
        (until == null || summary.startTime <= until)
      )
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.startTime - a.startTime)
  return { traces, loadMore, hasMore, loading, error, retry }
}
