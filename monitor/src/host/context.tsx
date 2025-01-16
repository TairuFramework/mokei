import { type ReactNode, createContext, useContext } from 'react'

import { type HostClient, createClient } from './client.js'

export const HostContext = createContext<HostClient>(createClient('http://localhost:3001/api'))

export type HostProviderProps = {
  children: ReactNode
  client?: HostClient
}

export function HostProvider(props: HostProviderProps) {
  return props.client ? (
    <HostContext.Provider value={props.client}>{props.children}</HostContext.Provider>
  ) : (
    <>{props.children}</>
  )
}

export function useHost(): HostClient {
  return useContext(HostContext)
}
