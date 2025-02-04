/**
 * Mokei Host monitor.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/host-monitor
 * ```
 *
 * @module host-monitor
 */

import { Disposer, defer } from '@enkaku/async'
import { createServerBridge } from '@enkaku/http-server-transport'
import { connectSocket, createTransportStream } from '@enkaku/socket-transport'
import { type ServerType, serve } from '@hono/node-server'
import { DEFAULT_SOCKET_PATH, type Protocol } from '@mokei/host-protocol'
import getPort from 'get-port'
import { Hono } from 'hono'

export type MonitorParams = {
  socketPath?: string
  port?: number
}

export type Monitor = {
  disposer: Disposer
  port: number
  server: ServerType
}

export async function startMonitor(params: MonitorParams = {}): Promise<Monitor> {
  const socketPath = params.socketPath ?? DEFAULT_SOCKET_PATH
  const socketStream = await createTransportStream(connectSocket(socketPath))
  const serverBridge = createServerBridge<Protocol>()

  const app = new Hono()
  app.all('/api', (ctx) => serverBridge.handleRequest(ctx.req.raw))

  const port = await getPort({ port: params.port ?? 3001 })
  const server = serve({ fetch: app.fetch, port })
  const serverClosed = defer<void>()
  server.on('close', () => {
    serverClosed.resolve()
  })

  const decoupled = Promise.all([
    socketStream.readable.pipeTo(serverBridge.stream.writable),
    serverBridge.stream.readable.pipeTo(socketStream.writable),
  ])
  const disposer = new Disposer({
    dispose: async () => {
      server.close()
      serverBridge.stream.writable.close()
      socketStream.writable.close()
      await Promise.all([serverClosed, decoupled])
    },
  })

  return { disposer, port, server }
}
