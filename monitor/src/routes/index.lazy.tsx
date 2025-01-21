import { createLazyFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useEventsStreamReadable, useHostInfo } from '../host/hooks.js'

function HomePage() {
  const hostInfo = useHostInfo()
  useEffect(() => {
    if (hostInfo != null) {
      console.log('host info', hostInfo)
    }
  }, [hostInfo])

  const eventsStream = useEventsStreamReadable()
  useEffect(() => {
    console.log('got events stream')
    if (eventsStream != null) {
      eventsStream.pipeTo(
        new WritableStream({
          write(event) {
            console.log('event from stream', event)
          },
        }),
      )
    }
  }, [eventsStream])

  return (
    <div className="p-2">
      <h3>Welcome Home!</h3>
    </div>
  )
}

export const Route = createLazyFileRoute('/')({
  component: HomePage,
})
