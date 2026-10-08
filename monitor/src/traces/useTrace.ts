import type { HostEvent } from '@mokei/host-protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useHostConnection } from '../host/useHostConnection.js'
import {
  applyLog,
  applySnapshot,
  applySpan,
  mergeSummaries,
  type TraceState,
} from './trace-merge.js'

type TraceEvent = Extract<HostEvent, { type: 'span:start' | 'span:end' | 'log' | 'trace:summary' }>

function applyEvent(state: TraceState, event: TraceEvent): TraceState {
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
} {
  const { client, epoch, connected, subscribe } = useHostConnection()
  const [state, setState] = useState<TraceState>()
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<Error>()
  const retryRead = useRef(() => {})
  const retry = useCallback(() => retryRead.current(), [])

  useEffect(() => {
    let stopped = false
    let pending = false
    let current: TraceState = { spans: new Map(), logs: new Map(), logsTruncated: false }
    const buffered: Array<TraceEvent> = []
    setState(undefined)
    setNotFound(false)
    setError(undefined)
    setLoading(connected && traceID != null)
    if (!connected || traceID == null) return
    const off = subscribe(
      ['span:start', 'span:end', 'log', 'trace:summary'],
      (event, eventEpoch) => {
        if (stopped || eventEpoch !== epoch || event.data.traceID !== traceID) return
        if (pending) buffered.push(event)
        else {
          current = applyEvent(current, event)
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
        for (const event of buffered) current = applyEvent(current, event)
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
          for (const event of buffered) current = applyEvent(current, event)
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
    retryRead.current = () => void read()
    void read()
    return () => {
      stopped = true
      off()
      retryRead.current = () => {}
    }
  }, [client, epoch, connected, subscribe, traceID])

  return { state, loading, notFound, error, retry }
}
