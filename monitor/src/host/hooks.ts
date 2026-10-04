import { useCall, useEnkakuClient } from '@enkaku/react'
import type { Protocol } from '@mokei/host-protocol'
import { useRef } from 'react'

import { useFlow } from '../flow/FlowProvider.js'

export function useEventsStream() {
  const client = useEnkakuClient<Protocol>()
  const { connected } = useFlow()
  const { data } = useCall(async () => {
    if (!connected) return null
    // Wrap the thenable: await must not wait for the stream to finish.
    const [call] = client.createStream('events')
    void call.catch(() => {})
    return { call }
  }, [client, connected])
  // The atom-backed reader keeps collecting events when the page unmounts.
  return data?.call
}

export function useHostInfo() {
  const client = useEnkakuClient<Protocol>()
  const { connected } = useFlow()
  const { data } = useCall(
    async (signal) => {
      if (!connected) return null
      const [call] = client.request('info', { signal })
      return await call
    },
    [client, connected],
  )
  const latest = useRef(data)
  if (data != null) latest.current = data
  return latest.current ?? undefined
}
