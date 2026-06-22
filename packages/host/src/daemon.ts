import { fileURLToPath } from 'node:url'
import type { Client } from '@enkaku/client'
import type { Protocol } from '@mokei/host-protocol'
import { createDaemonClient, ensureDaemon } from '@tejika/process'

export type HostClient = Client<Protocol>

export type DaemonOptions = {
  socketPath?: string
}

const DAEMON_ENTRY = fileURLToPath(new URL('./server.js', import.meta.url))

/**
 * Connect to a running daemon. Throws if the socket is absent or refused.
 * Uses `@tejika/env` default socket path for app "mokei" when `socketPath` is omitted.
 */
export async function createClient(socketPath?: string): Promise<HostClient> {
  return createDaemonClient<Protocol>({ app: 'mokei', socketPath })
}

/**
 * Ensure a daemon is running and return a connected client. Spawns the daemon
 * on first call (or after a crash) and reconnects automatically.
 */
export async function runDaemon(options: DaemonOptions = {}): Promise<HostClient> {
  return ensureDaemon<Protocol>({
    app: 'mokei',
    entry: DAEMON_ENTRY,
    socketPath: options.socketPath,
  })
}
