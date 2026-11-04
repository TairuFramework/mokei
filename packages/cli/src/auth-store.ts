import { resolve } from 'node:path'
import { createFileTokenStore, createKeychainTokenStore } from '@mokei/host-node'
import type { TokenStore } from '@mokei/http-client'

/** How `mokei auth` picks the token store: the OS keychain, or a tokens file. */
export type TokenStoreOptions = { keychain?: boolean; tokens?: string }

/** The token store `options` names. Exactly one of `--keychain` and `--tokens` must be given. */
export function openTokenStore(options: TokenStoreOptions): TokenStore {
  if (options.keychain && options.tokens != null) {
    throw new Error('Pass either --keychain or --tokens <path>, not both')
  }
  if (options.keychain) return createKeychainTokenStore()
  if (options.tokens != null) return createFileTokenStore(resolve(options.tokens))
  throw new Error('Choose a token store: --keychain or --tokens <path>')
}
