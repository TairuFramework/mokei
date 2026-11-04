import {
  type AuthorizationHandler,
  createOAuthMiddleware,
  type FetchMiddleware,
  type TokenStore,
} from '@mokei/http-client'

import { createFileTokenStore } from './file-store.js'
import { createKeychainTokenStore, type KeychainTokenStoreOptions } from './keychain-store.js'
import { createLoopbackAuthorizationHandler } from './loopback.js'

export type NodeOAuthOptions = {
  clientID: string
  scopes?: Array<string>
  resource?: string
  /** File path for the persistent token store. Omit to keep tokens in-memory only. */
  tokensPath?: string
  /**
   * Keep tokens in the OS keychain ({@link createKeychainTokenStore}); an object configures it.
   * Mutually exclusive with `tokensPath`.
   */
  keychain?: boolean | KeychainTokenStoreOptions
  /** Override the authorisation handler (default: loopback browser handler). */
  handler?: AuthorizationHandler
  /** Override the token store (default: file store at tokensPath, else the middleware's in-memory default). */
  store?: TokenStore
  /** Browser-open timeout for the default loopback handler. */
  timeoutMs?: number
}

// One default loopback handler per timeout, shared by every middleware in the process, so the
// core serialises their interactive authorisations into one browser window at a time.
const defaultHandlers = new Map<number | undefined, AuthorizationHandler>()

function defaultHandler(timeoutMs: number | undefined): AuthorizationHandler {
  let handler = defaultHandlers.get(timeoutMs)
  if (handler == null) {
    handler = createLoopbackAuthorizationHandler({ timeoutMs })
    defaultHandlers.set(timeoutMs, handler)
  }
  return handler
}

/**
 * Composes {@link createOAuthMiddleware} with Node-specific defaults: a loopback browser
 * authorisation handler (RFC 8252), shared process-wide, and, when `tokensPath` or `keychain` is
 * given, a persistent token store (a file, or the OS keychain) that coordinates refreshes with
 * other processes using the same store.
 */
export function createNodeOAuthMiddleware(options: NodeOAuthOptions): FetchMiddleware {
  const handler = options.handler ?? defaultHandler(options.timeoutMs)
  if (options.keychain && options.tokensPath != null) {
    throw new Error('Pass either `tokensPath` or `keychain`, not both')
  }
  const store =
    options.store ??
    (options.keychain
      ? createKeychainTokenStore(options.keychain === true ? {} : options.keychain)
      : options.tokensPath
        ? createFileTokenStore(options.tokensPath)
        : undefined)

  return createOAuthMiddleware({
    clientID: options.clientID,
    scopes: options.scopes,
    resource: options.resource,
    handler,
    store,
  })
}
