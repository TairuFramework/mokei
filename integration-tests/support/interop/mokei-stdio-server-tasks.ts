import { NodeStreamsTransport } from '@enkaku/node-streams'
import type { ClientMessage, ServerMessage } from '@mokei/context-protocol'
import { ContextServer, createTaskManager } from '@mokei/context-server'

import { createMokeiTasksConfig } from './tasks-fixture.ts'

const pollIntervalMs = Number(process.argv[2] ?? 60_000)
const tasks = createTaskManager({ pollIntervalMs })
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
