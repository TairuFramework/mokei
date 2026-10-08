import { use } from 'react'

import { type HostConnection, HostConnectionContext } from './HostConnectionProvider.js'

export function useHostConnection(): HostConnection {
  const connection = use(HostConnectionContext)
  if (connection == null) throw new Error('A parent HostConnectionProvider is required')
  return connection
}
