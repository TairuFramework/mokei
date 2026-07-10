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
  ListMaxPagesError,
  StructuredContentValidationError,
  UnsupportedProtocolVersionError,
} from './client.js'
export { currentTraceMeta, type TraceMeta, traceMetaFromContext } from './trace.js'
export type { ClientTransport } from './types.js'
