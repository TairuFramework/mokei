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
export { ContextRPC, type RPCParams, type RPCTypes, type SentRequest } from './rpc.js'
