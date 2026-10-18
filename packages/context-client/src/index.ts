/**
 * Mokei MCP client.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/context-client
 * ```
 *
 * @module context-client
 */

export type { ClientEvents, ClientTasks } from './client.js'
export { ContextClient, DEFAULT_LIST_MAX_PAGES } from './client.js'
export {
  type ClientTracing,
  createExchangeTracer,
  type ExchangeSpan,
  type TerminationReason,
  type TraceParentFrom,
} from './client-tracing.js'
export {
  CapabilityNotDeclaredError,
  type CapabilityNotDeclaredErrorParams,
  InputRequiredNotSupportedError,
  type InputRequiredNotSupportedErrorParams,
  ListMaxPagesError,
  type ListMaxPagesErrorParams,
  MethodNotInRevisionError,
  type MethodNotInRevisionErrorParams,
  MRTRNotSupportedError,
  type MRTRNotSupportedErrorParams,
  StructuredContentValidationError,
  type StructuredContentValidationErrorParams,
  TaskCancelledError,
  TaskExpiredError,
  TaskInputUnavailableError,
  TaskInputWithdrawnError,
  UnsupportedProtocolVersionError,
  type UnsupportedProtocolVersionErrorParams,
  type ValidationIssue,
} from './errors.js'
export {
  mcpMetricsEnabled,
  metricAttributes,
  recordMCPOperation,
  recordMCPSession,
} from './mcp-metrics.js'
export {
  DEFAULT_MAX_ROUNDS,
  type InputRequiredResult,
  type InputRequiredRetryParams,
  InputRequiredRoundsExceededError,
  type InputRequiredRoundsExceededErrorParams,
  InputRequiredTotalTimeoutError,
  type InputRequiredTotalTimeoutErrorParams,
  isInputRequiredResult,
  REQUEST_STATE_ONLY_PACING_MS,
} from './mrtr.js'
export {
  capturePayload,
  DEFAULT_PAYLOAD_CAP,
  type MessageDirection,
  type NetworkInfo,
  type PayloadCapture,
  redactCommandArgs,
  redactPayload,
  requestAttributes,
  requestSpanName,
  resolvePayloadCap,
  responseAttributes,
  responseOutcome,
  sanitizeMessage,
} from './observation.js'
export {
  AGENT_COUNT_BUCKETS,
  AGENT_DURATION_BUCKETS,
  endSpanError,
  errorTypeOf,
  GEN_AI_DURATION_BUCKETS,
  getMokeiMeter,
  getMokeiTracer,
  MCP_DURATION_BUCKETS,
  resolveContentCapture,
  SEMCONV_SCHEMA_URL,
  TOKEN_BUCKETS,
  WORKFLOW_DURATION_BUCKETS,
} from './semconv.js'
export {
  type ListenHandle,
  type ListenHandlers,
  type ListenSettle,
  type ListenSettleReason,
  type MutationOptions,
  type OpenListen,
  SubscriptionDriver,
  type SubscriptionDriverParams,
  type SubscriptionNotification,
  SubscriptionProtocolError,
  type SubscriptionProtocolErrorParams,
  type SubscriptionRetry,
  SubscriptionStreamError,
  type SubscriptionStreamErrorParams,
} from './subscriptions.js'
export type { WaitForTaskParams } from './task-waiter.js'
export { currentTraceMeta, type TraceMeta, traceMetaFromContext } from './trace.js'
export type {
  ClientHandlerRequest,
  ClientParams,
  ClientTransport,
  ContextTypes,
  CreateMessageHandler,
  ElicitHandler,
  ListOptions,
  ListParams,
  ListRootsHandler,
  PromptParams,
  ResourceSubscriptionParams,
  ToolParams,
  UnknownContextTypes,
} from './types.js'
export { splitListOptions } from './types.js'
