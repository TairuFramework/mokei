import type { ChildProcess, IOType } from 'node:child_process'
import type { Writable } from 'node:stream'
import type { Streams } from '@enkaku/node-streams-transport'
import spawn, { type Subprocess, SubprocessError } from 'nano-spawn'

import { filterEnv } from './utils.js'

function isSubprocessExit(reason: unknown): boolean {
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
  subprocess.catch((err) => {
    if (!isSubprocessExit(err)) {
      throw err
    }
  })

  const childProcess = await subprocess.nodeChildProcess
  const [stdin, stdout] = childProcess.stdio
  if (stdin == null || stdout == null) {
    throw new Error('Failed to spawn subprocess')
  }

  return { childProcess, subprocess, streams: { readable: stdout, writable: stdin } }
}
