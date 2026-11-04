import { createMemoryStore, type KeyValueStore } from '../store.js'

export type StoredTokens = {
  accessToken: string
  tokenType: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  /**
   * The scopes sent in the authorisation request that obtained this token. They can be wider
   * than the configured scopes after a `403 insufficient_scope` step-up. Refreshes request
   * these scopes, so a refresh never narrows the token. Absent on tokens stored before step-up
   * existed, which fall back to the configured scopes.
   */
  requestedScopes?: Array<string>
  /** Token endpoint to use for a pre-emptive or 401-triggered refresh, set on authorise. */
  tokenEndpoint?: string
  /** Authorisation server issuer this token was obtained from, set on authorise. */
  issuer?: string
}

/** Where OAuth tokens live, keyed by {@link tokenStoreKey}. */
export type TokenStore = KeyValueStore<StoredTokens>

export function createMemoryTokenStore(): TokenStore {
  return createMemoryStore<StoredTokens>()
}

/**
 * The token-store key for one client configuration: the canonical resource, the client ID and
 * the sorted, de-duplicated scopes, as a JSON array. Configurations that differ in any of them
 * keep separate tokens. The issuer is not part of the key -- it is only known after discovery --
 * and is recorded in {@link StoredTokens.issuer} instead.
 */
export function tokenStoreKey(params: {
  resource: string
  clientID: string
  scopes?: Array<string>
}): string {
  const scopes = [...new Set(params.scopes ?? [])].sort()
  return JSON.stringify([params.resource, params.clientID, scopes])
}

/** Splits a {@link tokenStoreKey} back into its parts, or `undefined` for a key it did not make. */
export function parseTokenStoreKey(
  key: string,
): { resource: string; clientID: string; scopes: Array<string> } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(key)
  } catch {
    return undefined
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    !Array.isArray(parsed[2]) ||
    !parsed[2].every((scope) => typeof scope === 'string')
  ) {
    return undefined
  }
  return { resource: parsed[0], clientID: parsed[1], scopes: parsed[2] }
}
