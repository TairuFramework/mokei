/**
 * Mokei Context host.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/host
 * ```
 *
 * @module host
 */

export { createClient, type HostClient, runDaemon } from './daemon/controller.js'
export {
  type AllowToolCalls,
  ContextHost,
  type ContextTool,
  createHostedContext,
  type EnableTools,
  type EnableToolsArg,
  type EnableToolsFn,
  getContextToolID,
  getContextToolInfo,
  type HostedContext,
  type SpawnParams,
} from './host.js'
export { ProxyHost } from './proxy.js'
export { type ServerParams, startServer } from './server.js'
export type { SpawnContextServerParams, StderrOption } from './spawn.js'
