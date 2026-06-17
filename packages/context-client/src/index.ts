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
  ListRootsHandler,
  PromptParams,
  ToolParams,
  UnknownContextTypes,
} from './client.js'
export {
  CapabilityNotDeclaredError,
  ContextClient,
  UnsupportedProtocolVersionError,
} from './client.js'
export { currentTraceMeta, type TraceMeta, traceMetaFromContext } from './trace.js'
export type { ClientTransport } from './types.js'
