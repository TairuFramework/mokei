import { type ServerType, serve } from '@hono/node-server'
import { Hono } from 'hono'

import {
  protectedResourceMetadataPath,
  protectedResourceMetadataResponse,
} from './auth/metadata.js'
import { type BearerAuthOptions, createBearerAuthGate } from './auth/require-bearer.js'
import { createHTTPHandler, type HTTPHandler, type HTTPHandlerParams } from './handler.js'

export type ServeHTTPParams = HTTPHandlerParams & {
  port?: number
  hostname?: string
  path?: string
  auth?: BearerAuthOptions & { authorizationServers: Array<string> }
}

export type ServeHTTPResult = {
  handler: HTTPHandler
  server: ServerType
  /**
   * Tears everything down: awaits the handler's disposal (which flushes in-flight
   * `subscriptions/listen` terminals, bounded) *before* closing the Node server, so the socket
   * stays open long enough for those terminal writes to reach their clients.
   */
  dispose: () => Promise<void>
}

export function serveHTTP(params: ServeHTTPParams): ServeHTTPResult {
  const { port = 3000, hostname = '127.0.0.1', path = '/mcp', ...handlerParams } = params
  const handler = createHTTPHandler(handlerParams)

  const app = new Hono()

  if (params.auth) {
    const auth = params.auth
    const gate = createBearerAuthGate(auth)
    const metaPath = protectedResourceMetadataPath(auth.resource)
    app.get(metaPath, () =>
      protectedResourceMetadataResponse({
        resource: auth.resource,
        authorizationServers: auth.authorizationServers,
      }),
    )
    app.all(path, async (ctx) => {
      const { response } = await gate(ctx.req.raw)
      if (response) return response
      return await handler.handleRequest(ctx.req.raw)
    })
  } else {
    app.all(path, async (ctx) => {
      return await handler.handleRequest(ctx.req.raw)
    })
  }

  const server = serve({ fetch: app.fetch, port, hostname })

  return {
    handler,
    server,
    dispose: async () => {
      await handler.dispose()
      server.close()
    },
  }
}
