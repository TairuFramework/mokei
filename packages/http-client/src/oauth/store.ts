export type StoredTokens = {
  accessToken: string
  tokenType: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  /** Token endpoint to use for a pre-emptive or 401-triggered refresh, set on authorize. */
  tokenEndpoint?: string
  /** Authorization server issuer this token was obtained from, set on authorize. */
  issuer?: string
}

export type TokenStore = {
  get(key: string): Promise<StoredTokens | undefined>
  set(key: string, tokens: StoredTokens): Promise<void>
  clear(key: string): Promise<void>
}

export function createMemoryTokenStore(): TokenStore {
  const map = new Map<string, StoredTokens>()
  return {
    async get(key) {
      return map.get(key)
    },
    async set(key, tokens) {
      map.set(key, tokens)
    },
    async clear(key) {
      map.delete(key)
    },
  }
}
