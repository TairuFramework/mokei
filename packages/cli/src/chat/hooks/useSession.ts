import type { Session } from '@mokei/session'
import type { NodeSession } from '@mokei/session-node'
import { useCallback, useEffect, useState } from 'react'

export type SessionLike = Pick<
  NodeSession,
  'addContext' | 'addHTTPContext' | 'removeContext' | 'contextHost' | 'events'
>

export function useSession(session: SessionLike) {
  const [contexts, setContexts] = useState<Array<string>>(() => {
    return session.contextHost.getContextKeys()
  })

  useEffect(() => {
    const offAdd = session.events.on('context-added', (e) => {
      setContexts((prev) => (prev.includes(e.key) ? prev : [...prev, e.key]))
    })
    const offRemove = session.events.on('context-removed', (e) => {
      setContexts((prev) => prev.filter((k) => k !== e.key))
    })
    // The host removes a context on its own when a reconnect gives up.
    const offHostRemove = session.contextHost.events.on('context:removed', (e) => {
      setContexts((prev) => prev.filter((k) => k !== e.key))
    })
    return () => {
      offAdd()
      offRemove()
      offHostRemove()
    }
  }, [session])

  const addContext = useCallback(
    (params: Parameters<NodeSession['addContext']>[0]) => session.addContext(params),
    [session],
  )
  const addHTTPContext = useCallback(
    (params: Parameters<Session['addHTTPContext']>[0]) => session.addHTTPContext(params),
    [session],
  )
  const removeContext = useCallback(
    (key: string): Promise<boolean> => session.removeContext(key),
    [session],
  )

  return { contexts, addContext, addHTTPContext, removeContext }
}
