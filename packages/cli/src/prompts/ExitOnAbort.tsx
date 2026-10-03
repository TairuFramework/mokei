import { useApp } from 'ink'
import { type ReactNode, useEffect } from 'react'

/** Exits the surrounding Ink app (unmounting the prompt) when `signal` aborts. */
export function ExitOnAbort({ signal, children }: { signal: AbortSignal; children?: ReactNode }) {
  const { exit } = useApp()
  useEffect(() => {
    if (signal.aborted) {
      exit()
      return
    }
    const onAbort = () => exit()
    signal.addEventListener('abort', onAbort, { once: true })
    return () => signal.removeEventListener('abort', onAbort)
  }, [signal, exit])
  return children
}
