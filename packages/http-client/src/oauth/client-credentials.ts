import {
  type ClientAssertionSigner,
  createClientAssertion,
  requestClientCredentialsToken,
} from '@kokuin/oauth'
import { createRuntime, type Runtime } from '@sozai/runtime'

import type { FetchLike, FetchMiddleware } from '../transport.js'
import { parseBearerChallenge, splitScopes } from './challenge.js'
import { type AuthServerMetadata, discover, parseResourceMetadataURL } from './discovery.js'
import {
  DEFAULT_CLOCK_SKEW_SECONDS,
  isSecureOrLoopbackURL,
  nearExpiry,
  oauthFetchFor,
  requireSecureTransportURL,
  runtimeFor,
  toStoredTokens,
  withAuthorization,
  withSingleFlight,
} from './middleware.js'
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
  /** Signs the `private_key_jwt` client assertion (`EdDSA` or `ES256`). */
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

/** Checks an explicitly configured resource, which is then used verbatim. */
function validateResource(resource: string): string {
  let u: URL
  try {
    u = new URL(resource)
  } catch (cause) {
    throw new Error(`Client credentials resource must be an absolute URL, got: ${resource}`, {
      cause,
    })
  }
  if (!isSecureOrLoopbackURL(u)) {
    throw new Error(
      `Client credentials resource must be https (or loopback http), got: ${u.protocol}//${u.host}`,
    )
  }
  if (resource.includes('#')) {
    throw new Error(`Client credentials resource must not have a fragment, got: ${resource}`)
  }
  return resource
}

/** Requires a present metadata list to be an array of strings that contains `value`. Only an
 * `undefined` (absent) list passes unchecked: the client is preregistered for this grant, and the
 * server's own error surfaces if it disagrees. Any other non-array value, JSON `null` included,
 * is malformed. */
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

/** Runs `run`, rejecting with `signal.reason` instead of whatever error a step that noticed the
 * abort threw. */
async function reasonOnAbort<T>(
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    throw error
  }
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

  /** Only a record obtained from the pinned issuer is ever used. */
  const isPinned = (tokens: StoredTokens): boolean => tokens.issuer === config.issuer

  /** One grant per key at a time, through the flights shared with every middleware on `store`.
   * Every record obtained, from the store or a joined flight, is checked against the pin: a
   * foreign one is never used, and the grant runs once more in its place. */
  async function obtain(
    key: string,
    staleAccessToken: string | undefined,
    run: () => Promise<StoredTokens>,
  ): Promise<StoredTokens> {
    let obtained = await withSingleFlight({ store, key, staleAccessToken, run, accept: isPinned })
    if (!isPinned(obtained)) {
      obtained = await withSingleFlight({
        store,
        key,
        staleAccessToken: obtained.accessToken,
        run,
        accept: isPinned,
      })
    }
    if (!isPinned(obtained)) {
      throw new Error(`OAuth client credentials: token record is not from issuer ${config.issuer}`)
    }
    return obtained
  }

  /** Signs a fresh assertion (new `jti`), requests a token at `tokenEndpoint` and stores it under
   * `key`. Nothing is stored once `signal` has aborted. */
  async function grantAndStore(params: {
    next: FetchLike
    key: string
    resource: string
    tokenEndpoint: string
    scopes: Array<string>
    signal?: AbortSignal
  }): Promise<StoredTokens> {
    const { next, key, resource, tokenEndpoint, scopes, signal } = params
    const assertion = await createClientAssertion({
      signer: config.signer,
      clientID: config.clientID,
      audience: config.issuer,
      lifetimeSeconds: config.assertionLifetimeSeconds,
      now,
      runtime,
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
    const tokens: StoredTokens = {
      ...toStoredTokens(data, now),
      ...(scopes.length > 0 ? { requestedScopes: scopes } : {}),
      tokenEndpoint,
      issuer: config.issuer,
    }
    signal?.throwIfAborted()
    await store.set(key, tokens)
    return tokens
  }

  return (next) => {
    return async (url, init) => {
      // Threaded through every OAuth subrequest so aborting the caller's request cancels the grant.
      const signal = init?.signal ?? undefined
      const oauthNext = oauthFetchFor(next, init)
      requireSecureTransportURL(url)

      const resource = configuredResource ?? canonicalResource(url)
      const key = clientCredentialsStoreKey({
        issuer: config.issuer,
        resource,
        clientID: config.clientID,
        scopes: config.scopes,
      })
      const stored = await store.get(key)
      let tokens = stored != null && isPinned(stored) ? stored : undefined

      if (tokens?.tokenEndpoint != null && nearExpiry(tokens, now, skew)) {
        const { tokenEndpoint, accessToken } = tokens
        const scopes = tokens.requestedScopes ?? config.scopes ?? []
        try {
          tokens = await obtain(key, accessToken, () =>
            reasonOnAbort(signal, () =>
              grantAndStore({ next: oauthNext, key, resource, tokenEndpoint, scopes, signal }),
            ),
          )
        } catch {
          // Deliberately best-effort: any failure, an abort included, is left to `next()` below,
          // which sends the current token (and rejects on an aborted signal); a 401 recovers.
        }
      }

      const attach = (requestInit: RequestInit | undefined): RequestInit =>
        withAuthorization(requestInit, tokens)

      const response = await next(url, tokens != null ? attach(init) : init)
      if (response.status !== 401) return response
      // An SSE/unbounded 401 body would pin the socket for the whole grant.
      await response.body?.cancel().catch(() => {})

      const wwwAuthenticate = response.headers.get('WWW-Authenticate')
      const scopes = config.scopes ?? splitScopes(parseBearerChallenge(wwwAuthenticate)?.scope)
      tokens = await obtain(key, tokens?.accessToken, () =>
        reasonOnAbort(signal, async () => {
          const { as } = await discover({
            resource,
            resourceMetadataURL: parseResourceMetadataURL(wwwAuthenticate) ?? undefined,
            fetch: oauthNext,
            grant: 'client_credentials',
            expectedIssuer: config.issuer,
            signal,
          })
          requireCompatible(as, config.signer.alg)
          return await grantAndStore({
            next: oauthNext,
            key,
            resource,
            tokenEndpoint: as.token_endpoint,
            scopes,
            signal,
          })
        }),
      )
      return next(url, attach(init))
    }
  }
}
