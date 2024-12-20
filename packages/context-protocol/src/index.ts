/**
 * Mokei MCP constants, schemas and types.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/context-protocol
 * ```
 *
 * @module context-protocol
 */

export {
  type ClientMessage,
  type ClientNotification,
  type ClientRequest,
  type ClientResponse,
  clientMessage,
  createClientMessage,
} from './client.js'
export type { Implementation, InitializeResult } from './initialize.js'
export type { GetPromptResult } from './prompt.js'
export type {
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListResourcesRequest,
  ListResourcesResult,
  ReadResourceRequest,
  ReadResourceResult,
} from './resource.js'
export {
  type ErrorResponse,
  type RequestID,
  LATEST_PROTOCOL_VERSION,
  PARSE_ERROR,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  INTERNAL_ERROR,
} from './rpc.js'
export { type CallToolRequest, type CallToolResult, type Tool, inputSchema } from './tool.js'
export {
  type ServerMessage,
  type ServerNotification,
  type ServerRequest,
  type ServerResult,
  serverMessage,
} from './server.js'
