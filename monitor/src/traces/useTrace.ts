import type { HostEvent } from '@mokei/host-protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useHostConnection } from '../host/useHostConnection.js'
import {
  applyCall,
  applyLog,
  applySnapshot,
  applySpan,
  emptyTraceState,
  mergeSummaries,
  type TraceState,
  toCall,
} from './trace-merge.js'

/** Logs fetched per "load older" page. */
const OLDER_LOGS_PAGE = 500

type TraceEvent = Extract<HostEvent, { type: 'span:start' | 'span:end' | 'log' | 'trace:summary' }>

function applyEvent(state: TraceState, event: TraceEvent, traceID: string): TraceState {
  if (event.data.traceID !== traceID) {
    // Another trace's request span calling into this one.
    if (event.type !== 'span:start' && event.type !== 'span:end') return state
    const call = toCall(event.data, traceID)
    return call == null ? state : applyCall(state, call)
  }
  switch (event.type) {
    case 'span:start':
    case 'span:end':
      return applySpan(state, event.data)
    case 'log':
      return applyLog(state, event.data)
    case 'trace:summary': {
      const summaries =
        state.summary == null ? new Map() : new Map([[state.summary.traceID, state.summary]])
      return { ...state, summary: mergeSummaries(summaries, [event.data]).get(event.data.traceID) }
    }
  }
}

export function useTrace(traceID: string | undefined): {
  state: TraceState | undefined
  loading: boolean
  notFound: boolean
  error: Error | undefined
  retry(): void
  /** Fetches the page of logs before the oldest one held; clears `logsTruncated` at the start. */
  loadOlderLogs(): void
  loadingLogs: boolean
} {
  const { client, epoch, connected, subscribe } = useHostConnection()
  const [state, setState] = useState<TraceState>()
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<Error>()
  const retryRead = useRef(() => {})
  const retry = useCallback(() => retryRead.current(), [])
  const loadOlder = useRef(() => {})
  const loadOlderLogs = useCallback(() => loadOlder.current(), [])
  const [loadingLogs, setLoadingLogs] = useState(false)

  useEffect(() => {
    let stopped = false
    let pending = false
    let current: TraceState = emptyTraceState()
    let logCursor: string | undefined
    let loadingOlder = false
    setLoadingLogs(false)
    const buffered: Array<TraceEvent> = []
    setState(undefined)
    setNotFound(false)
    setError(undefined)
    setLoading(connected && traceID != null)
    if (!connected || traceID == null) return
    const off = subscribe(
      ['span:start', 'span:end', 'log', 'trace:summary'],
      (event, eventEpoch) => {
        if (stopped || eventEpoch !== epoch) return
        const next = applyEvent(current, event, traceID)
        if (next === current && event.data.traceID !== traceID) return
        if (pending) buffered.push(event)
        else {
          current = next
          setState(current)
          setNotFound(false)
        }
      },
    )
    const selectedTraceID = traceID
    async function read() {
      if (stopped || pending) return
      pending = true
      setLoading(true)
      setError(undefined)
      setNotFound(false)
      try {
        const result = await client.request('traces.get', { param: { traceID: selectedTraceID } })
        if (stopped) return
        current = applySnapshot(current, result)
        for (const event of buffered) current = applyEvent(current, event, selectedTraceID)
        setState(current)
      } catch (error: unknown) {
        if (stopped) return
        const missing =
          typeof error === 'object' &&
          error != null &&
          'code' in error &&
          error.code === 'TRACE_NOT_FOUND'
        setNotFound(missing)
        if (!missing) setError(error instanceof Error ? error : new Error(String(error)))
        if (buffered.length > 0) {
          for (const event of buffered) current = applyEvent(current, event, selectedTraceID)
          setState(current)
          setNotFound(false)
        }
      } finally {
        if (!stopped) {
          // Finish reconciliation in the same turn so settlement-time events apply live.
          pending = false
          buffered.length = 0
          setLoading(false)
        }
      }
    }
    async function readOlderLogs() {
      if (stopped || loadingOlder) return
      loadingOlder = true
      setLoadingLogs(true)
      try {
        // The first page starts at the oldest log held; later ones follow the cursor.
        const oldest = Math.min(...[...current.logs.values()].map((log) => log.timestamp))
        const result = await client.request('traces.logs', {
          param: {
            traceID: selectedTraceID,
            limit: OLDER_LOGS_PAGE,
            ...(logCursor == null
              ? Number.isFinite(oldest)
                ? { before: oldest }
                : {}
              : { cursor: logCursor }),
          },
        })
        if (stopped) return
        for (const log of result.logs) current = applyLog(current, log)
        logCursor = result.cursor
        current = { ...current, logsTruncated: result.cursor != null }
        setState(current)
      } catch (error: unknown) {
        if (!stopped) setError(error instanceof Error ? error : new Error(String(error)))
      } finally {
        loadingOlder = false
        if (!stopped) setLoadingLogs(false)
      }
    }
    retryRead.current = () => void read()
    loadOlder.current = () => void readOlderLogs()
    void read()
    return () => {
      stopped = true
      off()
      retryRead.current = () => {}
      loadOlder.current = () => {}
    }
  }, [client, epoch, connected, subscribe, traceID])

  return { state, loading, notFound, error, retry, loadOlderLogs, loadingLogs }
}
