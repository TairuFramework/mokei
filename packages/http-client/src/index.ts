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
  createHTTPClient,
  DEFAULT_HTTP_TIMEOUT,
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
