/**
 * Mokei Context host -- Node stdio and daemon entry.
 *
 * @module host-node
 */

export { createClient, type DaemonOptions, type HostClient, runDaemon } from './daemon.js'
export { composeHandlers, type HostDaemonParams, serveHostDaemon } from './daemon-server.js'
export type { FileLockOptions } from './file-lock.js'
export { createJSONFileStore, type JSONFileStoreOptions } from './json-file-store.js'
export {
  createKeychainStore,
  type KeychainBackend,
  type KeychainStoreOptions,
  KeychainUnavailableError,
  type KeychainUnavailableErrorParams,
} from './keychain-store.js'
export {
  type AddLocalContextParams,
  type LocalReconnectOptions,
  NodeContextHost,
  type RespawnContextServer,
  type SpawnHostedContextParams,
  spawnHostedContext,
} from './node-host.js'
export { createFileTokenStore } from './oauth/file-store.js'
export {
  createKeychainTokenStore,
  defaultKeychainLockPath,
  KEYCHAIN_TOKEN_SERVICE,
  type KeychainTokenStoreOptions,
} from './oauth/keychain-store.js'
export {
  browserOpenCommand,
  createLoopbackAuthorizationHandler,
  type LoopbackAuthorizationHandlerOptions,
} from './oauth/loopback.js'
export { createNodeOAuthMiddleware, type NodeOAuthOptions } from './oauth/node-middleware.js'
export { ProxyHost, type ProxyHostParams, type ProxySpawnParams } from './proxy.js'
export type { SpawnContextServerParams, StderrOption } from './spawn.js'
export { createTraceHandlers, type TraceReader } from './trace-handlers.js'
