import { mkdtemp, readFile, stat } from 'node:fs/promises'
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

test('treats corrupt file as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-oauth-'))
  const file = join(dir, 'tokens.json')
  await (await import('node:fs/promises')).writeFile(file, 'not json', 'utf8')
  const store = createFileTokenStore(file)
  expect(await store.get('anything')).toBeUndefined()
})
