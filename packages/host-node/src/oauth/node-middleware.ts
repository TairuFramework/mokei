import {
  type AuthorizationHandler,
  createOAuthMiddleware,
  type FetchMiddleware,
  type TokenStore,
} from '@mokei/http-client'

import { createFileTokenStore } from './file-store.js'
import { createLoopbackAuthorizationHandler } from './loopback.js'

export type NodeOAuthOptions = {
  clientId: string
  scopes?: Array<string>
  resource?: string
  /** File path for the persistent token store. Omit to keep tokens in-memory only. */
  tokensPath?: string
  /** Override the authorization handler (default: loopback browser handler). */
  handler?: AuthorizationHandler
  /** Override the token store (default: file store at tokensPath, else the middleware's in-memory default). */
  store?: TokenStore
  /** Browser-open timeout for the default loopback handler. */
  timeoutMs?: number
}

/**
 * Composes {@link createOAuthMiddleware} with Node-specific defaults: a loopback browser
 * authorization handler (RFC 8252) and, when `tokensPath` is given, a file-backed token store.
 */
export function createNodeOAuthMiddleware(options: NodeOAuthOptions): FetchMiddleware {
  const handler =
    options.handler ?? createLoopbackAuthorizationHandler({ timeoutMs: options.timeoutMs })
  const store =
    options.store ?? (options.tokensPath ? createFileTokenStore(options.tokensPath) : undefined)

  return createOAuthMiddleware({
    clientId: options.clientId,
    scopes: options.scopes,
    resource: options.resource,
    handler,
    store,
  })
}
