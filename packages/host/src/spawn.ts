import type { ChildProcess } from 'node:child_process'
import type { Streams } from '@enkaku/node-streams-transport'
import spawn, { type Subprocess, SubprocessError } from 'nano-spawn'

function isSubprocessExit(reason: unknown): boolean {
  return (
    reason instanceof SubprocessError &&
    reason.signalName != null &&
    ['SIGINT', 'SIGTERM'].includes(reason.signalName)
  )
}

export type SpawnedContext = {
  childProcess: ChildProcess
  streams: Streams
  subprocess: Subprocess
}

export async function spawnContextServer(
  command: string,
  args: Array<string> = [],
): Promise<SpawnedContext> {
  const subprocess = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] })
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
