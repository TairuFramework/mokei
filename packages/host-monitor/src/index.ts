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

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { Disposer, defer } from '@enkaku/async'
import { createServerBridge } from '@enkaku/http-server-transport'
import { connectSocket, createTransportStream } from '@enkaku/socket-transport'
import { type ServerType, serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { DEFAULT_SOCKET_PATH, type Protocol } from '@mokei/host-protocol'
import getPort from 'get-port'
import { Hono } from 'hono'

import { buildAllowedHosts, verifyApiRequest } from './auth.js'
import { injectToken } from './html.js'

export type MonitorParams = {
  socketPath?: string
  port?: number
  host?: string
}

export type Monitor = {
  disposer: Disposer
  host: string
  port: number
  server: ServerType
  token: string
}

export async function startMonitor(params: MonitorParams = {}): Promise<Monitor> {
  const host = params.host ?? '127.0.0.1'
  const socketPath = params.socketPath ?? DEFAULT_SOCKET_PATH
  const socketStream = await createTransportStream(connectSocket(socketPath))
  const serverBridge = createServerBridge<Protocol>()
  const token = randomBytes(32).toString('hex')

  const distDir = join(import.meta.dirname, '../dist')
  const indexHTML = injectToken(await readFile(join(distDir, 'index.html'), 'utf8'), token)

  const port = await getPort({ port: params.port })
  const allowedHosts = buildAllowedHosts(host, port)

  const app = new Hono()
  app.all('/api', (ctx) => {
    return verifyApiRequest(ctx.req.raw, { token, allowedHosts })
      ? serverBridge.handleRequest(ctx.req.raw)
      : ctx.text('Forbidden', 403)
  })
  // Serve the token-injected HTML for the entry point and SPA fallback; let
  // serveStatic handle real asset files only.
  app.get('/', (ctx) => ctx.html(indexHTML))
  app.use('/*', serveStatic({ root: relative(process.cwd(), distDir) }))
  app.notFound((ctx) => ctx.html(indexHTML))

  const server = serve({ fetch: app.fetch, port, hostname: host })
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

  return { disposer, host, port, server, token }
}
