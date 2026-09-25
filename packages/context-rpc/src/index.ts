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

export {
  RequestTimeoutError,
  type RequestTimeoutErrorParams,
  RPCError,
  type RPCErrorParams,
  TransportClosedError,
  type TransportClosedErrorParams,
} from './error.js'
export {
  ContextRPC,
  type HeldResponse,
  isHeldResponse,
  type RequestOptions,
  type RPCParams,
  type RPCTypes,
  splitRequestOptions,
  type WithRequestOptions,
} from './rpc.js'
export { DEFAULT_MAX_CONCURRENT_REQUESTS, DEFAULT_MAX_QUEUED_REQUESTS } from './scheduler.js'
