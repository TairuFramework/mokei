import { openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@enkaku/client'
import { SocketTransport, connectSocket } from '@enkaku/socket-transport'
import {
  type ClientMessage,
  DEFAULT_SOCKET_PATH,
  type Protocol,
  type ServerMessage,
} from '@mokei/host-protocol'
import spawn from 'nano-spawn'

const PROCESS_SCRIPT_PATH = fileURLToPath(import.meta.resolve('./process.js'))

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
  const socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH
  const out = options.outFile ? openSync(options.outFile, 'a') : 'ignore'
  const err = options.errFile ? openSync(options.errFile, 'a') : 'ignore'
  const subprocess = spawn('node', [PROCESS_SCRIPT_PATH, '--path', socketPath], {
    detached: true,
    stdio: ['ignore', out, err],
  })
  const childProcess = await subprocess.nodeChildProcess
  childProcess.unref()
}

export async function runDaemon(options: DaemonOptions = {}): Promise<HostClient> {
  try {
    return await createClient(options.socketPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await spawnDaemon(options)
      return await createClient(options.socketPath)
    }
    throw err
  }
}
