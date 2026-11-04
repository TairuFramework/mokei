import { type AnyHTTPPlugin, definePlugin, type PluginName, pluginName } from '@sozai/http-server'
import { getAuthInfo, OAUTH_RESOURCE } from '@teikyo/oauth'
import type { Handler, MiddlewareHandler } from 'hono'

import { createHTTPHandler, type HTTPHandler, type HTTPHandlerParams } from './handler.js'

export type MokeiMCP = { handler: HTTPHandler }

export const MOKEI_MCP: PluginName<'mokei:mcp', MokeiMCP> = pluginName<MokeiMCP>()('mokei:mcp')

export type MCPPluginParams = HTTPHandlerParams & {
  path?: string
  /**
   * Gates the route with the `OAUTH_RESOURCE` bearer middleware. `scopes` are required on every
   * request; a tool's own `scopes` are checked per call, answering `403 insufficient_scope` with
   * a challenge naming both sets.
   */
  auth?: { scopes?: Array<string> }
}

export function mcpPlugin(params: MCPPluginParams): AnyHTTPPlugin {
  const { path = '/mcp', auth } = params
  return definePlugin({
    name: MOKEI_MCP,
    dependsOn: auth == null ? [] : [OAUTH_RESOURCE],
    setup(ctx): MokeiMCP {
      const handler = createHTTPHandler(
        auth == null
          ? params
          : {
              ...params,
              oauth: {
                resourceMetadataURL: ctx.use(OAUTH_RESOURCE).metadataURL,
                requiredScopes: auth.scopes,
                ...params.oauth,
              },
            },
      )
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
