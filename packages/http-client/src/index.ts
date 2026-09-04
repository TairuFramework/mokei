/**
 * Mokei MCP HTTP client transport.
 *
 * ## Installation
 *
 * ```sh
 * npm install @mokei/http-client
 * ```
 *
 * @module http-client
 */

export { buildHTTPHeaders, type HTTPAuthOptions } from './auth.js'
export {
  isSessionExpiredCode,
  SESSION_EXPIRED_CODE,
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError,
} from './errors.js'
export {
  type AuthorizationHandler,
  createOAuthMiddleware,
  type OAuthClientConfig,
} from './oauth/middleware.js'
export { createMemoryTokenStore, type StoredTokens, type TokenStore } from './oauth/store.js'
export {
  type CreateHTTPClientParams,
  createHTTPClient,
  DEFAULT_HTTP_REFRESH_TIMEOUT,
  DEFAULT_HTTP_TIMEOUT,
  type FetchLike,
  type FetchMiddleware,
  HTTPTransport,
  type HTTPTransportParams,
} from './transport.js'
export {
  buildParamHeaders,
  type CollectResult,
  collectHeaderAnnotations,
  encodeHeaderValue,
  type HeaderAnnotation,
  isValidHeaderParamName,
} from './x-mcp-header.js'
