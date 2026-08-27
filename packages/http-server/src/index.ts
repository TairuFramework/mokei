/**
 * Mokei MCP HTTP server handler.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/http-server
 * ```
 *
 * @module http-server
 */

export {
  createHTTPHandler,
  DEFAULT_MAX_STATELESS_EXCHANGES,
  DEFAULT_MAX_SUBSCRIPTION_EXCHANGES,
  type HTTPHandler,
  type HTTPHandlerParams,
} from './handler.js'
export { type ServeHTTPParams, type ServeHTTPResult, serveHTTP } from './serve.js'
export { type Session, SessionManager, type SessionManagerParams } from './session.js'
export { createSSEStream, SSE_RESPONSE_HEADERS } from './sse-stream.js'
export { type SSEEvent, SSEWriter, type SSEWriterParams } from './sse-writer.js'
export {
  BAD_REQUEST_CODES,
  DEFAULT_STATELESS_TIMEOUT_MS,
  readRequestProtocolVersion,
  runStatelessExchange,
  type StatelessExchangeParams,
} from './stateless.js'
export { runSubscriptionExchange, type SubscriptionExchangeParams } from './subscriptions.js'
