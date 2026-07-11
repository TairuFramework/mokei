/**
 * Authentication options for HTTP requests.
 */
export type HTTPAuthOptions =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'header'; name: string; value: string }

export type BuildHTTPHeadersParams = {
  /** Headers to start from, before authentication is applied. */
  headers?: Record<string, string>
  /** Authentication to encode into the headers. */
  auth?: HTTPAuthOptions
}

/**
 * Build headers for HTTP request including authentication.
 */
export function buildHTTPHeaders(params: BuildHTTPHeadersParams = {}): Record<string, string> {
  const { auth } = params
  const headers: Record<string, string> = { ...params.headers }

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
