import { toB64U } from '@sozai/codec'

import type { FetchLike, FetchMiddleware } from '../transport.js'
import { discover, parseResourceMetadataUrl } from './discovery.js'
import { createPKCE } from './pkce.js'
import { canonicalResource } from './resource.js'
import type { StoredTokens, TokenStore } from './store.js'
import { createMemoryTokenStore } from './store.js'

/** Completes the authorization-code exchange for a resource: the core owns all authorization-URL
 * params and the PKCE/state bookkeeping; the handler only supplies (and returns) `redirectUri`. */
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
  /** Picks an authorization server when the protected-resource metadata lists more than one;
   * defaults to the first. */
  selectAuthServer?: (servers: Array<string>) => string
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
 * Runs the authorization-code exchange (PKCE, form-encoded, no client secret) against
 * `as.token_endpoint` using the caller-supplied unwrapped `fetch` — never the OAuth middleware
 * itself, so this can never re-enter the middleware and loop.
 */
async function exchangeAuthorizationCode(
  fetchUnwrapped: FetchLike,
  tokenEndpoint: string,
  params: {
    clientId: string
    resource: string
    code: string
    redirectUri: string
    codeVerifier: string
  },
  now: () => number,
): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
    resource: params.resource,
  })
  const response = await fetchUnwrapped(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!response.ok) {
    throw new Error(`Token exchange HTTP ${response.status}`)
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
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in == null ? undefined : now() + data.expires_in,
    scope: data.scope,
  }
}

/**
 * Attaches the stored access token as `Authorization: Bearer …` and, best-effort, refreshes it
 * pre-emptively when near expiry. Refresh needs a token endpoint: when `tokens.tokenEndpoint` is
 * unknown (not yet set by an authorize flow) the refresh is skipped and the request proceeds with
 * the possibly-stale token, recovered by the 401 path below.
 *
 * On a 401 (and only once per outbound call, to bound retries): discovers the resource's
 * authorization server from the `WWW-Authenticate` header, runs a PKCE authorization-code flow
 * through `config.handler`, stores the resulting tokens, and retries the request exactly once
 * with the fresh `Authorization` header. Concurrent callers created from the *same*
 * `createOAuthMiddleware(config)` call for the same resource share a single in-flight
 * refresh/authorization (`authFlights`, one map per instance — see below), keyed by the same
 * canonical resource used as the token store key.
 */
export function createOAuthMiddleware(config: OAuthClientConfig): FetchMiddleware {
  const now = config.now ?? (() => Math.floor(Date.now() / 1000))
  const skew = config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS
  // Created once, here, at middleware construction — not per-request: a per-request default
  // store would be empty on every call and never actually retain a token.
  const store = config.store ?? createMemoryTokenStore()

  // Per-instance, not module-level: two `createOAuthMiddleware` calls (different clientId,
  // handler, or store — e.g. one per host context) must never share a flight even when their
  // canonical resource strings coincide, since a shared flight would let instance A's config
  // (clientId/PKCE/handler) decide instance B's outcome, and B's own `store.set` — closing over
  // B's own store — would never run.
  const authFlights = new Map<string, Promise<StoredTokens>>()

  /** Runs (or joins) the single-flight refresh/authorize for `resource`, re-checking the store
   * first since a concurrent flight may already have populated it. Reuse is decided by comparing
   * token identity (`staleAccessToken`, the token that was in use when the failure was observed)
   * rather than `nearExpiry`, since an access token need not carry `expiresAt` and a 401 can be
   * caused by something other than expiry — either would make an expiry-based check wrongly
   * "reuse" the very token that just failed.
   *
   * A joiner that adopts an in-flight promise which then *rejects* does not propagate that
   * rejection onto itself: pre-emptive refresh (best-effort) and the 401-authorize path share the
   * same flight slot per resource, so without this a failed background refresh from one caller
   * could hard-fail a concurrent caller's independently-fixable 401. Instead, the joiner re-checks
   * the store and, if still unauthenticated, runs its own recovery attempt — deduplicated with any
   * other joiners racing the same rejection so at most one recovery flight runs (checked
   * synchronously against `authFlights` with no `await` in between, so JS's single-threaded
   * execution guarantees the first joiner to react always wins the race). */
  function withSingleFlight(
    resource: string,
    store: TokenStore,
    staleAccessToken: string | undefined,
    run: () => Promise<StoredTokens>,
  ): Promise<StoredTokens> {
    function start(): Promise<StoredTokens> {
      const flight = (async () => {
        const current = await store.get(resource)
        if (current != null && current.accessToken !== staleAccessToken) return current
        return run()
      })()
      authFlights.set(resource, flight)
      // A second, derived promise chain so cleanup runs regardless of outcome without attaching
      // an additional unhandled-rejection-prone consumer to `flight` itself (its other consumers —
      // the leader's own caller, and any joiner's recovery below — already handle/propagate it).
      flight
        .finally(() => {
          if (authFlights.get(resource) === flight) authFlights.delete(resource)
        })
        .catch(() => {})
      return flight
    }

    const inFlight = authFlights.get(resource)
    if (inFlight == null) return start()
    return inFlight.catch(() => authFlights.get(resource) ?? start())
  }

  /** Discovers the authorization server, runs PKCE + `config.handler.authorize`, exchanges the
   * returned code for tokens, and persists them under `resource`. */
  async function authorize(
    next: FetchLike,
    resource: string,
    store: TokenStore,
    wwwAuthenticate: string | null,
  ): Promise<StoredTokens> {
    const resourceMetadataUrl = parseResourceMetadataUrl(wwwAuthenticate) ?? undefined
    const { as } = await discover({
      resource,
      resourceMetadataUrl,
      fetch: next,
      selectAuthServer: config.selectAuthServer,
    })

    const pkce = await createPKCE()
    const state = toB64U(crypto.getRandomValues(new Uint8Array(16)))

    function buildAuthorizationUrl(redirectUri: string): string {
      const authUrl = new URL(as.authorization_endpoint)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', config.clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('code_challenge', pkce.challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      if (config.scopes != null && config.scopes.length > 0) {
        authUrl.searchParams.set('scope', config.scopes.join(' '))
      }
      authUrl.searchParams.set('resource', resource)
      return authUrl.toString()
    }

    const result = await config.handler.authorize({ buildAuthorizationUrl, state })
    if (result.state !== state) {
      throw new Error('OAuth authorize: state mismatch')
    }

    const exchanged = await exchangeAuthorizationCode(
      next,
      as.token_endpoint,
      {
        clientId: config.clientId,
        resource,
        code: result.code,
        redirectUri: result.redirectUri,
        codeVerifier: pkce.verifier,
      },
      now,
    )
    const tokens: StoredTokens = {
      ...exchanged,
      tokenEndpoint: as.token_endpoint,
      issuer: as.issuer,
    }
    await store.set(resource, tokens)
    return tokens
  }

  return (next) => {
    return async (url, init) => {
      const resource = canonicalResource(config.resource ?? url)
      let tokens = await store.get(resource)

      if (
        tokens != null &&
        tokens.refreshToken != null &&
        tokens.tokenEndpoint != null &&
        nearExpiry(tokens, now, skew)
      ) {
        // Best-effort: a failed refresh (network error, non-2xx, non-bearer token_type) must
        // not fail the outbound request outright — it proceeds on the current, possibly-stale
        // token, and the 401 path below recovers.
        try {
          const refreshTokenEndpoint = tokens.tokenEndpoint
          const refreshToken = tokens.refreshToken
          const refreshIssuer = tokens.issuer
          const refreshed = await withSingleFlight(resource, store, tokens.accessToken, () =>
            exchangeRefresh(
              next,
              refreshTokenEndpoint,
              {
                clientId: config.clientId,
                resource,
                refreshToken,
                scopes: config.scopes,
              },
              now,
            ).then(async (r) => {
              const merged = { ...r, tokenEndpoint: refreshTokenEndpoint, issuer: refreshIssuer }
              await store.set(resource, merged)
              return merged
            }),
          )
          tokens = refreshed
        } catch {
          // Swallow: keep the stale tokens already read above.
        }
      }

      const attach = (requestInit: RequestInit | undefined): RequestInit => {
        const headers = new Headers(requestInit?.headers)
        if (tokens != null)
          headers.set('Authorization', `${tokens.tokenType} ${tokens.accessToken}`)
        return { ...requestInit, headers }
      }

      const response = await next(url, tokens != null ? attach(init) : init)
      if (response.status !== 401) return response

      // Prefer a refresh over full re-authorization when a refresh token is available: it is
      // cheaper and does not require the interactive handler. Only fall through to `authorize`
      // when there is no refresh token/endpoint, or the refresh itself fails.
      if (tokens?.refreshToken != null && tokens.tokenEndpoint != null) {
        const refreshTokenEndpoint = tokens.tokenEndpoint
        const refreshToken = tokens.refreshToken
        const refreshIssuer = tokens.issuer
        try {
          const refreshed = await withSingleFlight(resource, store, tokens.accessToken, () =>
            exchangeRefresh(
              next,
              refreshTokenEndpoint,
              {
                clientId: config.clientId,
                resource,
                refreshToken,
                scopes: config.scopes,
              },
              now,
            ).then(async (r) => {
              const merged = { ...r, tokenEndpoint: refreshTokenEndpoint, issuer: refreshIssuer }
              await store.set(resource, merged)
              return merged
            }),
          )
          tokens = refreshed
          return next(url, attach(init))
        } catch {
          // Fall through to full authorization below.
        }
      }

      const authorized = await withSingleFlight(resource, store, tokens?.accessToken, () =>
        authorize(next, resource, store, response.headers.get('WWW-Authenticate')),
      )
      tokens = authorized
      return next(url, attach(init))
    }
  }
}
