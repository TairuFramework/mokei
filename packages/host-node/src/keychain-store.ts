import { resolve } from 'node:path'
import type { KeyValueStore } from '@mokei/http-client'
import { createKeyedQueue } from '@sozai/async'

import { type FileLockOptions, resolveFileLockOptions, withFileLock } from './file-lock.js'

/**
 * The OS keychain operations a {@link createKeychainStore} needs, one service at a time. The
 * default backend is `@napi-rs/keyring` (macOS Keychain, Windows Credential Manager, the Linux
 * Secret Service). Pass another to test, or to target a different secret store.
 */
export type KeychainBackend = {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  /** Resolves `false` when the entry did not exist. */
  deletePassword(service: string, account: string): Promise<boolean>
  /** Every account stored under `service`. */
  listAccounts(service: string): Promise<Array<string>>
}

export type KeychainStoreOptions = FileLockOptions & {
  /** Keychain service name every entry is stored under; one store per service. */
  service: string
  /**
   * Lock file that makes `set`, `delete` and `update` exclusive across processes. The keychain
   * itself has no locking, so without it only writes in this process are serialised, and two
   * processes refreshing one rotating token can both redeem it. Must be on a local filesystem.
   */
  lockPath?: string
  /** Keychain to use instead of `@napi-rs/keyring`. */
  backend?: KeychainBackend
}

let defaultBackend: Promise<KeychainBackend> | undefined

/** Thrown when the OS keychain cannot be used: no keychain service (a headless Linux machine
 * without a Secret Service), access refused, or the native module failed to load. */
export class KeychainUnavailableError extends Error {
  constructor(params: KeychainUnavailableErrorParams) {
    const { cause } = params
    super(
      `The OS keychain is not available: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
    this.name = 'KeychainUnavailableError'
  }
}

export type KeychainUnavailableErrorParams = { cause: unknown }

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: the cause is passed through the params object
    throw new KeychainUnavailableError({ cause: error })
  }
}

/** Loads `@napi-rs/keyring` on first use, so a process that never opens a keychain store never
 * loads the native module. */
function loadDefaultBackend(): Promise<KeychainBackend> {
  defaultBackend ??= guard(() => import('@napi-rs/keyring')).then(
    ({ AsyncEntry, findCredentialsAsync }): KeychainBackend => ({
      getPassword: (service, account) =>
        guard(() => new AsyncEntry(service, account).getPassword()),
      setPassword: (service, account, password) =>
        guard(() => new AsyncEntry(service, account).setPassword(password)),
      deletePassword: (service, account) =>
        guard(() => new AsyncEntry(service, account).deletePassword()),
      listAccounts: (service) =>
        guard(async () =>
          (await findCredentialsAsync(service)).map((credential) => credential.account),
        ),
    }),
  )
  // A failed load is retried on the next use rather than cached.
  defaultBackend.catch(() => {
    defaultBackend = undefined
  })
  return defaultBackend
}

// Stores sharing a service must not interleave read-modify-write operations in-process; the lock
// file does the same across processes.
const serviceQueue = createKeyedQueue<string>()

/**
 * A {@link KeyValueStore} kept in the OS keychain: one entry per key under `service`, the key as
 * the account name and the value JSON-encoded as the password. A value that does not parse reads
 * as absent, and the next write replaces it.
 *
 * `set`, `delete` and `update` are serialised per service in this process and, with `lockPath`,
 * across processes, so `update` is a cross-process read-decide-write. Reads take no lock. `fn`
 * passed to `update` must not write to a store sharing the service: it runs while the lock is
 * held.
 */
export function createKeychainStore<V>(options: KeychainStoreOptions): KeyValueStore<V> {
  const { service } = options
  const lockPath = options.lockPath == null ? undefined : resolve(options.lockPath)
  const lockOptions = resolveFileLockOptions(options)
  const backend = (): Promise<KeychainBackend> =>
    options.backend == null ? loadDefaultBackend() : Promise.resolve(options.backend)

  async function read(key: string): Promise<V | undefined> {
    const raw = await (await backend()).getPassword(service, key)
    if (raw == null) return undefined
    try {
      return JSON.parse(raw) as V
    } catch {
      return undefined
    }
  }

  async function write(key: string, value: V | undefined): Promise<void> {
    const keychain = await backend()
    if (value === undefined) await keychain.deletePassword(service, key)
    else await keychain.setPassword(service, key, JSON.stringify(value))
  }

  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    return serviceQueue.run(service, () =>
      lockPath == null ? run() : withFileLock(lockPath, lockOptions, run),
    )
  }

  return {
    get: read,
    set(key, value) {
      return exclusive(() => write(key, value))
    },
    delete(key) {
      return exclusive(() => write(key, undefined))
    },
    async keys() {
      return await (await backend()).listAccounts(service)
    },
    update(key, fn) {
      return exclusive(async () => {
        const current = await read(key)
        const next = await fn(current)
        if (next === current) return current
        await write(key, next)
        return next
      })
    },
  }
}
