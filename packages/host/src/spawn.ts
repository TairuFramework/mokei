import type { ChildProcess, IOType } from 'node:child_process'
import type { Writable } from 'node:stream'
import type { Streams } from '@enkaku/node-streams-transport'
import spawn, { type Subprocess, SubprocessError } from 'nano-spawn'

import { filterEnv } from './utils.js'

export function isSubprocessExit(reason: unknown): boolean {
  return (
    reason instanceof SubprocessError &&
    reason.signalName != null &&
    ['SIGINT', 'SIGTERM'].includes(reason.signalName)
  )
}

export type StderrOption = IOType | number | Writable

export type SpawnContextServerParams = {
  command: string
  args?: Array<string>
  env?: Record<string, string | null | undefined>
  stderr?: StderrOption
}

export type SpawnedContext = {
  childProcess: ChildProcess
  streams: Streams
  subprocess: Subprocess
}

export async function spawnContextServer(
  params: SpawnContextServerParams,
): Promise<SpawnedContext> {
  const subprocess = spawn(params.command, params.args ?? [], {
    stdio: ['pipe', 'pipe', params.stderr ?? 'ignore'],
    env: filterEnv(params.env),
  })
  // Guard the subprocess promise so an abnormal exit or spawn failure is never an
  // unhandled rejection. Callers observe the real outcome via `subprocess` (see
  // ContextHost.addLocalContext) or via the throw below on spawn failure.
  subprocess.catch(() => {})

  const childProcess = await subprocess.nodeChildProcess
  const [stdin, stdout] = childProcess.stdio
  if (stdin == null || stdout == null) {
    throw new Error('Failed to spawn subprocess')
  }

  return { childProcess, subprocess, streams: { readable: stdout, writable: stdin } }
}
