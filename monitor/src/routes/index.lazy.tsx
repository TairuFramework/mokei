import type { Protocol } from '@mokei/host-protocol'
import { createLazyFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useClient } from '../host/context.js'
import { useStreamState } from '../host/hooks.js'

function HomePage() {
  const client = useClient<Protocol>()
  useEffect(() => {
    client.request('info').then((info) => {
      console.log('info from host', info)
    })
  }, [client])

  const streamState = useStreamState<Protocol>({ procedure: 'events' })
  useEffect(() => {
    console.log('events stream status', streamState.status)
    if (streamState.status === 'active') {
      streamState.call.readable.pipeTo(
        new WritableStream({
          write(event) {
            console.log('event from stream', event)
          },
        }),
      )
    }
  }, [streamState])

  return (
    <div className="p-2">
      <h3>Welcome Home!</h3>
    </div>
  )
}

export const Route = createLazyFileRoute('/')({
  component: HomePage,
})
