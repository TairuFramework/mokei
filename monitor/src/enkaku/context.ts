import type { Client } from '@enkaku/client'
import type { ProtocolDefinition } from '@enkaku/protocol'
import { createContext, use } from 'react'

export type EnkakuContextType<Protocol extends ProtocolDefinition> = {
  client: Client<Protocol>
}

export const EnkakuContext = createContext<EnkakuContextType<ProtocolDefinition> | null>(null)

export function useContext<Protocol extends ProtocolDefinition>(): EnkakuContextType<Protocol> {
  const context = use(EnkakuContext)
  if (context == null) {
    throw new Error('Enkaku context missing, a parent EnkakuProvider must be used')
  }
  return context
}
