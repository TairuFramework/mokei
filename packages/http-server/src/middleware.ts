import type { MiddlewareHandler } from 'hono'

import { createHTTPHandler, type HTTPHandlerParams } from './handler.js'

export function mcpHTTPMiddleware(params: HTTPHandlerParams): MiddlewareHandler {
  const handler = createHTTPHandler(params)

  return async (ctx) => {
    const response = await handler.handleRequest(ctx.req.raw)
    return response
  }
}
