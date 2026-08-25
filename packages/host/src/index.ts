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
  type CreateHTTPClientParams,
  createHTTPClient,
  DEFAULT_HTTP_TIMEOUT,
  HTTPTransport,
  type HTTPTransportParams,
} from '@mokei/http-client'

export {
  type AddDirectContextParams,
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
  type HTTPContextParams,
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
