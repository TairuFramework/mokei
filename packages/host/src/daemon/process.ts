import { parseArgs } from 'node:util'
import { DEFAULT_SOCKET_PATH } from '@mokei/host-protocol'

import { startServer } from '../server.js'
import { isSocketLive, safeRemove } from './socket.js'

const args = parseArgs({
  options: {
    path: {
      type: 'string',
      short: 'p',
      default: DEFAULT_SOCKET_PATH,
    },
  },
  strict: false,
})
const socketPath = args.values.path as string

// Split-brain guard: if a live daemon already owns the socket, do not disturb it
// (blindly removing the socket would orphan that daemon's children).
if (await isSocketLive(socketPath)) {
  process.exit(0)
}
// Stale socket file (no listener): safe to remove before binding.
safeRemove(socketPath)

const { server, dispose } = await startServer({
  socketPath,
  shutdown: () => {
    server.close()
    safeRemove(socketPath)
  },
})

// Run the shutdown path on termination so we never leak the socket file or
// spawned MCP children.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void dispose().finally(() => process.exit(0))
  })
}
