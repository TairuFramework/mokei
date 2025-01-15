import { NodeStreamsTransport, type Streams } from '@enkaku/node-streams-transport'
import type { ClientTransport } from '@mokei/context-client'
import spawn, { type Subprocess, SubprocessError } from 'nano-spawn'

export function createTransport(streams: Streams): ClientTransport {
  return new NodeStreamsTransport({ streams }) as ClientTransport
}

export function isSubprocessExit(reason: unknown): boolean {
  return (
    reason instanceof SubprocessError &&
    reason.signalName != null &&
    ['SIGINT', 'SIGTERM'].includes(reason.signalName)
  )
}

export type SpawnedServer = Streams & { subprocess: Subprocess }

export async function spawnServer(
  command: string,
  args: Array<string> = [],
): Promise<SpawnedServer> {
  const subprocess = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] })
  subprocess.catch((err) => {
    if (!isSubprocessExit(err)) {
      throw err
    }
  })

  const [stdin, stdout] = (await subprocess.nodeChildProcess).stdio
  if (stdin == null || stdout == null) {
    throw new Error('Failed to spawn subprocess')
  }

  return { subprocess, readable: stdout, writable: stdin }
}
