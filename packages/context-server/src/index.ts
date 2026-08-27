/**
 * Mokei MCP server.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/context-server
 * ```
 *
 * @module context-server
 */

export type { Schema } from '@sozai/schema'

export {
  type CreatePromptParams,
  type CreateToolParams,
  createPrompt,
  createTool,
  ToolOutputValidationError,
} from './definitions.js'
export {
  type InputRequiredResult,
  inputRequired,
  isInputRequiredResult,
  MRTR_METHODS,
  type RequestStateHooks,
} from './mrtr.js'
export {
  ContextServer,
  type ServerConfig,
  type ServerEvents,
  type ServerParams,
} from './server.js'
export {
  type CreateSubscriptionHubParams,
  createSubscriptionHub,
  SubscriptionBackpressureError,
  type SubscriptionEntry,
  type SubscriptionHandle,
  type SubscriptionHub,
  type SubscriptionSink,
  SubscriptionWriter,
  type SubscriptionWriterParams,
} from './subscriptions.js'
export type {
  ExtractPromptTypes,
  ExtractServerTypes,
  ExtractToolTypes,
  StructuredToolHandlerReturn,
} from './types.js'
export * from './types.js'
