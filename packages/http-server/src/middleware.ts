import type { MiddlewareHandler } from 'hono'

import { createHTTPHandler, type HTTPHandlerParams } from './handler.js'

export type MCPMiddlewareResult = {
  middleware: MiddlewareHandler
  dispose: () => void
}

export function mcpHTTPMiddleware(params: HTTPHandlerParams): MCPMiddlewareResult {
  const handler = createHTTPHandler(params)

  const middleware: MiddlewareHandler = async (ctx) => {
    const response = await handler.handleRequest(ctx.req.raw)
    return response
  }

  return {
    middleware,
    dispose: () => handler.dispose(),
  }
}
