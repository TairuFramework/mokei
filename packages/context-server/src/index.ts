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

export type { Schema } from '@enkaku/schema'

export { createPrompt, createTool } from './definitions.js'
export {
  ContextServer,
  type ServeProcessParams,
  type ServerEvents,
  type ServerParams,
  serveProcess,
} from './server.js'
export type { ClientInitialize, ServerTransport } from './types.js'
