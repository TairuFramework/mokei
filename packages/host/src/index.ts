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

export { type HostClient, createClient, runDaemon } from './daemon/controller.js'
export {
  type AllowToolCalls,
  ContextHost,
  type ContextTool,
  type HostedContext,
  createHostedContext,
  getContextToolID,
  getContextToolInfo,
} from './host.js'
export { ProxyHost } from './proxy.js'
export { type ServerParams, startServer } from './server.js'
