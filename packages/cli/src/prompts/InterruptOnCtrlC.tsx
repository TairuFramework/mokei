import { useInput } from 'ink'
import type { ReactNode } from 'react'

/**
 * Re-raises Ctrl-C as SIGINT. Ink's raw mode swallows the terminal's SIGINT, so a prompt rendered
 * with `exitOnCtrlC: false` uses this to reach the command's signal handlers: `withCommandSignal`
 * aborts the command, which closes the prompt. Without a handler the process exits as usual.
 */
export function InterruptOnCtrlC({ children }: { children?: ReactNode }) {
  useInput((input, key) => {
    if (key.ctrl && input === 'c') process.kill(process.pid, 'SIGINT')
  })
  return children
}
