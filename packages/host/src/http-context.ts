import type { ContextTypes, UnknownContextTypes } from '@mokei/context-client'

/**
 * Authentication options for HTTP context.
 */
export type HttpAuthOptions =
  | {
      type: 'bearer'
      token: string
    }
  | {
      type: 'basic'
      username: string
      password: string
    }
  | {
      type: 'header'
      name: string
      value: string
    }

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
  auth?: HttpAuthOptions
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Number of retry attempts on failure (default: 3) */
  retries?: number
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelay?: number
}

/**
 * Default timeout for HTTP requests (30 seconds).
 */
export const DEFAULT_HTTP_TIMEOUT = 30000

/**
 * Default number of retry attempts.
 */
export const DEFAULT_HTTP_RETRIES = 3

/**
 * Default delay between retries (1 second).
 */
export const DEFAULT_HTTP_RETRY_DELAY = 1000

/**
 * Build headers for HTTP request including authentication.
 */
export function buildHttpHeaders(
  baseHeaders?: Record<string, string>,
  auth?: HttpAuthOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...baseHeaders,
  }

  if (auth) {
    switch (auth.type) {
      case 'bearer':
        headers.Authorization = `Bearer ${auth.token}`
        break
      case 'basic': {
        const credentials = btoa(`${auth.username}:${auth.password}`)
        headers.Authorization = `Basic ${credentials}`
        break
      }
      case 'header':
        headers[auth.name] = auth.value
        break
    }
  }

  return headers
}
