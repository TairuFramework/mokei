import {
  type ClientAssertionSigner,
  createClientAssertion,
  requestClientCredentialsToken,
} from '@kokuin/oauth'
import { createRuntime, type Runtime } from '@sozai/runtime'

import { REQUEST_TIMEOUT, requestTimeoutOf, type TimedRequestInit } from '../request-timeout.js'
import type { FetchLike, FetchMiddleware } from '../transport.js'
import { parseBearerChallenge, splitScopes } from './challenge.js'
import {
  type AuthServerMetadata,
  discover,
  isLoopbackHost,
  parseResourceMetadataURL,
} from './discovery.js'
import { nearExpiry, runtimeFor, toStoredTokens } from './middleware.js'
import { canonicalResource } from './resource.js'
import {
  clientCredentialsStoreKey,
  createMemoryTokenStore,
  type StoredTokens,
  type TokenStore,
} from './store.js'

export { type ClientAssertionSigner, createWebCryptoAssertionSigner } from '@kokuin/oauth'

export type ClientCredentialsConfig = {
  clientID: string
  /** The authorisation server issuer this client is registered with. It must be listed in the
   * resource's metadata, and it is the audience of every client assertion. */
  issuer: string
  /** Signs the `private_key_jwt` client assertion. */
  signer: ClientAssertionSigner
  /** Scopes to request. When unset, the scopes named by the `401` challenge are requested. */
  scopes?: Array<string>
  /** Resource indicator, used verbatim: an absolute `https` URL (`http` only on loopback) with
   * no fragment. Defaults to the canonical form of the request URL. */
  resource?: string
  store?: TokenStore
  /** Re-run the grant this many seconds before actual expiry. */
  clockSkewSeconds?: number
  /** Current time in seconds; defaults to the wall clock. */
  now?: () => number
  /** Lifetime of each client assertion, in seconds (default `60`). */
  assertionLifetimeSeconds?: number
  /** Platform services: `getRandomValues` for the assertion `jti`. Defaults to `createRuntime()`
   * from `@sozai/runtime`. Requests go through the transport's fetch. */
  runtime?: Runtime
}

/** Default re-grant window before actual token expiry, in seconds. */
const DEFAULT_CLOCK_SKEW_SECONDS = 60

/** In-flight grants, shared by every client-credentials middleware using the same store. Kept
 * apart from the authorisation-code flights: the keys never overlap, and neither do the flows. */
const flightsByStore = new WeakMap<TokenStore, Map<string, Promise<StoredTokens>>>()

function storeFlights(store: TokenStore): Map<string, Promise<StoredTokens>> {
  let flights = flightsByStore.get(store)
  if (flights == null) {
    flights = new Map()
    flightsByStore.set(store, flights)
  }
  return flights
}

function requireSecureURL(url: string, label: string): URL {
  let u: URL
  try {
    u = new URL(url)
  } catch (cause) {
    throw new Error(`${label} must be an absolute URL, got: ${url}`, { cause })
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackHost(u.hostname))) {
    throw new Error(`${label} must be https (or loopback http), got: ${u.protocol}//${u.host}`)
  }
  return u
}

/** Checks an explicitly configured resource, which is then used verbatim. */
function validateResource(resource: string): string {
  requireSecureURL(resource, 'Client credentials resource')
  if (resource.includes('#')) {
    throw new Error(`Client credentials resource must not have a fragment, got: ${resource}`)
  }
  return resource
}

/** Requires a present metadata list to be an array of strings that contains `value`. An absent
 * list passes: the client is preregistered for this grant, and the server's own error surfaces
 * if it disagrees. */
function requireListed(
  as: AuthServerMetadata,
  field:
    | 'grant_types_supported'
    | 'token_endpoint_auth_methods_supported'
    | 'token_endpoint_auth_signing_alg_values_supported',
  value: string,
  missing: string,
): void {
  const list = as[field]
  if (list === undefined) return
  if (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string')) {
    throw new Error(`AS metadata field ${field} is malformed`)
  }
  if (!list.includes(value)) throw new Error(missing)
}

function requireCompatible(as: AuthServerMetadata, alg: string): void {
  requireListed(
    as,
    'grant_types_supported',
    'client_credentials',
    'AS metadata does not list grant client_credentials',
  )
  requireListed(
    as,
    'token_endpoint_auth_methods_supported',
    'private_key_jwt',
    'AS metadata does not list auth method private_key_jwt',
  )
  requireListed(
    as,
    'token_endpoint_auth_signing_alg_values_supported',
    alg,
    `AS metadata does not list signing alg ${alg}`,
  )
}

/**
 * Obtain tokens with the OAuth client credentials grant, authenticating with a signed
 * `private_key_jwt` assertion, and attach them as bearer tokens.
 *
 * A stored token is attached when it was obtained from the pinned `issuer`. Near expiry the grant
 * runs again at the stored token endpoint. On `401` the middleware discovers the pinned
 * authorisation server, checks its metadata is compatible, grants, stores and retries once; a
 * second `401` is returned. A `403` passes through. Tokens are stored under
 * {@link clientCredentialsStoreKey}, apart from authorisation-code tokens, and every middleware
 * sharing a store shares one in-flight grant per key.
 */
export function createClientCredentialsMiddleware(
  config: ClientCredentialsConfig,
): FetchMiddleware {
  const configuredResource = config.resource == null ? undefined : validateResource(config.resource)
  const now = config.now ?? (() => Math.floor(Date.now() / 1000))
  const runtime = config.runtime ?? createRuntime()
  const skew = config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS
  // A per-request default store would never retain a token.
  const store = config.store ?? createMemoryTokenStore()
  const flights = storeFlights(store)

  /** Only a record obtained from the pinned issuer is ever used. */
  function pinned(tokens: StoredTokens | undefined): StoredTokens | undefined {
    return tokens?.issuer === config.issuer ? tokens : undefined
  }

  /** One grant per key at a time. A flight first rechecks the store: a token other than the
   * one that prompted it was obtained meanwhile and is used as-is. A joiner whose flight
   * rejected (for instance, aborted by its starter) starts a fresh one. */
  function withSingleFlight(
    key: string,
    staleAccessToken: string | undefined,
    run: () => Promise<StoredTokens>,
  ): Promise<StoredTokens> {
    function start(): Promise<StoredTokens> {
      const flight = (async () => {
        const current = pinned(await store.get(key))
        if (current != null && current.accessToken !== staleAccessToken) return current
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

  /** Signs a fresh assertion, requests a token at `tokenEndpoint` and stores it under `key`. */
  async function grantAndStore(params: {
    next: FetchLike
    key: string
    resource: string
    tokenEndpoint: string
    scopes: Array<string>
    signal?: AbortSignal
  }): Promise<StoredTokens> {
    const { next, key, resource, tokenEndpoint, scopes, signal } = params
    let tokens: StoredTokens
    try {
      const assertion = await createClientAssertion({
        signer: config.signer,
        clientID: config.clientID,
        audience: config.issuer,
        lifetimeSeconds: config.assertionLifetimeSeconds,
        now,
        getRandomValues: runtime.getRandomValues,
      })
      signal?.throwIfAborted()
      const data = await requestClientCredentialsToken({
        runtime: runtimeFor(next, runtime),
        tokenEndpoint,
        clientID: config.clientID,
        assertion,
        scope: scopes.length > 0 ? scopes.join(' ') : undefined,
        extraParams: { resource },
        signal,
      })
      signal?.throwIfAborted()
      tokens = {
        ...toStoredTokens(data, now),
        ...(scopes.length > 0 ? { requestedScopes: scopes } : {}),
        tokenEndpoint,
        issuer: config.issuer,
      }
    } catch (error) {
      // Surface the caller's reason, whichever step noticed the abort.
      if (signal?.aborted) throw signal.reason
      throw error
    }
    await store.set(key, tokens)
    return tokens
  }

  return (next) => {
    return async (url, init) => {
      // Threaded through every OAuth subrequest so aborting the caller's request cancels the grant.
      const signal = init?.signal ?? undefined
      // Discovery and token calls inherit the triggering request's timeout tag.
      const timeout = requestTimeoutOf(init)
      const oauthNext: FetchLike =
        timeout == null
          ? next
          : (oauthURL, oauthInit) =>
              next(oauthURL, { ...oauthInit, [REQUEST_TIMEOUT]: timeout } as TimedRequestInit)
      requireSecureURL(url, 'OAuth transport URL')

      const resource = configuredResource ?? canonicalResource(url)
      const key = clientCredentialsStoreKey({
        issuer: config.issuer,
        resource,
        clientID: config.clientID,
        scopes: config.scopes,
      })
      let tokens = pinned(await store.get(key))

      if (tokens?.tokenEndpoint != null && nearExpiry(tokens, now, skew)) {
        const { tokenEndpoint, accessToken } = tokens
        const scopes = tokens.requestedScopes ?? config.scopes ?? []
        // Best-effort: a failed re-grant proceeds on the current token, and a 401 recovers.
        try {
          tokens = await withSingleFlight(key, accessToken, () =>
            grantAndStore({ next: oauthNext, key, resource, tokenEndpoint, scopes, signal }),
          )
        } catch {}
      }

      const attach = (requestInit: RequestInit | undefined): RequestInit => {
        const headers = new Headers(requestInit?.headers)
        if (tokens != null) {
          headers.set('Authorization', `${tokens.tokenType} ${tokens.accessToken}`)
        }
        return { ...requestInit, headers }
      }

      const response = await next(url, tokens != null ? attach(init) : init)
      if (response.status !== 401) return response
      // An SSE/unbounded 401 body would pin the socket for the whole grant.
      await response.body?.cancel().catch(() => {})

      const wwwAuthenticate = response.headers.get('WWW-Authenticate')
      const scopes = config.scopes ?? splitScopes(parseBearerChallenge(wwwAuthenticate)?.scope)
      tokens = await withSingleFlight(key, tokens?.accessToken, async () => {
        const { as } = await discover({
          resource,
          resourceMetadataURL: parseResourceMetadataURL(wwwAuthenticate) ?? undefined,
          fetch: oauthNext,
          grant: 'client_credentials',
          expectedIssuer: config.issuer,
          signal,
        })
        requireCompatible(as, config.signer.alg)
        return grantAndStore({
          next: oauthNext,
          key,
          resource,
          tokenEndpoint: as.token_endpoint,
          scopes,
          signal,
        })
      })
      return next(url, attach(init))
    }
  }
}
