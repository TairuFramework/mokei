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

import { join } from 'node:path'
import { createServerBridge } from '@enkaku/http-serve'
import { connectSocket, createTransportStream } from '@enkaku/socket'
import type { Protocol } from '@mokei/host-protocol'
import { Disposer } from '@sozai/async'
import { getSocketPath } from '@tejika/env'
import { createLocalServer, serveStaticSPA } from '@tejika/server'

import { wireMonitorStreams } from './pipes.js'

export type MonitorParams = {
  socketPath?: string
  port?: number
}

export type Monitor = {
  disposer: Disposer
  port: number
  token: string
  url: string
}

export async function startMonitor(params: MonitorParams = {}): Promise<Monitor> {
  const socketPath = params.socketPath ?? getSocketPath('mokei')
  const socketStream = await createTransportStream(connectSocket(socketPath))
  const serverBridge = createServerBridge<Protocol>()

  // `@tejika/server` builds the loopback Hono server (127.0.0.1 only),
  // generates the bearer token, and gates `/api` with the Host/Origin/token
  // defenses. We mount the Enkaku bridge handler behind that gate, then layer
  // the token-injected SPA on the same app.
  const { app, url, token, close } = await createLocalServer({ app: 'mokei', port: params.port })
  if (token == null) {
    throw new Error('Expected a bearer token from the loopback monitor server')
  }
  app.all('/api', (ctx) => serverBridge.handleRequest(ctx.req.raw))

  const distDir = join(import.meta.dirname, '../dist')
  serveStaticSPA(app, { dir: distDir, token })

  const pipes = wireMonitorStreams({
    socketReadable: socketStream.readable,
    socketWritable: socketStream.writable,
    bridgeReadable: serverBridge.stream.readable,
    bridgeWritable: serverBridge.stream.writable,
  })
  const disposer = new Disposer({
    dispose: async () => {
      await Promise.all([close(), pipes.dispose()])
    },
  })

  const port = Number.parseInt(new URL(url).port, 10)
  return { disposer, port, token, url }
}
