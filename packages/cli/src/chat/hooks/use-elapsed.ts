import { useEffect, useState } from 'react'

/**
 * Returns a millisecond timestamp that updates once per second while `active`.
 * Used to drive an elapsed-time display when no other events fire (e.g. a tool
 * call that hangs). Returns a stable timestamp when inactive.
 */
export function useElapsed(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) {
      return
    }
    setNow(Date.now())
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(interval)
    }
  }, [active])

  return now
}
