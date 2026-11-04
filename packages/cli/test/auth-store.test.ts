import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { openTokenStore } from '../src/auth-store.js'

const directories: Array<string> = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

test('requires exactly one of --keychain and --tokens', () => {
  expect(() => openTokenStore({})).toThrow('Choose a token store: --keychain or --tokens <path>')
  expect(() => openTokenStore({ keychain: true, tokens: './t.json' })).toThrow(
    'Pass either --keychain or --tokens <path>, not both',
  )
})

test('--tokens opens the file store at that path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mokei-auth-'))
  directories.push(dir)
  const store = openTokenStore({ tokens: join(dir, 'tokens.json') })
  await store.set('k', { accessToken: 'a', tokenType: 'Bearer' })
  expect(await openTokenStore({ tokens: join(dir, 'tokens.json') }).get('k')).toEqual({
    accessToken: 'a',
    tokenType: 'Bearer',
  })
})
