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

export {
  type ClientParams,
  type ClientRequest,
  ContextClient,
  type ContextTypes,
  type UnknownContextTypes,
} from './client.js'
export { RPCError } from './error.js'
export type { ClientTransport } from './types.js'
