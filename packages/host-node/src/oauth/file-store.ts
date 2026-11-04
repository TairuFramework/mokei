import type { StoredTokens, TokenStore } from '@mokei/http-client'

import { createJSONFileStore, type JSONFileStoreOptions } from '../json-file-store.js'

/** A {@link TokenStore} in a JSON file (mode 0600), safe to share between processes: see
 * {@link createJSONFileStore}. */
export function createFileTokenStore(path: string, options?: JSONFileStoreOptions): TokenStore {
  return createJSONFileStore<StoredTokens>(path, options)
}
