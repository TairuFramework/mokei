import type { Client } from '@enkaku/client'
import type { ProtocolDefinition } from '@enkaku/protocol'
import type { Protocol as HostProtocol } from '@mokei/host-protocol'
import { type ReactNode, createContext, useContext } from 'react'

import { createClient } from './client.js'

type EnkakuContextType<Protocol extends ProtocolDefinition> = {
  client: Client<Protocol>
}

function createEnkakuContext<Protocol extends ProtocolDefinition>(
  context: EnkakuContextType<Protocol>,
): React.Context<EnkakuContextType<Protocol>> {
  return createContext<EnkakuContextType<Protocol>>(context)
}

export const EnkakuContext = createEnkakuContext<HostProtocol>({
  client: createClient('http://localhost:3001/api'),
})

export type EnkakuProviderProps<Protocol extends ProtocolDefinition> = {
  children: ReactNode
  client?: Client<Protocol>
}

export function EnkakuProvider<Protocol extends ProtocolDefinition>(
  props: EnkakuProviderProps<Protocol>,
) {
  return props.client ? (
    <EnkakuContext.Provider value={{ client: props.client }}>
      {props.children}
    </EnkakuContext.Provider>
  ) : (
    <>{props.children}</>
  )
}

export function useClient<Protocol extends ProtocolDefinition>(): Client<Protocol> {
  return useContext(EnkakuContext).client
}
