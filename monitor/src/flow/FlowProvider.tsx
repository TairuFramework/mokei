import type { FlowControl, FlowEvent, FlowSubscription, InboxOutcome } from '@mokei/flow-client'
import type { FlowServiceStatus } from '@mokei/host-protocol'
import { createContext, type ReactNode, use, useCallback, useEffect, useRef, useState } from 'react'

import type { HostClient } from '../host/client.js'
import { createFlowConnection } from './connection.js'

export type FlowContextValue = {
  client: HostClient
  control: FlowControl
  epoch: number
  status: FlowServiceStatus | undefined
  connected: boolean
  restarted: boolean
  on(listener: (event: FlowEvent) => void): () => void
}

export const FlowContext = createContext<FlowContextValue | null>(null)
const InboxSettlementsContext = createContext<Map<string, InboxOutcome>>(new Map())

export function useFlow(): FlowContextValue {
  const context = use(FlowContext)
  if (context == null) throw new Error('A parent FlowProvider is required')
  return context
}

export function useInboxSettlements() {
  return use(InboxSettlementsContext)
}

export function FlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FlowContextValue | null>(null)
  const listeners = useRef(new Set<(event: FlowEvent) => void>())
  const settled = useRef(new Map<string, InboxOutcome>())
  const on = useCallback((listener: (event: FlowEvent) => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let restarted = false
    let epoch = 0
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let teardown = () => {}

    function connect() {
      if (stopped || restarted) return
      let active = true
      const abort = new AbortController()
      let subscription: FlowSubscription | undefined
      let closeStatus = () => {}
      const off: Array<() => void> = []
      const cleanup = () => {
        if (!active) return
        active = false
        for (const remove of off) remove()
        abort.abort()
        subscription?.close()
        closeStatus()
        void client.dispose().catch(() => {})
      }
      function fail() {
        if (!active || stopped || restarted) return
        setState((value) => value && { ...value, connected: false, status: undefined })
        cleanup()
        timer = setTimeout(
          () => {
            epoch++
            connect()
          },
          Math.min(500 * 2 ** failures++, 10_000),
        )
      }
      function restart() {
        if (stopped || restarted) return
        restarted = true
        if (timer != null) clearTimeout(timer)
        setState((value) => value && { ...value, connected: false, restarted: true })
        teardown()
      }
      const { client, control } = createFlowConnection(restart, fail)
      teardown = cleanup
      setState({
        client,
        control,
        epoch,
        status: undefined,
        connected: false,
        restarted: false,
        on,
      })
      off.push(client.events.on('transportError', fail), client.events.on('writeFailed', fail))
      client.signal.addEventListener('abort', fail)
      off.push(() => client.signal.removeEventListener('abort', fail))

      // Subscribe to status before info. An event after issuance supersedes its snapshot.
      const statusStream = client.createStream('events', { signal: abort.signal })
      closeStatus = () => statusStream.close()
      void statusStream.catch(fail)
      let infoIssued = false
      let statusAfterInfo = false
      void (async () => {
        const reader = statusStream.readable.getReader()
        try {
          while (active) {
            const result = await reader.read()
            if (result.done) {
              fail()
              break
            }
            if (result.value.type === 'service:status') {
              if (infoIssued) statusAfterInfo = true
              const status = result.value.data.status
              if (active) setState((value) => value && { ...value, status })
            }
          }
        } catch {
          fail()
        } finally {
          reader.releaseLock()
        }
      })()
      infoIssued = true
      void client
        .request('info', { signal: abort.signal })
        .then((info) => {
          if (active && !statusAfterInfo)
            setState((value) => value && { ...value, status: info.flowService })
        })
        .catch(fail)
      void (async () => {
        try {
          subscription = await control.subscribe(abort.signal)
          if (!active) {
            subscription.close()
            return
          }
          failures = 0
          setState((value) => value && { ...value, connected: true })
          for await (const event of subscription) {
            if (!active) break
            if (event.type === 'inbox:settled')
              settled.current.set(event.data.item.id, event.data.outcome)
            for (const listener of listeners.current) listener(event)
          }
          fail()
        } catch {
          fail()
        }
      })()
    }
    connect()
    return () => {
      stopped = true
      if (timer != null) clearTimeout(timer)
      teardown()
    }
  }, [on])

  return state == null ? null : (
    <FlowContext value={state}>
      <InboxSettlementsContext value={settled.current}>{children}</InboxSettlementsContext>
    </FlowContext>
  )
}
