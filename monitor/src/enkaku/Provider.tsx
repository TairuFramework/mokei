import type { Client } from '@enkaku/client'
import type { ProtocolDefinition } from '@enkaku/protocol'
import type { ReactNode } from 'react'

import { EnkakuContext } from './context.js'

export type EnkakuProviderProps<Protocol extends ProtocolDefinition> = {
  children: ReactNode
  client: Client<Protocol>
}

export function EnkakuProvider<Protocol extends ProtocolDefinition>(
  props: EnkakuProviderProps<Protocol>,
) {
  return (
    <EnkakuContext.Provider value={{ client: props.client }}>
      {props.children}
    </EnkakuContext.Provider>
  )
}
