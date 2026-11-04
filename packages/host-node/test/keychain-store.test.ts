import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoredTokens } from '@mokei/http-client'
import { expect, test } from 'vitest'

import { withFileLock } from '../src/file-lock.js'
import { createKeychainStore, type KeychainBackend } from '../src/keychain-store.js'
import { createKeychainTokenStore, KEYCHAIN_TOKEN_SERVICE } from '../src/oauth/keychain-store.js'
import { createNodeOAuthMiddleware } from '../src/oauth/node-middleware.js'

/** An in-memory keychain: `service -> account -> password`, like the OS one. */
function memoryKeychain(): KeychainBackend & { entries: Map<string, Map<string, string>> } {
  const entries = new Map<string, Map<string, string>>()
  const service = (name: string) => {
    let accounts = entries.get(name)
    if (accounts == null) {
      accounts = new Map()
      entries.set(name, accounts)
    }
    return accounts
  }
  return {
    entries,
    async getPassword(name, account) {
      return service(name).get(account) ?? null
    },
    async setPassword(name, account, password) {
      service(name).set(account, password)
    },
    async deletePassword(name, account) {
      return service(name).delete(account)
    },
    async listAccounts(name) {
      return [...service(name).keys()]
    },
  }
}

async function tempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'mokei-keychain-'))
}

test('stores JSON values per account under the service', async () => {
  const backend = memoryKeychain()
  const store = createKeychainStore<{ v: number }>({ service: 'svc', backend })
  await store.set('a', { v: 1 })
  await store.set('b', { v: 2 })
  expect(await store.get('a')).toEqual({ v: 1 })
  expect(await store.get('missing')).toBeUndefined()
  expect((await store.keys()).sort()).toEqual(['a', 'b'])
  expect(backend.entries.get('svc')?.get('a')).toBe('{"v":1}')
  await store.delete('a')
  await store.delete('a')
  expect(await store.keys()).toEqual(['b'])
})

test('a value that does not parse reads as absent', async () => {
  const backend = memoryKeychain()
  await backend.setPassword('svc', 'k', 'not json')
  const store = createKeychainStore<{ v: number }>({ service: 'svc', backend })
  expect(await store.get('k')).toBeUndefined()
  expect(await store.update('k', (current) => current ?? { v: 7 })).toEqual({ v: 7 })
})

test('update is serialised, returning current writes nothing, undefined deletes', async () => {
  const backend = memoryKeychain()
  const store = createKeychainStore<number>({ service: 'svc', backend })
  await Promise.all(
    Array.from({ length: 20 }, () =>
      store.update('n', async (current) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return (current ?? 0) + 1
      }),
    ),
  )
  expect(await store.get('n')).toBe(20)

  let writes = 0
  const counting: KeychainBackend = {
    ...backend,
    async setPassword(...args) {
      writes += 1
      await backend.setPassword(...args)
    },
  }
  const watched = createKeychainStore<number>({ service: 'svc', backend: counting })
  expect(await watched.update('n', (current) => current)).toBe(20)
  expect(writes).toBe(0)
  await expect(
    watched.update('n', () => {
      throw new Error('nope')
    }),
  ).rejects.toThrow('nope')
  expect(await watched.get('n')).toBe(20)
  expect(await watched.update('n', () => undefined)).toBeUndefined()
  expect(await watched.keys()).toEqual([])
})

test('writes wait for the lock file another process holds', async () => {
  const dir = await tempDir()
  const lockPath = join(dir, 'keychain.lock')
  const backend = memoryKeychain()
  const store = createKeychainStore<number>({ service: 'svc', backend, lockPath })
  const order: Array<string> = []
  let release!: () => void
  const held = withFileLock(lockPath, { staleLockMs: 10_000, lockTimeoutMs: 5_000 }, async () => {
    order.push('held')
    await new Promise<void>((resolve) => {
      release = resolve
    })
    order.push('released')
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const write = store.update('n', () => {
    order.push('update')
    return 1
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(order).toEqual(['held'])
  release()
  await Promise.all([held, write])
  expect(order).toEqual(['held', 'released', 'update'])
  expect(await store.get('n')).toBe(1)
  expect(await readdir(dir)).toEqual([])
})

test('createKeychainTokenStore returns one store per service and lock path', () => {
  const a = createKeychainTokenStore({ lockPath: '/tmp/mokei-test-a.lock' })
  expect(createKeychainTokenStore({ lockPath: '/tmp/mokei-test-a.lock' })).toBe(a)
  expect(createKeychainTokenStore({ lockPath: '/tmp/mokei-test-b.lock' })).not.toBe(a)
  expect(
    createKeychainTokenStore({ service: 'other', lockPath: '/tmp/mokei-test-a.lock' }),
  ).not.toBe(a)
  // An injected backend is never cached: it is the caller's own keychain.
  const backend = memoryKeychain()
  expect(createKeychainTokenStore({ backend })).not.toBe(createKeychainTokenStore({ backend }))
  expect(KEYCHAIN_TOKEN_SERVICE).toBe('mokei-oauth')
})

test('createKeychainTokenStore keeps StoredTokens in the keychain service', async () => {
  const backend = memoryKeychain()
  const store = createKeychainTokenStore({ backend, lockPath: null })
  const tokens: StoredTokens = { accessToken: 'a', tokenType: 'Bearer', refreshToken: 'r' }
  await store.set('key', tokens)
  expect(backend.entries.get('mokei-oauth')?.get('key')).toBe(JSON.stringify(tokens))
  expect(await store.get('key')).toEqual(tokens)
})

test('createNodeOAuthMiddleware refuses tokensPath together with keychain', () => {
  expect(() =>
    createNodeOAuthMiddleware({ clientID: 'c', tokensPath: './t.json', keychain: true }),
  ).toThrow('Pass either `tokensPath` or `keychain`, not both')
})
