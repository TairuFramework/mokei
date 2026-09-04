import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { createFileTokenStore } from '../src/oauth/file-store.js'

test('persists tokens to disk, owner-only, and round-trips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const file = join(dir, 'tokens.json')
  const store = createFileTokenStore(file)
  await store.set('https://mcp.example.com/mcp', { accessToken: 'a', tokenType: 'Bearer' })

  const reopened = createFileTokenStore(file)
  expect((await reopened.get('https://mcp.example.com/mcp'))?.accessToken).toBe('a')

  if (process.platform !== 'win32') {
    const mode = (await stat(file)).mode & 0o777
    expect(mode).toBe(0o600)
  }
  // no plaintext key names leaked beyond the token value structure is fine; just assert JSON parses
  JSON.parse(await readFile(file, 'utf8'))
})

test('concurrent sets for different keys do not clobber each other', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const file = join(dir, 'tokens.json')
  const store = createFileTokenStore(file)

  await Promise.all([
    store.set('https://a.example.com/mcp', { accessToken: 'a', tokenType: 'Bearer' }),
    store.set('https://b.example.com/mcp', { accessToken: 'b', tokenType: 'Bearer' }),
  ])

  expect((await store.get('https://a.example.com/mcp'))?.accessToken).toBe('a')
  expect((await store.get('https://b.example.com/mcp'))?.accessToken).toBe('b')
})

test('two independent stores sharing the same path serialize through one mutex (H3)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const file = join(dir, 'tokens.json')
  const storeA = createFileTokenStore(file)
  const storeB = createFileTokenStore(file)

  await Promise.all([
    storeA.set('a', { accessToken: 'a', tokenType: 'Bearer' }),
    storeB.set('b', { accessToken: 'b', tokenType: 'Bearer' }),
  ])

  const reader = createFileTokenStore(file)
  expect((await reader.get('a'))?.accessToken).toBe('a')
  expect((await reader.get('b'))?.accessToken).toBe('b')
})

test('treats corrupt file as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const file = join(dir, 'tokens.json')
  await (await import('node:fs/promises')).writeFile(file, 'not json', 'utf8')
  const store = createFileTokenStore(file)
  expect(await store.get('anything')).toBeUndefined()
})

test('reading a nonexistent path returns undefined for any key (ENOENT -> {})', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const file = join(dir, 'does-not-exist.json')
  const store = createFileTokenStore(file)
  expect(await store.get('anything')).toBeUndefined()
})

test('a top-level JSON array is treated as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const file = join(dir, 'tokens.json')
  await (await import('node:fs/promises')).writeFile(file, '[]', 'utf8')
  const store = createFileTokenStore(file)
  expect(await store.get('anything')).toBeUndefined()
})

// M3: `pathTails` reclaims its per-path entry once the tail settles (instead of retaining one
// entry per distinct resolved path for the process lifetime). The map is module-private and not
// part of the public API, so this can't assert on the map directly without widening that surface
// -- instead it exercises the case the reclamation must not break: a `set` that fully settles,
// then further `get`/`set` calls against the *same* resolved path (which would share a stale
// entry were it ever wrongly deleted mid-flight) must still read/write correctly. The companion
// "two independent stores sharing the same path serialize through one mutex (H3)" test above
// covers the concurrent-chaining half: the second `set` must observe the first op's tail via
// `pathTails.get(resolved)` *before* it settles, so the identity-checked delete in `serialize`
// must not remove a still-live chain out from under a racing op.
test('M3: repeated sequential ops against the same path keep working after the tail entry is reclaimed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const file = join(dir, 'tokens.json')
  const store = createFileTokenStore(file)

  await store.set('k1', { accessToken: 'first', tokenType: 'Bearer' })
  // By now the first op's tail has settled and, per the reclamation, its `pathTails` entry
  // should have been deleted (or at least is no longer required for correctness) -- a fresh
  // `serialize` call for this path must fall back to `Promise.resolve()` and still behave.
  await new Promise((r) => setTimeout(r, 0))

  await store.set('k2', { accessToken: 'second', tokenType: 'Bearer' })
  expect((await store.get('k1'))?.accessToken).toBe('first')
  expect((await store.get('k2'))?.accessToken).toBe('second')

  // A later concurrent pair against the same path must still serialize correctly post-reclamation.
  await Promise.all([
    store.set('k3', { accessToken: 'third', tokenType: 'Bearer' }),
    store.set('k4', { accessToken: 'fourth', tokenType: 'Bearer' }),
  ])
  expect((await store.get('k3'))?.accessToken).toBe('third')
  expect((await store.get('k4'))?.accessToken).toBe('fourth')
})

test('a non-ENOENT read error propagates instead of being masked as empty', async () => {
  // Point the store at a directory path so `readFile` throws EISDIR rather than ENOENT.
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const dirAsFile = join(dir, 'a-directory')
  await mkdir(dirAsFile)
  const store = createFileTokenStore(dirAsFile)
  await expect(store.get('anything')).rejects.toThrow()
})
