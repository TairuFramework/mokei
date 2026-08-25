/**
 * Mokei Context host — Node stdio and daemon entry.
 *
 * @module host-node
 */

export { createClient, type DaemonOptions, type HostClient, runDaemon } from './daemon.js'
export {
  type AddLocalContextParams,
  NodeContextHost,
  type SpawnHostedContextParams,
  spawnHostedContext,
} from './node-host.js'
export { ProxyHost, type ProxySpawnParams } from './proxy.js'
export type { SpawnContextServerParams, StderrOption } from './spawn.js'
