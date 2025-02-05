import type { StreamCall } from '@enkaku/client'
import type { HostEvent, Protocol } from '@mokei/host-protocol'

import { useCall, useCallStateResult } from '../enkaku/call.js'
import { useRequestState } from '../enkaku/request.js'
import { useStreamState } from '../enkaku/stream.js'

export function useEventsStream() {
  const state = useStreamState<Protocol>({ procedure: 'events' })
  return useCall(state) as StreamCall<HostEvent, void>
}

export function useHostInfo() {
  const state = useRequestState<Protocol>({ procedure: 'info' })
  return useCallStateResult(state)
}
