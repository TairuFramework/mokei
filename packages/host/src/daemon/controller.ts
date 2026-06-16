import { openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@enkaku/client'
import { connectSocket, SocketTransport } from '@enkaku/socket-transport'
import {
  type ClientMessage,
  DEFAULT_SOCKET_PATH,
  type Protocol,
  type ServerMessage,
} from '@mokei/host-protocol'
import spawn from 'nano-spawn'

import { safeRemove, waitForSocket } from './socket.js'

export type HostClient = Client<Protocol>

export async function createClient(socketPath = DEFAULT_SOCKET_PATH): Promise<HostClient> {
  const socket = await connectSocket(socketPath)
  const transport = new SocketTransport<ServerMessage, ClientMessage>({ socket })
  return new Client<Protocol>({ transport })
}

export type DaemonOptions = {
  errFile?: string
  outFile?: string
  socketPath?: string
}

export async function spawnDaemon(options: DaemonOptions = {}): Promise<void> {
  const scriptPath = fileURLToPath(import.meta.resolve('./process.js'))
  const socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH
  const out = options.outFile ? openSync(options.outFile, 'a') : 'ignore'
  const err = options.errFile ? openSync(options.errFile, 'a') : 'ignore'
  const subprocess = spawn('node', [scriptPath, '--path', socketPath], {
    detached: true,
    stdio: ['ignore', out, err],
  })
  // Dereference child process so it can be garbage collected
  const childProcess = await subprocess.nodeChildProcess
  childProcess.unref()
  // Wait for the socket to accept connections (poll with backoff instead of a
  // fixed delay that spuriously fails on slow startup).
  await waitForSocket(socketPath)
}

export async function runDaemon(options: DaemonOptions = {}): Promise<HostClient> {
  const socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH
  try {
    return await createClient(socketPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ECONNREFUSED' || code === 'ENOENT') {
      if (code === 'ECONNREFUSED') {
        safeRemove(socketPath)
      }
      await spawnDaemon(options)
      return await createClient(socketPath)
    }
    throw err
  }
}
