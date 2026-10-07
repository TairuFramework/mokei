import { type AnyHTTPPlugin, definePlugin, type PluginName, pluginName } from '@sozai/http-server'
import { getAuthInfo, OAUTH_RESOURCE } from '@teikyo/oauth'
import type { Handler, MiddlewareHandler } from 'hono'

import { createHTTPHandler, type HTTPHandler, type HTTPHandlerParams } from './handler.js'

export type MokeiMCP = { handler: HTTPHandler }

export const MOKEI_MCP: PluginName<'mokei:mcp', MokeiMCP> = pluginName<MokeiMCP>()('mokei:mcp')

export type MCPPluginParams = HTTPHandlerParams & {
  path?: string
  auth?: { scopes?: Array<string> }
}

export function mcpPlugin(params: MCPPluginParams): AnyHTTPPlugin {
  const { path = '/mcp', auth } = params
  return definePlugin({
    name: MOKEI_MCP,
    dependsOn: auth == null ? [] : [OAUTH_RESOURCE],
    setup(ctx): MokeiMCP {
      const handler = createHTTPHandler(params)
      ctx.onShutdown(() => handler.shutdown())
      ctx.onClose(() => handler.dispose())
      ctx.limits(path, { bodyBytes: false, timeoutMs: false })
      const handlers: Array<Handler | MiddlewareHandler> = []
      if (auth != null) {
        handlers.push(ctx.use(OAUTH_RESOURCE).requireBearer({ scopes: auth.scopes }))
      }
      handlers.push((c) =>
        handler.handleRequest(c.req.raw, { auth: auth == null ? undefined : getAuthInfo(c) }),
      )
      ctx.route('all', path, ...handlers)
      return { handler }
    },
  })
}
