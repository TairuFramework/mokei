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

export { TRANSPORT_FAILURE, transportFailureOf } from '@mokei/context-client'
export type { Runtime } from '@sozai/runtime'

export { buildHTTPHeaders, type HTTPAuthOptions } from './auth.js'
export {
  AuthRequiredError,
  isSessionExpiredCode,
  NetworkError,
  SESSION_EXPIRED_CODE,
  SESSION_EXPIRED_MESSAGE,
  SessionExpiredError,
  type SessionExpiredErrorParams,
} from './errors.js'
export { interactionOf, REQUEST_INTERACTION, type RequestInteraction } from './interaction.js'
export { parseBearerChallenge } from './oauth/challenge.js'
export {
  type AuthorizationHandler,
  createOAuthMiddleware,
  type OAuthClientConfig,
} from './oauth/middleware.js'
export { canonicalResource } from './oauth/resource.js'
export {
  type RevokeTokensParams,
  type RevokeTokensResult,
  revokeTokens,
} from './oauth/revoke.js'
export {
  createMemoryTokenStore,
  parseTokenStoreKey,
  type StoredTokens,
  type TokenStore,
  tokenStoreKey,
} from './oauth/store.js'
export { createMemoryStore, type KeyValueStore } from './store.js'
export {
  type ConnectionEvent,
  type CreateHTTPClientParams,
  createHTTPClient,
  DEFAULT_HTTP_REFRESH_TIMEOUT,
  DEFAULT_HTTP_TIMEOUT,
  type DisposeHTTPTransportParams,
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
