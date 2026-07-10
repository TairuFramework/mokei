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
} from './definitions.js'
export {
  ContextServer,
  type ServerConfig,
  type ServerEvents,
  type ServerParams,
  serveProcess,
} from './server.js'
export type {
  ExtractPromptTypes,
  ExtractServerTypes,
  ExtractToolTypes,
  StructuredToolHandlerReturn,
} from './types.js'
export * from './types.js'
