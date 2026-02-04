import type { ContextTypes, UnknownContextTypes } from '@mokei/context-client'
import type { HTTPAuthOptions } from '@mokei/http-client'

export type { HTTPAuthOptions }

/**
 * @deprecated Use `HTTPAuthOptions` instead.
 */
export type HttpAuthOptions = HTTPAuthOptions

/**
 * Parameters for adding an HTTP-based MCP context.
 *
 * @example
 * ```typescript
 * await host.addHttpContext({
 *   key: 'remote-api',
 *   url: 'https://mcp.example.com/api',
 *   auth: { type: 'bearer', token: 'your-api-key' },
 *   timeout: 30000,
 * })
 * ```
 */
export type HttpContextParams<_T extends ContextTypes = UnknownContextTypes> = {
  /** Unique identifier for this context */
  key: string
  /** URL of the MCP HTTP endpoint */
  url: string
  /** Optional custom headers to include in requests */
  headers?: Record<string, string>
  /** Optional authentication configuration */
  auth?: HTTPAuthOptions
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * Default timeout for HTTP requests (30 seconds).
 */
export const DEFAULT_HTTP_TIMEOUT = 30000
