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
export { RPCError } from './error.js'
export { ContextServer, type ServerEvents, type ServerParams, serve } from './server.js'
export type { ClientInitialize, ServerTransport } from './types.js'
