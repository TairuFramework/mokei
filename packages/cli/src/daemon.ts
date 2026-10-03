import { fileURLToPath } from 'node:url'
import { type HostClient, runDaemon } from '@mokei/host-node'

const DAEMON_ENTRY = fileURLToPath(new URL('./daemon-entry.js', import.meta.url))

export function ensureMokeiDaemon(options: { socketPath?: string }): Promise<HostClient> {
  return runDaemon({ socketPath: options.socketPath, entry: DAEMON_ENTRY })
}
