import { type ServerType, serve } from '@hono/node-server'
import { Hono } from 'hono'

import { createHTTPHandler, type HTTPHandler, type HTTPHandlerParams } from './handler.js'

export type ServeHTTPParams = HTTPHandlerParams & {
  port?: number
  hostname?: string
  path?: string
}

export type ServeHTTPResult = {
  handler: HTTPHandler
  server: ServerType
  dispose: () => void
}

export function serveHTTP(params: ServeHTTPParams): ServeHTTPResult {
  const { port = 3000, hostname = '127.0.0.1', path = '/mcp', ...handlerParams } = params
  const handler = createHTTPHandler(handlerParams)

  const app = new Hono()
  app.all(path, async (ctx) => {
    return await handler.handleRequest(ctx.req.raw)
  })

  const server = serve({ fetch: app.fetch, port, hostname })

  return {
    handler,
    server,
    dispose: () => {
      handler.dispose()
      server.close()
    },
  }
}
