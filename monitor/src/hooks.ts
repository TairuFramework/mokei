import type { StreamCall } from '@enkaku/client'
import type { HostEvent } from '@mokei/host-protocol'
import { useAtom } from 'jotai'
import { useEffect, useRef } from 'react'

import { useEventsStream } from './host/hooks.js'
import { hostEventsAtom, hostEventsCallAtom } from './state.js'

export function useHostEvents(): Array<HostEvent> {
  const call = useEventsStream()

  const [events, setEvents] = useAtom(hostEventsAtom)
  const [stored, setStored] = useAtom(hostEventsCallAtom)
  const callRef = useRef<StreamCall<HostEvent, void> | null>(null)

  useEffect(() => {
    if (stored.call === null && call != null) {
      setStored({ call })
    }
    if (call != null && callRef.current !== call) {
      callRef.current = call
      call.readable.pipeTo(
        new WritableStream({
          write(event) {
            setEvents((events) => [...events, event])
          },
        }),
      )
    }
  }, [call, setEvents, setStored, stored])

  return events
}
