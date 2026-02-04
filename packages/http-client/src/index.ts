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
export { createHTTPClient, HTTPTransport, type HTTPTransportParams } from './transport.js'
