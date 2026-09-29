import { NodeStreamsTransport } from '@enkaku/node-streams'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { ContextServer, createTaskManager } from '@mokei/context-server'

import { createMokeiTasksConfig } from './tasks-fixture.ts'

const tasks = createTaskManager({ pollIntervalMs: 10 })
const transport = new NodeStreamsTransport<ClientMessage, ServerMessage>({
  streams: { readable: process.stdin, writable: process.stdout },
})
const server = new ContextServer({
  ...createMokeiTasksConfig(),
  transport,
  subscriptions: true,
  tasks,
})

process.stdin.on('end', () => {
  void server.dispose().then(() => tasks.dispose())
})
