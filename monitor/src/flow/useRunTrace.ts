import { type RunTrace, TERMINAL_RUN_STATES } from '@mokei/flow-client'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useFlow } from './FlowProvider.js'
import { createGenerationGuard } from './reconcile.js'
import { useRun } from './useRun.js'

export function useRunTrace(runID: string) {
  const { control, connected, epoch, on, status } = useFlow()
  const { run, error: runError } = useRun(runID)
  const ready = connected && status?.state === 'ready'
  const terminal = run == null ? undefined : TERMINAL_RUN_STATES.includes(run.state)
  const guard = useRef(createGenerationGuard())
  const fetchTrace = useRef<() => void>(() => {})
  const [state, setState] = useState<{ trace?: RunTrace; loading: boolean; error?: unknown }>({
    loading: true,
  })
  const refresh = useCallback(() => fetchTrace.current(), [])

  useEffect(() => {
    const generation = guard.current.next()
    const current = () => guard.current.isCurrent(generation)
    setState({ loading: ready && terminal != null })
    if (!ready || terminal == null) return
    let inFlight = false
    let dirty = false
    let previous: string | undefined
    let stable = false
    let interval: ReturnType<typeof setInterval> | undefined
    const deadline = terminal ? Date.now() + 10_000 : undefined
    const expired = () => deadline != null && Date.now() >= deadline
    async function read() {
      if (!current()) return
      if (inFlight) {
        dirty = true
        return
      }
      inFlight = true
      setState((value) => ({ ...value, loading: true, error: undefined }))
      try {
        if (control.runs.trace == null) throw new Error('Run traces are unavailable')
        const trace = await control.runs.trace(runID)
        if (!current()) return
        const signature = JSON.stringify(trace)
        stable = terminal === true && previous === signature
        previous = signature
        setState({ trace, loading: false })
        if (stable && interval != null) clearInterval(interval)
      } catch (error) {
        previous = undefined
        if (current()) setState((value) => ({ ...value, loading: false, error }))
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
    interval = setInterval(() => {
      if (!stable && !expired()) void read()
    }, 2_000)
    const timeout = terminal
      ? setTimeout(() => {
          clearInterval(interval)
        }, 10_000)
      : undefined
    void read()
    return () => {
      guard.current.next()
      off()
      clearInterval(interval)
      if (timeout != null) clearTimeout(timeout)
      fetchTrace.current = () => {}
    }
  }, [control, epoch, on, ready, runID, terminal])

  return { ...state, error: state.error ?? runError, refresh }
}
