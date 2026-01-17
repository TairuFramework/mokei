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
  buildHttpHeaders,
  DEFAULT_HTTP_RETRIES,
  DEFAULT_HTTP_RETRY_DELAY,
  DEFAULT_HTTP_TIMEOUT,
  type HttpAuthOptions,
  type HttpContextParams,
} from './http-context.js'
export { McpHttpTransport, type McpHttpTransportParams } from './http-transport.js'
export {
  createLocalToolID,
  createToolFromDefinition,
  getLocalToolName,
  isLocalToolID,
  LOCAL_TOOL_NAMESPACE,
  type LocalTool,
  type LocalToolDefinition,
  type LocalToolExecute,
} from './local-tools.js'
export { ProxyHost } from './proxy.js'
export { type ServerParams, startServer } from './server.js'
export type { SpawnContextServerParams, StderrOption } from './spawn.js'
