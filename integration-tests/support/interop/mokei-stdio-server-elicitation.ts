import { serveProcess } from '@mokei/context-server-node'

import { create2025ElicitationConfig } from './session-elicitation-fixture.ts'

let clientCapabilities: unknown
const server = serveProcess(create2025ElicitationConfig(() => clientCapabilities))
server.events.on('initialize', ({ capabilities }) => {
  clientCapabilities = capabilities
})
