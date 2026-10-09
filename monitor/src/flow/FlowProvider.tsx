import {
  createRemoteFlowControl,
  type FlowControl,
  type FlowEvent,
  type InboxOutcome,
} from '@mokei/flow-client'
import type { FlowServiceStatus } from '@mokei/host-protocol'
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useRef } from 'react'

import type { HostClient } from '../host/client.js'
import { useHostConnection } from '../host/useHostConnection.js'

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
  const { client, epoch, connected, restarted, subscribe, info } = useHostConnection()
  const control = useMemo(() => createRemoteFlowControl(client), [client])
  const listeners = useRef(new Set<(event: FlowEvent) => void>())
  const settled = useRef(new Map<string, InboxOutcome>())
  const on = useCallback((listener: (event: FlowEvent) => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  useEffect(() => {
    return subscribe(['run:state', 'inbox:added', 'inbox:settled'], (event) => {
      if (event.type === 'inbox:settled')
        settled.current.set(event.data.item.id, event.data.outcome)
      const flowEvent = { type: event.type, data: event.data } as FlowEvent
      for (const listener of listeners.current) listener(flowEvent)
    })
  }, [subscribe])

  const state: FlowContextValue = {
    client,
    control,
    epoch,
    connected,
    restarted,
    status: info?.flowService,
    on,
  }

  return (
    <FlowContext value={state}>
      <InboxSettlementsContext value={settled.current}>{children}</InboxSettlementsContext>
    </FlowContext>
  )
}
