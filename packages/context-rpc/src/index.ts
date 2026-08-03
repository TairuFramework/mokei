/**
 * Mokei shared RPC logic for context client and server.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/context-rpc
 * ```
 *
 * @module context-rpc
 */

export { RequestTimeoutError, RPCError, TransportClosedError } from './error.js'
export {
  ContextRPC,
  type RequestOptions,
  type RPCParams,
  type RPCTypes,
  splitRequestOptions,
  type WithRequestOptions,
} from './rpc.js'
export { DEFAULT_MAX_CONCURRENT_REQUESTS, DEFAULT_MAX_QUEUED_REQUESTS } from './scheduler.js'
