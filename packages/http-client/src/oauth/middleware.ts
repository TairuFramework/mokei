import { toB64U } from '@sozai/codec'

import type { FetchLike, FetchMiddleware } from '../transport.js'
import { parseBearerChallenge, splitScopes } from './challenge.js'
import { discover, parseResourceMetadataURL } from './discovery.js'
import { fetchOAuthJSON, OAuthResponseError } from './fetch.js'
import { createPKCE } from './pkce.js'
import { canonicalResource } from './resource.js'
import type { StoredTokens, TokenStore } from './store.js'
import { createMemoryTokenStore, tokenStoreKey } from './store.js'

/** Completes the authorisation-code exchange for a resource: the core owns all authorisation-URL
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
  /** Picks an authorisation server when the protected-resource metadata lists more than one;
   * defaults to the first. */
  selectAuthServer?: (servers: Array<string>) => string
  /**
   * Step up on `403` with an `insufficient_scope` challenge (default `true`). The middleware
   * re-authorises interactively for the configured scopes, the stored token's scopes and the
   * challenge scopes together, then retries the request once. It never steps up for scopes it
   * already requested, so a server that keeps refusing gets its `403` back rather than a
   * sign-in loop. Set `false` to pass every `403` through untouched.
   */
  stepUp?: boolean
}

function unionScopes(...lists: Array<ReadonlyArray<string> | undefined>): Array<string> {
  return [...new Set(lists.flatMap((list) => list ?? []))]
}

/** Whether `tokens` were requested or granted for every scope in `wanted`. */
function coversScopes(tokens: StoredTokens, wanted: ReadonlyArray<string>): boolean {
  const held = new Set([...(tokens.requestedScopes ?? []), ...splitScopes(tokens.scope)])
  return wanted.every((scope) => held.has(scope))
}

/** Whether `tokens` is at or past `now() + skew` (all in seconds). */
export function nearExpiry(tokens: StoredTokens, now: () => number, skew: number): boolean {
  return tokens.expiresAt != null && tokens.expiresAt - skew <= now()
}

/** Validate a token-endpoint response before it becomes `StoredTokens`, so a malformed response
 * is never persisted as a poisoned credential. */
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

function isRefreshable(
  tokens: StoredTokens | undefined,
): tokens is StoredTokens & { refreshToken: string; tokenEndpoint: string } {
  return tokens?.refreshToken != null && tokens.tokenEndpoint != null
}

/** RFC 6749 §5.2: the refresh token is invalid, expired or revoked -- retrying cannot succeed. */
function isInvalidGrant(error: unknown): boolean {
  return error instanceof OAuthResponseError && error.oauthError === 'invalid_grant'
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

/** Runs the PKCE authorisation-code exchange (form-encoded, no client secret) against the token
 * endpoint. */
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

/** In-flight refreshes and authorisations, shared by every middleware using the same store, so
 * contexts that share a store never redeem one refresh token twice or prompt twice for one key. */
const flightsByStore = new WeakMap<TokenStore, Map<string, Promise<StoredTokens>>>()

/** The tail of each handler's queue of interactive authorisations. */
const authorizeQueues = new WeakMap<AuthorizationHandler, Promise<void>>()

function storeFlights(store: TokenStore): Map<string, Promise<StoredTokens>> {
  let flights = flightsByStore.get(store)
  if (flights == null) {
    flights = new Map()
    flightsByStore.set(store, flights)
  }
  return flights
}

/** Runs `run` after every earlier authorisation through `handler` has settled, so contexts that
 * share a handler open one browser window at a time. */
function serialiseAuthorize<T>(handler: AuthorizationHandler, run: () => Promise<T>): Promise<T> {
  const previous = authorizeQueues.get(handler) ?? Promise.resolve()
  const result = previous.then(run)
  authorizeQueues.set(
    handler,
    result.then(
      () => {},
      () => {},
    ),
  )
  return result
}

/**
 * Attach stored bearer tokens and refresh near expiry when the token endpoint is known.
 * On 401, discover the authorisation server, refresh or run PKCE, then retry once.
 *
 * Tokens are stored under {@link tokenStoreKey}. Every middleware sharing a store shares one
 * in-flight recovery per key, and a refresh runs inside `store.update`, so a store whose
 * `update` is atomic across processes (the file store) redeems a rotating refresh token once
 * even when several processes find the same token expired.
 */
export function createOAuthMiddleware(config: OAuthClientConfig): FetchMiddleware {
  const now = config.now ?? (() => Math.floor(Date.now() / 1000))
  const skew = config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS
  // A per-request default store would never retain a token.
  const store = config.store ?? createMemoryTokenStore()
  const flights = storeFlights(store)

  /** Recheck token identity before recovery: expiry alone could reuse a token that
   * just failed with 401 or has no `expiresAt`. A joiner retries after a rejected
   * pre-emptive flight so a fixable 401 is not lost; `flights` deduplicates it. */
  function withSingleFlight(
    key: string,
    staleAccessToken: string | undefined,
    run: () => Promise<StoredTokens>,
    accept: (current: StoredTokens) => boolean = () => true,
  ): Promise<StoredTokens> {
    function start(): Promise<StoredTokens> {
      const flight = (async () => {
        const current = await store.get(key)
        if (current != null && current.accessToken !== staleAccessToken && accept(current)) {
          return current
        }
        return run()
      })()
      flights.set(key, flight)
      // Handle rejection on this cleanup chain; an unhandled rejection could crash Node.
      flight
        .finally(() => {
          if (flights.get(key) === flight) flights.delete(key)
        })
        .catch(() => {})
      return flight
    }

    const inFlight = flights.get(key)
    if (inFlight == null) return start()
    return inFlight.catch(() => flights.get(key) ?? start())
  }

  /**
   * Refresh the token whose access token is `staleAccessToken`, inside `store.update` so the
   * read, the redemption and the write are one atomic step. If another flight or process already
   * replaced the token, that token is used and no request is sent. On a definitive
   * `invalid_grant` the refresh token is dead, so the record is deleted in the same step rather
   * than retried on every request until the next authorisation overwrites it.
   */
  function refreshAndStore(
    next: FetchLike,
    key: string,
    resource: string,
    staleAccessToken: string,
    signal?: AbortSignal,
  ): Promise<StoredTokens> {
    return withSingleFlight(key, staleAccessToken, async () => {
      let failure: { error: unknown } | undefined
      const result = await store.update(key, async (current) => {
        if (current != null && current.accessToken !== staleAccessToken) return current
        if (!isRefreshable(current)) {
          failure = { error: new Error('OAuth refresh: no refresh token stored') }
          return current
        }
        const { tokenEndpoint, refreshToken, issuer, requestedScopes } = current
        try {
          const refreshed = await exchangeRefresh({
            fetchUnwrapped: next,
            tokenEndpoint,
            clientID: config.clientID,
            resource,
            refreshToken,
            // A stepped-up token refreshes with its wider scopes, not back down to the config's.
            scopes: requestedScopes ?? config.scopes,
            now,
            signal,
          })
          return {
            ...refreshed,
            tokenEndpoint,
            issuer,
            ...(requestedScopes == null ? {} : { requestedScopes }),
          }
        } catch (error) {
          failure = { error }
          return isInvalidGrant(error) ? undefined : current
        }
      })
      if (failure != null) throw failure.error
      if (result == null) throw new Error('OAuth refresh: token record was removed')
      return result
    })
  }

  /** Discovers the authorisation server, runs PKCE + `config.handler.authorize` for `scopes`,
   * exchanges the returned code for tokens, and persists them under `key`. */
  async function authorize(params: {
    next: FetchLike
    key: string
    resource: string
    staleAccessToken: string | undefined
    wwwAuthenticate: string | null
    scopes: Array<string>
    accept?: (current: StoredTokens) => boolean
    signal?: AbortSignal
  }): Promise<StoredTokens> {
    const { next, key, resource, staleAccessToken, wwwAuthenticate, scopes, signal } = params
    // Another context (or process) may have signed in while this one waited for the handler.
    const current = await store.get(key)
    if (
      current != null &&
      current.accessToken !== staleAccessToken &&
      (params.accept?.(current) ?? true)
    ) {
      return current
    }

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
      if (scopes.length > 0) {
        authURL.searchParams.set('scope', scopes.join(' '))
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
      ...(scopes.length > 0 ? { requestedScopes: scopes } : {}),
      tokenEndpoint: as.token_endpoint,
      issuer: as.issuer,
    }
    await store.set(key, tokens)
    return tokens
  }

  return (next) => {
    return async (url, init) => {
      // Threaded through every OAuth subrequest below so aborting the caller's request cancels the
      // whole recovery flow instead of leaving it running in the background.
      const signal = init?.signal ?? undefined
      const u = new URL(url)
      const loopback = isLoopbackHost(u.hostname)
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
        throw new Error(
          `OAuth requires an https (or loopback) transport URL, got: ${u.protocol}//${u.host}`,
        )
      }

      const resource = canonicalResource(config.resource ?? url)
      const key = tokenStoreKey({ resource, clientID: config.clientID, scopes: config.scopes })
      let tokens = await store.get(key)

      if (isRefreshable(tokens) && nearExpiry(tokens, now, skew)) {
        // Best-effort: a failed refresh (network error, non-2xx, non-bearer token_type) must
        // not fail the outbound request outright -- it proceeds on the current, possibly-stale
        // token, and the 401 path below recovers.
        try {
          tokens = await refreshAndStore(next, key, resource, tokens.accessToken, signal)
        } catch (error) {
          // A dead refresh token was cleared: send no stale token, so the 401 goes straight to
          // authorisation instead of redeeming it again.
          if (isInvalidGrant(error)) tokens = undefined
        }
      }

      const attach = (requestInit: RequestInit | undefined): RequestInit => {
        const headers = new Headers(requestInit?.headers)
        if (tokens != null)
          headers.set('Authorization', `${tokens.tokenType} ${tokens.accessToken}`)
        return { ...requestInit, headers }
      }

      const response = await next(url, tokens != null ? attach(init) : init)
      if (response.status === 403) return await stepUp(response)
      if (response.status !== 401) return response

      // Cancel the 401 body before recovery: an SSE/unbounded body would pin the socket for the
      // whole refresh-then-authorise flow, which can be interactive and multi-minute.
      await response.body?.cancel().catch(() => {})

      // Prefer a refresh over full re-authorisation when a refresh token is available: it is
      // cheaper and does not require the interactive handler. Only fall through to `authorize`
      // when there is no refresh token/endpoint, or the refresh itself fails.
      if (isRefreshable(tokens)) {
        try {
          tokens = await refreshAndStore(next, key, resource, tokens.accessToken, signal)
          return next(url, attach(init))
        } catch {
          // Fall through to full authorisation below.
        }
      }

      const stale = tokens?.accessToken
      const wwwAuthenticate = response.headers.get('WWW-Authenticate')
      // Signing in again keeps any scopes a step-up added, plus a `scope` the 401 names.
      const scopes = unionScopes(
        config.scopes,
        tokens?.requestedScopes,
        splitScopes(parseBearerChallenge(wwwAuthenticate)?.scope),
      )
      const authorized = await withSingleFlight(key, stale, () => {
        return serialiseAuthorize(config.handler, () => {
          return authorize({
            next,
            key,
            resource,
            staleAccessToken: stale,
            wwwAuthenticate,
            scopes,
            signal,
          })
        })
      })
      tokens = authorized
      return next(url, attach(init))

      /**
       * A `403 insufficient_scope` naming scopes this client has not yet asked for: sign in again
       * for the wider set and retry once. Any other `403` (or one with nothing new to ask for) is
       * returned as-is, body intact, so the transport can surface the server's error.
       */
      async function stepUp(forbidden: Response): Promise<Response> {
        if (config.stepUp === false || tokens == null) return forbidden
        const wwwAuthenticate = forbidden.headers.get('WWW-Authenticate')
        const challenge = parseBearerChallenge(wwwAuthenticate)
        if (challenge?.error !== 'insufficient_scope') return forbidden
        const challenged = splitScopes(challenge.scope)
        const held = unionScopes(config.scopes, tokens.requestedScopes, splitScopes(tokens.scope))
        if (challenged.every((scope) => held.includes(scope))) return forbidden
        await forbidden.body?.cancel().catch(() => {})

        const wanted = unionScopes(held, challenged)
        const accept = (current: StoredTokens) => coversScopes(current, wanted)
        const stale = tokens.accessToken
        const run = (staleAccessToken: string) => () =>
          serialiseAuthorize(config.handler, () => {
            return authorize({
              next,
              key,
              resource,
              staleAccessToken,
              wwwAuthenticate,
              scopes: wanted,
              accept,
              signal,
            })
          })
        let elevated = await withSingleFlight(key, stale, run(stale), accept)
        // Joined a flight for something else (a refresh, a narrower step-up): ask once more.
        if (!accept(elevated)) {
          elevated = await withSingleFlight(
            key,
            elevated.accessToken,
            run(elevated.accessToken),
            accept,
          )
        }
        tokens = elevated
        return next(url, attach(init))
      }
    }
  }
}
