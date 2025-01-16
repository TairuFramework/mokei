import { createLazyFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { useHost } from '../host/context.js'

function HomePage() {
  const client = useHost()
  useEffect(() => {
    client
      .request('info')
      .toValue()
      .then((info) => {
        console.log('info from host', info)
      })
  }, [client])

  return (
    <div className="p-2">
      <h3>Welcome Home!</h3>
    </div>
  )
}

export const Route = createLazyFileRoute('/')({
  component: HomePage,
})
