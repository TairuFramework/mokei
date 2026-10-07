import { createServer, definePlugin, type HTTPServer } from '@sozai/http-server'
import { type OAuthTokenVerifier, oauthResourcePlugin } from '@teikyo/oauth'

import type { HTTPHandler, HTTPHandlerParams } from './handler.js'
import { MOKEI_MCP, mcpPlugin } from './plugin.js'

export type ServeHTTPParams = HTTPHandlerParams & {
  port?: number
  hostname?: string
  path?: string
  auth?: {
    verifier: OAuthTokenVerifier
    resource: string
    authorizationServers: Array<string>
    requiredScopes?: Array<string>
  }
}

export type ServeHTTPResult = {
  handler: HTTPHandler
  server: HTTPServer
  dispose: () => Promise<void>
}

export async function serveHTTP(params: ServeHTTPParams): Promise<ServeHTTPResult> {
  const { port = 3000, hostname = '127.0.0.1', path = '/mcp', auth, ...handlerParams } = params
  let handler!: HTTPHandler
  const server = await createServer({
    port,
    hostname,
    plugins: [
      ...(auth == null ? [] : [oauthResourcePlugin(auth)]),
      mcpPlugin({ ...handlerParams, path, auth: auth && { scopes: auth.requiredScopes } }),
      definePlugin({
        name: 'mokei:serve',
        dependsOn: [MOKEI_MCP],
        setup(ctx) {
          handler = ctx.use(MOKEI_MCP).handler
        },
      }),
    ],
  })
  await server.listen()
  return { handler, server, dispose: () => server.dispose() }
}
