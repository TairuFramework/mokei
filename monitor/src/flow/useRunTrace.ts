import { useInterval, useTimeout } from '@mantine/hooks'
import { type RunTrace, TERMINAL_RUN_STATES } from '@mokei/flow-client'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useFlow } from './FlowProvider.js'
import { createGenerationGuard } from './reconcile.js'
import { useRun } from './useRun.js'

type TraceState = { trace?: RunTrace } & (
  | { status: 'idle' | 'loading' | 'ready'; error?: never }
  | { status: 'error'; error: unknown }
)

export function useRunTrace(runID: string) {
  const { control, connected, epoch, on, status } = useFlow()
  const { run, error: runError } = useRun(runID)
  const ready = connected && status?.state === 'ready'
  const terminal = run == null ? undefined : TERMINAL_RUN_STATES.includes(run.state)
  const guard = useRef(createGenerationGuard())
  const fetchTrace = useRef<() => void>(() => {})
  const [state, setState] = useState<TraceState>({ status: 'loading' })
  const poll = useRef(() => {})
  const { start: startPolling, stop: stopPolling } = useInterval(() => poll.current(), 2_000)
  const { start: startDeadline, clear: clearDeadline } = useTimeout(stopPolling, 10_000)
  const refresh = useCallback(() => fetchTrace.current(), [])

  useEffect(() => {
    const generation = guard.current.next()
    const current = () => guard.current.isCurrent(generation)
    setState({ status: ready && terminal != null ? 'loading' : 'idle' })
    if (!ready || terminal == null) return
    let inFlight = false
    let dirty = false
    let previous: string | undefined
    let stable = false
    const deadline = terminal ? Date.now() + 10_000 : undefined
    const expired = () => deadline != null && Date.now() >= deadline
    async function read() {
      if (!current()) return
      if (inFlight) {
        dirty = true
        return
      }
      inFlight = true
      setState((value) => ({ trace: value.trace, status: 'loading' }))
      try {
        if (control.runs.trace == null) throw new Error('Run traces are unavailable')
        const trace = await control.runs.trace(runID)
        if (!current()) return
        const signature = JSON.stringify(trace)
        stable = terminal === true && previous === signature
        previous = signature
        setState({ trace, status: 'ready' })
        if (stable) stopPolling()
      } catch (error) {
        previous = undefined
        if (current()) setState((value) => ({ trace: value.trace, status: 'error', error }))
      } finally {
        inFlight = false
        if (current() && dirty) {
          dirty = false
          void read()
        }
      }
    }
    fetchTrace.current = () => {
      void read()
    }
    const off = on((event) => {
      const eventRunID =
        event.type === 'run:state'
          ? event.data.runID
          : event.type === 'inbox:added'
            ? event.data.runID
            : event.data.item.runID
      if (eventRunID === runID) void read()
    })
    poll.current = () => {
      if (!stable && !expired()) void read()
    }
    startPolling()
    if (terminal) startDeadline()
    void read()
    return () => {
      guard.current.next()
      off()
      stopPolling()
      clearDeadline()
      poll.current = () => {}
      fetchTrace.current = () => {}
    }
  }, [
    control,
    epoch,
    on,
    ready,
    runID,
    terminal,
    startPolling,
    stopPolling,
    startDeadline,
    clearDeadline,
  ])

  return {
    trace: state.trace,
    loading: state.status === 'loading',
    error: state.error ?? runError,
    refresh,
  }
}
