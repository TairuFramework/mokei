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

export type { ClientEvents } from './client.js'
export { ContextClient, DEFAULT_LIST_MAX_PAGES } from './client.js'
export {
  CapabilityNotDeclaredError,
  InputRequiredNotSupportedError,
  ListMaxPagesError,
  MethodNotInRevisionError,
  MRTRNotSupportedError,
  StructuredContentValidationError,
  UnsupportedProtocolVersionError,
  type ValidationIssue,
} from './errors.js'
export {
  DEFAULT_MAX_ROUNDS,
  type InputRequiredResult,
  type InputRequiredRetryParams,
  InputRequiredRoundsExceededError,
  InputRequiredTotalTimeoutError,
  isInputRequiredResult,
  REQUEST_STATE_ONLY_PACING_MS,
} from './mrtr.js'
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
  type SubscriptionRetry,
  SubscriptionStreamError,
} from './subscriptions.js'
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
