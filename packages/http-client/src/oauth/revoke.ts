import type { FetchLike } from '../transport.js'
import { fetchAuthServerMetadata, isLoopbackHost } from './discovery.js'
import { fetchOAuthJSON, OAuthResponseError } from './fetch.js'
import type { StoredTokens } from './store.js'

export type RevokeTokensParams = {
  tokens: StoredTokens
  clientID: string
  /**
   * The resource the tokens are for. Allows plain-http authorisation-server endpoints only when
   * it is a loopback URL, as sign-in does.
   */
  resource: string
  /** Defaults to `globalThis.fetch`. */
  fetch?: FetchLike
  signal?: AbortSignal
}

export type RevokeTokensResult =
  | { status: 'revoked'; endpoint: string; revoked: Array<'refresh_token' | 'access_token'> }
  /** The tokens record no issuer, or its metadata lists no `revocation_endpoint`. */
  | { status: 'unsupported'; reason: string }

/**
 * Revokes stored tokens at their authorisation server (RFC 7009). It discovers the issuer's
 * `revocation_endpoint`, revokes the refresh token first (which, on most servers, also ends
 * access tokens issued from it), then the access token, as a public client sending `client_id`.
 * Throws when the metadata cannot be read or the endpoint refuses a revocation. A revoked
 * or already-invalid token is a success (RFC 7009 §2.2), and a token kind the server cannot
 * revoke (`unsupported_token_type`) is skipped and left out of `revoked`. Callers deleting the tokens locally
 * should do so whether or not this succeeds.
 */
export async function revokeTokens(params: RevokeTokensParams): Promise<RevokeTokensResult> {
  const { tokens, clientID, signal } = params
  if (tokens.issuer == null) {
    return { status: 'unsupported', reason: 'the stored tokens record no authorisation server' }
  }
  const fetch = params.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const as = await fetchAuthServerMetadata({
    issuer: tokens.issuer,
    fetch,
    allowLoopback: isLoopbackHost(new URL(params.resource).hostname),
    signal,
  })
  const endpoint = as.revocation_endpoint
  if (endpoint == null) {
    return {
      status: 'unsupported',
      reason: `${tokens.issuer} does not advertise a revocation_endpoint`,
    }
  }
  const revoked: Array<'refresh_token' | 'access_token'> = []
  const pairs: Array<['refresh_token' | 'access_token', string | undefined]> = [
    ['refresh_token', tokens.refreshToken],
    ['access_token', tokens.accessToken],
  ]
  for (const [hint, token] of pairs) {
    if (token == null) continue
    try {
      await fetchOAuthJSON(fetch, endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, token_type_hint: hint, client_id: clientID }).toString(),
        signal,
        errorLabel: 'Token revocation',
      })
    } catch (error) {
      // RFC 7009 §2.2.1: a server that cannot revoke this kind of token says so. Not a failure:
      // the refresh token, revoked first, is the one that matters.
      if (error instanceof OAuthResponseError && error.oauthError === 'unsupported_token_type') {
        continue
      }
      throw error
    }
    revoked.push(hint)
  }
  return { status: 'revoked', endpoint, revoked }
}
