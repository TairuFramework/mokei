import type { FetchLike, FetchMiddleware } from '../transport.js'
import { canonicalResource } from './resource.js'
import type { StoredTokens, TokenStore } from './store.js'

/** Completes the authorization-code exchange for a resource; the 401/authorize flow (later task). */
export type AuthorizationHandler = {
  authorize(params: {
    buildAuthorizationUrl(redirectUri: string): string
    state: string
  }): Promise<{ code: string; state: string; redirectUri: string }>
}

export type OAuthClientConfig = {
  clientId: string
  scopes?: Array<string>
  resource?: string
  handler: AuthorizationHandler
  store?: TokenStore
  /** Refresh this many seconds before actual expiry. */
  clockSkewSeconds?: number
  /** Current time in seconds; defaults to the wall clock. */
  now?: () => number
}

/** Whether `tokens` is at or past `now() + skew` (all in seconds). */
export function nearExpiry(tokens: StoredTokens, now: () => number, skew: number): boolean {
  return tokens.expiresAt != null && tokens.expiresAt - skew <= now()
}

/**
 * Exchange a refresh token for a new access token via `grant_type=refresh_token`.
 *
 * Uses the caller-supplied unwrapped `fetch` (never the OAuth middleware itself) so a refresh
 * can never re-enter this middleware and loop.
 */
export async function exchangeRefresh(
  fetchUnwrapped: FetchLike,
  tokenEndpoint: string,
  params: { clientId: string; resource?: string; refreshToken: string; scopes?: Array<string> },
  now: () => number,
): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  })
  if (params.resource != null) {
    body.set('resource', params.resource)
  }
  if (params.scopes != null && params.scopes.length > 0) {
    body.set('scope', params.scopes.join(' '))
  }
  const response = await fetchUnwrapped(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!response.ok) {
    throw new Error(`Token refresh HTTP ${response.status}`)
  }
  const data = (await response.json()) as {
    access_token: string
    token_type: string
    expires_in?: number
    refresh_token?: string
    scope?: string
  }
  if (String(data.token_type).toLowerCase() !== 'bearer') {
    throw new Error(`Unsupported token_type: ${data.token_type}`)
  }
  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    refreshToken: data.refresh_token ?? params.refreshToken,
    expiresAt: data.expires_in == null ? undefined : now() + data.expires_in,
    scope: data.scope,
  }
}

/** Default refresh window before actual token expiry, in seconds. */
const DEFAULT_CLOCK_SKEW_SECONDS = 60

/**
 * Attaches the stored access token as `Authorization: Bearer …` and, best-effort, refreshes it
 * pre-emptively when near expiry. Refresh needs a token endpoint: when `tokens.tokenEndpoint` is
 * unknown (not yet set by an authorize flow) the refresh is skipped and the request proceeds with
 * the possibly-stale token — a later 401 path (not built here) recovers from that.
 *
 * The 401 discovery/authorize/PKCE/single-flight flow is a later addition.
 */
export function createOAuthMiddleware(config: OAuthClientConfig): FetchMiddleware {
  const now = config.now ?? (() => Math.floor(Date.now() / 1000))
  const skew = config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS

  return (next) => {
    return async (url, init) => {
      const store = config.store
      const resource = canonicalResource(config.resource ?? url)
      let tokens = await store?.get(resource)

      if (
        tokens != null &&
        tokens.refreshToken != null &&
        tokens.tokenEndpoint != null &&
        nearExpiry(tokens, now, skew)
      ) {
        // Best-effort: a failed refresh (network error, non-2xx, non-bearer token_type) must
        // not fail the outbound request outright — it proceeds on the current, possibly-stale
        // token, and a later 401 path (not built here) recovers.
        try {
          const refreshed = await exchangeRefresh(
            next,
            tokens.tokenEndpoint,
            {
              clientId: config.clientId,
              resource: config.resource,
              refreshToken: tokens.refreshToken,
              scopes: config.scopes,
            },
            now,
          )
          tokens = { ...refreshed, tokenEndpoint: tokens.tokenEndpoint, issuer: tokens.issuer }
          await store?.set(resource, tokens)
        } catch {
          // Swallow: keep the stale tokens already read above.
        }
      }

      if (tokens != null) {
        const headers = new Headers(init?.headers)
        headers.set('Authorization', `${tokens.tokenType} ${tokens.accessToken}`)
        return next(url, { ...init, headers })
      }
      return next(url, init)
    }
  }
}
