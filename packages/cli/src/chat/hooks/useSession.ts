import type { Session } from '@mokei/session'
import { useCallback, useEffect, useState } from 'react'

export type SessionLike = Pick<Session, 'addContext' | 'removeContext' | 'contextHost' | 'events'>

export function useSession(session: SessionLike) {
  const [contexts, setContexts] = useState<Array<string>>(() =>
    session.contextHost.getContextKeys(),
  )

  useEffect(() => {
    const offAdd = session.events.on('context-added', (e) => {
      setContexts((prev) => (prev.includes(e.key) ? prev : [...prev, e.key]))
    })
    const offRemove = session.events.on('context-removed', (e) => {
      setContexts((prev) => prev.filter((k) => k !== e.key))
    })
    return () => {
      offAdd()
      offRemove()
    }
  }, [session])

  const addContext = useCallback(
    (params: Parameters<Session['addContext']>[0]) => session.addContext(params),
    [session],
  )
  const removeContext = useCallback(
    (key: string): Promise<boolean> => session.removeContext(key),
    [session],
  )

  return { contexts, addContext, removeContext }
}
