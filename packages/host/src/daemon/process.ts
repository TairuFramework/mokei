import { existsSync, rmSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { DEFAULT_SOCKET_PATH } from '@mokei/host-protocol'

import { startServer } from '../server.js'

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

if (existsSync(socketPath)) {
  rmSync(socketPath)
}
const server = await startServer({
  socketPath,
  shutdown: () => {
    server.close()
    if (existsSync(socketPath)) {
      rmSync(socketPath)
    }
  },
})
