import {
  type CreateServerParams,
  createServer,
  definePlugin,
  type HTTPServer,
} from '@sozai/http-server'
import { type OAuthTokenVerifier, oauthResourcePlugin } from '@teikyo/oauth'

import type { HTTPHandler, HTTPHandlerParams } from './handler.js'
import { MOKEI_MCP, mcpPlugin } from './plugin.js'

export type ServeHTTPParams = HTTPHandlerParams &
  Pick<CreateServerParams, 'graceMs' | 'signal' | 'logger'> & {
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

/**
 * `dispose()` runs graceful shutdown first, ending subscriptions with terminal frames.
 * In-flight stateless requests may hold disposal up to `graceMs`.
 * `server` is a Sozai `HTTPServer` whose `url` includes the bound port.
 */
export type ServeHTTPResult = {
  handler: HTTPHandler
  server: HTTPServer
  dispose: () => Promise<void>
}

/**
 * Starts a Sozai HTTP server. See {@link ServeHTTPResult} for graceful disposal and the bound URL.
 */
export async function serveHTTP(params: ServeHTTPParams): Promise<ServeHTTPResult> {
  const {
    port = 3000,
    hostname = '127.0.0.1',
    path = '/mcp',
    auth,
    graceMs,
    signal,
    ...handlerParams
  } = params
  let handler!: HTTPHandler
  const server = await createServer({
    port,
    hostname,
    graceMs,
    signal,
    logger: params.logger,
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
