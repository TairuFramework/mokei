import type { Client } from '@enkaku/client'
import type { ProtocolDefinition } from '@enkaku/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { type Environment, EnvironmentContext, type EnvironmentParams } from './context.js'

export type EnkakuProviderProps<Protocol extends ProtocolDefinition> =
  EnvironmentParams<Protocol> & {
    children: ReactNode
  }

export function EnkakuProvider<Protocol extends ProtocolDefinition>(
  props: EnkakuProviderProps<Protocol>,
) {
  const { children, createClient, handleAbort } = props

  const clientRef = useRef<Client<Protocol> | null>(null)
  const [state, setState] = useState<Environment<Protocol>>(() => {
    return { status: 'connected', client: createClient() }
  })

  useEffect(() => {
    if (state.status === 'connected' && clientRef.current !== state.client) {
      state.client.signal.addEventListener('abort', () => {
        const reason = state.client.signal.reason
        const client = handleAbort?.(reason)
        setState(
          client
            ? { status: 'connected', client }
            : {
                status: 'disconnected',
                reason,
                connect: () => {
                  setState({ status: 'connected', client: createClient() })
                },
              },
        )
      })
      clientRef.current = state.client
    }
  }, [createClient, handleAbort, state])

  return <EnvironmentContext.Provider value={state}>{children}</EnvironmentContext.Provider>
}
