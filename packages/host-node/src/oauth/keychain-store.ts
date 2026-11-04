import { join, resolve } from 'node:path'
import type { StoredTokens, TokenStore } from '@mokei/http-client'
import { getStateDir } from '@tejika/env'

import type { FileLockOptions } from '../file-lock.js'
import { createKeychainStore, type KeychainBackend } from '../keychain-store.js'

/** Keychain service the CLI's OAuth tokens are stored under. */
export const KEYCHAIN_TOKEN_SERVICE = 'mokei-oauth'

export type KeychainTokenStoreOptions = FileLockOptions & {
  /** Keychain service name (default {@link KEYCHAIN_TOKEN_SERVICE}). */
  service?: string
  /**
   * Lock file making refreshes exclusive across processes. Defaults to `oauth-keychain.lock` in
   * mokei's state directory; `null` turns cross-process locking off.
   */
  lockPath?: string | null
  /** Keychain to use instead of `@napi-rs/keyring`. */
  backend?: KeychainBackend
}

/** Default lock file for {@link createKeychainTokenStore}. */
export function defaultKeychainLockPath(): string {
  return join(getStateDir('mokei'), 'oauth-keychain.lock')
}

// One store per service and lock path, so every middleware in the process that uses the keychain
// holds the same store object and so shares its in-flight refreshes and sign-ins.
const stores = new Map<string, TokenStore>()

/**
 * A {@link TokenStore} in the OS keychain (`@napi-rs/keyring`): one entry per
 * `tokenStoreKey`, never written to a plain file. Refreshes hold a lock file shared by every
 * process using the same lock path, so a rotating refresh token is redeemed once. Calls with the
 * same service and lock path return the same store, unless a `backend` is given.
 */
export function createKeychainTokenStore(options: KeychainTokenStoreOptions = {}): TokenStore {
  const service = options.service ?? KEYCHAIN_TOKEN_SERVICE
  const lockPath =
    options.lockPath === null ? undefined : resolve(options.lockPath ?? defaultKeychainLockPath())
  const create = () => createKeychainStore<StoredTokens>({ ...options, service, lockPath })
  if (options.backend != null) return create()
  const cacheKey = JSON.stringify([service, lockPath ?? null])
  let store = stores.get(cacheKey)
  if (store == null) {
    store = create()
    stores.set(cacheKey, store)
  }
  return store
}
