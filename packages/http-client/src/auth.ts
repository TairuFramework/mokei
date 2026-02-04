/**
 * Authentication options for HTTP requests.
 */
export type HTTPAuthOptions =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'header'; name: string; value: string }

/**
 * Build headers for HTTP request including authentication.
 */
export function buildHTTPHeaders(
  baseHeaders?: Record<string, string>,
  auth?: HTTPAuthOptions,
): Record<string, string> {
  const headers: Record<string, string> = { ...baseHeaders }

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
