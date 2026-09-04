import { toB64U } from '@sozai/codec'

import type { FetchLike, FetchMiddleware } from '../transport.js'
import { discover, parseResourceMetadataURL } from './discovery.js'
import { fetchOAuthJSON } from './fetch.js'
import { createPKCE } from './pkce.js'
import { canonicalResource } from './resource.js'
import type { StoredTokens, TokenStore } from './store.js'
import { createMemoryTokenStore } from './store.js'

/** Completes the authorization-code exchange for a resource: the core owns all authorization-URL
 * params and the PKCE/state bookkeeping; the handler only supplies (and returns) `redirectURI`. */
export type AuthorizationHandler = {
  authorize(params: {
    buildAuthorizationURL(redirectURI: string): string
    state: string
    /** Aborts the interactive flow when the originating request is aborted. Additive and
     * optional: a handler that ignores it behaves exactly as before. */
    signal?: AbortSignal
  }): Promise<{ code: string; state: string; redirectURI: string }>
}

export type OAuthClientConfig = {
  clientID: string
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

/** Shape a validated token-endpoint response must have before it is turned into `StoredTokens`.
 * Guards against a malformed response (missing/non-string `access_token`, non-numeric
 * `expires_in`, non-string `refresh_token`/`scope`) being persisted as a poisoned credential. */
export function parseTokenResponse(raw: unknown): {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
} {
  if (typeof raw !== 'object' || raw === null) throw new Error('token response is not an object')
  const r = raw as Record<string, unknown>
  if (typeof r.access_token !== 'string' || r.access_token.length === 0)
    throw new Error('token response missing access_token')
  if (typeof r.token_type !== 'string') throw new Error('token response missing token_type')
  // a non-finite or negative expires_in (e.g. -5, Infinity, NaN) is not a valid delta-seconds
  // value and must not be turned into a bogus `expiresAt` -- reject it the same as a non-numeric
  // value rather than silently persisting a poisoned/garbage expiry.
  if (
    r.expires_in != null &&
    (typeof r.expires_in !== 'number' || !Number.isFinite(r.expires_in) || r.expires_in < 0)
  )
    throw new Error('token response has invalid expires_in')
  if (r.refresh_token != null && typeof r.refresh_token !== 'string')
    throw new Error('token response has non-string refresh_token')
  if (r.scope != null && typeof r.scope !== 'string')
    throw new Error('token response has non-string scope')
  return r as {
    access_token: string
    token_type: string
    expires_in?: number
    refresh_token?: string
    scope?: string
  }
}

export type ExchangeRefreshParams = {
  /** Unwrapped `fetch` (never the OAuth middleware itself) so a refresh cannot re-enter and loop. */
  fetchUnwrapped: FetchLike
  tokenEndpoint: string
  clientID: string
  resource?: string
  refreshToken: string
  scopes?: Array<string>
  now: () => number
  signal?: AbortSignal
}

/** Exchange a refresh token for a new access token via `grant_type=refresh_token`. */
export async function exchangeRefresh(params: ExchangeRefreshParams): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientID,
  })
  if (params.resource != null) {
    body.set('resource', params.resource)
  }
  if (params.scopes != null && params.scopes.length > 0) {
    body.set('scope', params.scopes.join(' '))
  }
  const json = await fetchOAuthJSON(params.fetchUnwrapped, params.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: params.signal,
    errorLabel: 'Token refresh',
  })
  const data = parseTokenResponse(json)
  if (String(data.token_type).toLowerCase() !== 'bearer') {
    throw new Error(`Unsupported token_type: ${data.token_type}`)
  }
  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    refreshToken: data.refresh_token ?? params.refreshToken,
    expiresAt: data.expires_in == null ? undefined : params.now() + data.expires_in,
    scope: data.scope,
  }
}

/** Default refresh window before actual token expiry, in seconds. */
const DEFAULT_CLOCK_SKEW_SECONDS = 60

/** Whether `hostname` names a loopback address, kept local rather than imported from
 * `discovery.js` to keep this module's boundary independent. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  )
}

type ExchangeAuthorizationCodeParams = {
  /** Unwrapped `fetch` (never the OAuth middleware itself) so this cannot re-enter and loop. */
  fetchUnwrapped: FetchLike
  tokenEndpoint: string
  clientID: string
  resource: string
  code: string
  redirectURI: string
  codeVerifier: string
  now: () => number
  signal?: AbortSignal
}

/**
 * Runs the authorization-code exchange (PKCE, form-encoded, no client secret) against
 * `as.token_endpoint` using the caller-supplied unwrapped `fetch` — never the OAuth middleware
 * itself, so this can never re-enter the middleware and loop.
 */
async function exchangeAuthorizationCode(
  params: ExchangeAuthorizationCodeParams,
): Promise<StoredTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectURI,
    client_id: params.clientID,
    code_verifier: params.codeVerifier,
    resource: params.resource,
  })
  const json = await fetchOAuthJSON(params.fetchUnwrapped, params.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: params.signal,
    errorLabel: 'Token exchange',
  })
  const data = parseTokenResponse(json)
  if (String(data.token_type).toLowerCase() !== 'bearer') {
    throw new Error(`Unsupported token_type: ${data.token_type}`)
  }
  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in == null ? undefined : params.now() + data.expires_in,
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

  // Per-instance, not module-level: two `createOAuthMiddleware` calls (different clientID,
  // handler, or store — e.g. one per host context) must never share a flight even when their
  // canonical resource strings coincide, since a shared flight would let instance A's config
  // (clientID/PKCE/handler) decide instance B's outcome, and B's own `store.set` — closing over
  // B's own store — would never run.
  //
  // (deferred, tracked follow-up, not fixed here): being per-instance also means two
  // `createOAuthMiddleware` instances that happen to share one `TokenStore` file for the *same*
  // resource have no cross-instance coordination at all -- each runs its own single-flight
  // refresh/authorize independently, so a rotating refresh token can in principle be redeemed
  // twice (double-redemption) across instances. File writes are already serialized by the
  // shared-path mutex in `createFileTokenStore` (no corruption), so the residual is a possible
  // redundant refresh or interactive re-authorization in that narrow scenario, not data loss.
  // Fixing this properly needs an atomic compare-and-set/lease on the `TokenStore` interface --
  // a behavioral contract change to a pluggable interface, and a distinct feature outside this
  // wave.
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
    signal?: AbortSignal,
  ): Promise<StoredTokens> {
    const resourceMetadataURL = parseResourceMetadataURL(wwwAuthenticate) ?? undefined
    const { as } = await discover({
      resource,
      resourceMetadataURL,
      fetch: next,
      selectAuthServer: config.selectAuthServer,
      signal,
    })

    const pkce = await createPKCE()
    const state = toB64U(crypto.getRandomValues(new Uint8Array(16)))

    function buildAuthorizationURL(redirectURI: string): string {
      const authURL = new URL(as.authorization_endpoint)
      authURL.searchParams.set('response_type', 'code')
      authURL.searchParams.set('client_id', config.clientID)
      authURL.searchParams.set('redirect_uri', redirectURI)
      authURL.searchParams.set('code_challenge', pkce.challenge)
      authURL.searchParams.set('code_challenge_method', 'S256')
      authURL.searchParams.set('state', state)
      if (config.scopes != null && config.scopes.length > 0) {
        authURL.searchParams.set('scope', config.scopes.join(' '))
      }
      authURL.searchParams.set('resource', resource)
      return authURL.toString()
    }

    const result = await config.handler.authorize({ buildAuthorizationURL, state, signal })
    if (result.state !== state) {
      throw new Error('OAuth authorize: state mismatch')
    }

    const exchanged = await exchangeAuthorizationCode({
      fetchUnwrapped: next,
      tokenEndpoint: as.token_endpoint,
      clientID: config.clientID,
      resource,
      code: result.code,
      redirectURI: result.redirectURI,
      codeVerifier: pkce.verifier,
      now,
      signal,
    })
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
      // captured once per outbound call and threaded through every OAuth subrequest below
      // (pre-emptive refresh, discovery, the interactive handler, and the code exchange) so
      // aborting the caller's own request cancels the whole recovery flow instead of leaving it
      // to run to completion in the background.
      const signal = init?.signal ?? undefined
      const u = new URL(url)
      const loopback = isLoopbackHost(u.hostname)
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
        throw new Error(
          `OAuth requires an https (or loopback) transport URL, got: ${u.protocol}//${u.host}`,
        )
      }

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
            exchangeRefresh({
              fetchUnwrapped: next,
              tokenEndpoint: refreshTokenEndpoint,
              clientID: config.clientID,
              resource,
              refreshToken,
              scopes: config.scopes,
              now,
              signal,
            }).then(async (r) => {
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

      // drain (cancel) the 401 response body before starting recovery. An unbounded or SSE
      // body left open here retains the underlying socket/connection for as long as the
      // refresh-then-authorize recovery below takes -- which can be an interactive, multi-minute
      // flow -- so it must be released up front rather than left to the garbage collector.
      await response.body?.cancel().catch(() => {})

      // Prefer a refresh over full re-authorization when a refresh token is available: it is
      // cheaper and does not require the interactive handler. Only fall through to `authorize`
      // when there is no refresh token/endpoint, or the refresh itself fails.
      if (tokens?.refreshToken != null && tokens.tokenEndpoint != null) {
        const refreshTokenEndpoint = tokens.tokenEndpoint
        const refreshToken = tokens.refreshToken
        const refreshIssuer = tokens.issuer
        try {
          const refreshed = await withSingleFlight(resource, store, tokens.accessToken, () =>
            exchangeRefresh({
              fetchUnwrapped: next,
              tokenEndpoint: refreshTokenEndpoint,
              clientID: config.clientID,
              resource,
              refreshToken,
              scopes: config.scopes,
              now,
              signal,
            }).then(async (r) => {
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
        authorize(next, resource, store, response.headers.get('WWW-Authenticate'), signal),
      )
      tokens = authorized
      return next(url, attach(init))
    }
  }
}
