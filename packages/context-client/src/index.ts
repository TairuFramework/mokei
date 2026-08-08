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

export type {
  ClientParams,
  ContextTypes,
  CreateMessageHandler,
  ElicitHandler,
  ListOptions,
  ListParams,
  ListRootsHandler,
  PromptParams,
  ToolParams,
  UnknownContextTypes,
  ValidationIssue,
} from './client.js'
export {
  CapabilityNotDeclaredError,
  ContextClient,
  DEFAULT_LIST_MAX_PAGES,
  InputRequiredNotSupportedError,
  ListMaxPagesError,
  MethodNotInRevisionError,
  MRTRNotSupportedError,
  StructuredContentValidationError,
  splitListOptions,
  UnsupportedProtocolVersionError,
} from './client.js'
export {
  DEFAULT_MAX_ROUNDS,
  type InputRequiredResult,
  type InputRequiredRetryParams,
  InputRequiredRoundsExceededError,
  InputRequiredTotalTimeoutError,
  isInputRequiredResult,
  REQUEST_STATE_ONLY_PACING_MS,
} from './mrtr.js'
export { currentTraceMeta, type TraceMeta, traceMetaFromContext } from './trace.js'
export type { ClientTransport } from './types.js'
