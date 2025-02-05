import type { Client } from '@enkaku/client'
import type { ProtocolDefinition } from '@enkaku/protocol'
import { createContext, use } from 'react'

export type Environment<Protocol extends ProtocolDefinition> =
  | { status: 'connected'; client: Client<Protocol> }
  | { status: 'disconnected'; reason?: unknown; connect: () => void }

export type EnvironmentParams<Protocol extends ProtocolDefinition> = {
  createClient: () => Client<Protocol>
  handleAbort?: (reason?: unknown) => Client<Protocol> | undefined
}

export const EnvironmentContext = createContext<Environment<ProtocolDefinition> | null>(null)

export function useEnvironment<Protocol extends ProtocolDefinition>(): Environment<Protocol> {
  const context = use(EnvironmentContext)
  if (context == null) {
    throw new Error('Enkaku environment context is missing, a parent EnkakuProvider must be used')
  }
  return context
}
