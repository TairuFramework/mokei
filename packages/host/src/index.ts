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

export {
  type AllowToolCalls,
  ContextHost,
  type ContextTool,
  type HostedContext,
  createHostedContext,
  getContextToolID,
  getContextToolInfo,
} from './host.js'
export { type ServerParams, startServer } from './server.js'
