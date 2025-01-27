import type { Protocol } from '@mokei/host-protocol'

import { useCall, useCallStateResult } from '../enkaku/call.js'
import { useContext } from '../enkaku/context.js'
import { useRequestState } from '../enkaku/request.js'
import { useStreamState } from '../enkaku/stream.js'

import type { HostClient } from './client.js'

export function useClient(): HostClient {
  return useContext().client
}

export function useEventsStreamReadable() {
  const state = useStreamState<Protocol>({ procedure: 'events' })
  return useCall(state)?.readable
}

export function useHostInfo() {
  const state = useRequestState<Protocol>({ procedure: 'info' })
  return useCallStateResult(state)
}
