import { existsSync, openSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@enkaku/client'
import spawn from 'nano-spawn'

import { DEFAULT_SOCKET_PATH } from '../constants.js'
import type { ClientMessage, Protocol, ServerMessage } from '../protocol.js'
import { SocketTransport } from '../transport.js'

const DAEMON_FILE_PATH = fileURLToPath(import.meta.resolve('./process.js'))

export type HostClient = Client<Protocol>

export function createClient(path = DEFAULT_SOCKET_PATH): HostClient {
  const transport = new SocketTransport<ServerMessage, ClientMessage>({ socket: path })
  return new Client<Protocol>({ transport })
}

export type StartDaemonParams = { path?: string; force?: boolean }

export async function startDaemon(params: StartDaemonParams = {}): Promise<[string, string]> {
  const path = params.path ?? DEFAULT_SOCKET_PATH
  if (existsSync(path) && params.force) {
    rmSync(path)
  }

  // const out = openSync('./out.log', 'a')
  // const err = openSync('./out.log', 'a')

  // Run in the background - https://nodejs.org/api/child_process.html#optionsdetached
  try {
    const subprocess = spawn('node', [DAEMON_FILE_PATH, '--path', path], {
      detached: true,
      // stdio: 'pipe', //['ignore', out, err],
    })
    const childProcess = await subprocess.nodeChildProcess
    childProcess.unref()

    const result = await subprocess
    return [result.output, path]
  } catch (err) {
    return [(err as { output: string }).output, path]
  }
}
