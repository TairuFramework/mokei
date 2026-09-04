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

test('a non-ENOENT read error propagates instead of being masked as empty', async () => {
  // Point the store at a directory path so `readFile` throws EISDIR rather than ENOENT.
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const dirAsFile = join(dir, 'a-directory')
  await mkdir(dirAsFile)
  const store = createFileTokenStore(dirAsFile)
  await expect(store.get('anything')).rejects.toThrow()
})
