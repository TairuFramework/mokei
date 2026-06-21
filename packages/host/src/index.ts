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
  createHTTPClient,
  DEFAULT_HTTP_TIMEOUT,
  HTTPTransport,
  type HTTPTransportParams,
} from '@mokei/http-client'
export { createClient, type DaemonOptions, type HostClient, runDaemon } from './daemon.js'
export {
  type AddDirectContextParams,
  type AddLocalContextParams,
  type AllowToolCalls,
  ContextHost,
  type ContextTool,
  type CreateContextParams,
  createHostedContext,
  type EnableTools,
  type EnableToolsArg,
  type EnableToolsFn,
  getContextToolID,
  getContextToolInfo,
  type HostedContext,
  spawnHostedContext,
} from './host.js'
export {
  createLocalToolID,
  createToolFromDefinition,
  getLocalToolName,
  isLocalToolID,
  LOCAL_TOOL_NAMESPACE,
  type LocalTool,
  type LocalToolDefinition,
  type LocalToolExecute,
  toolsToLocalTools,
  toolToLocalTool,
} from './local-tools.js'
export { ProxyHost } from './proxy.js'
export { type ServerParams, startServer } from './server.js'
export type { SpawnContextServerParams, StderrOption } from './spawn.js'
