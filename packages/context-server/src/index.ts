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
  ToolInputValidationError,
  ToolOutputValidationError,
  type ToolOutputValidationErrorParams,
} from './definitions.js'
export {
  defaultMintRequestState,
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
  type SubscriptionBackpressureErrorParams,
  type SubscriptionEntry,
  type SubscriptionHandle,
  type SubscriptionHub,
  type SubscriptionSink,
  SubscriptionWriter,
  type SubscriptionWriterParams,
} from './subscriptions.js'
export {
  createTaskManager,
  InputRequestWithdrawnError,
  type TaskContext,
  type TaskHandle,
  TaskInputKeyReusedError,
  type TaskManager,
  TaskManagerDisposedError,
  type TaskManagerParams,
  type TaskResume,
  type TaskWork,
} from './task-manager.js'
export {
  createMemoryTaskStore,
  type InputRecord,
  type JSONValue,
  type TaskOwner,
  type TaskRecord,
  type TaskStore,
  TaskStoreConflictError,
} from './task-store.js'
export {
  finalizeToolResult,
  type SettledToolOutcome,
  settleToolOutcome,
  type ToolOutcome,
} from './tool-outcome.js'
export type {
  ExtractPromptTypes,
  ExtractServerTypes,
  ExtractToolTypes,
  StructuredToolHandlerReturn,
} from './types.js'
export * from './types.js'
