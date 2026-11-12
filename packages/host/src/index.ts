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
  createElicitContentValidator,
  type ElicitContentValidator,
  type ElicitValidator,
  elicitCompile,
  elicitDescribeIssue,
  elicitIssuesOf,
  elicitMessageOf,
  elicitPropertyValidationSchema,
  type RequestedSchema,
} from './elicit-content.js'
export {
  ContextUnavailableError,
  type ContextUnavailableErrorParams,
  ReconnectDeclinedError,
  type ReconnectDeclinedErrorParams,
  ReconnectExhaustedError,
  type ReconnectExhaustedErrorParams,
} from './errors.js'
export { ContextHost } from './host.js'
export {
  type CreateHostedContextParams,
  createHostedContext,
  type HostedContext,
} from './hosted-context.js'
export {
  createLocalToolID,
  createToolFromDefinition,
  getLocalToolName,
  isLocalToolID,
  LOCAL_TOOL_NAMESPACE,
  type LocalTool,
  type LocalToolContext,
  type LocalToolDefinition,
  type LocalToolExecute,
  toolsToLocalTools,
  toolToLocalTool,
} from './local-tools.js'
export type {
  ContextConnectivity,
  ContextFactory,
  HostedContextParts,
  ReconnectOptions,
} from './reconnect.js'
export {
  type AllowToolCalls,
  type ContextTool,
  type EnableTools,
  type EnableToolsArg,
  type EnableToolsFn,
  getContextToolID,
  getContextToolInfo,
} from './tools.js'
export type {
  AddDirectContextParams,
  ContextHostParams,
  ContextResourceSubscriptionParams,
  CreateContextParams,
  ElicitFallback,
  HasContextParams,
  HostElicitHandler,
  HostElicitOverride,
  HostElicitRequest,
  HTTPContextParams,
  PerCallElicit,
  RegisterHostedContextParams,
} from './types.js'
