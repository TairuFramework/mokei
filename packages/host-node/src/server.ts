import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { HostEvents } from '@mokei/host-protocol'
import { EventEmitter } from '@sozai/event'

import { serveHostDaemon } from './daemon-server.js'

export { createHandlers, type HandlersContext, killChildren } from './daemon-server.js'

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { 'socket-path': { type: 'string', short: 'p' } },
    strict: false,
  })
  const socketPath = typeof values['socket-path'] === 'string' ? values['socket-path'] : undefined
  await serveHostDaemon({ socketPath, events: new EventEmitter<HostEvents>() })
}
