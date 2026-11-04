import { mkdtemp, readdir, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { createJSONFileStore } from '../src/json-file-store.js'

async function tempFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'mokei-kv-')), 'store.json')
}

test('update is atomic across stores sharing a file and releases its lock', async () => {
  const file = await tempFile()
  const a = createJSONFileStore<number>(file)
  const b = createJSONFileStore<number>(file)
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      (i % 2 === 0 ? a : b).update('n', async (current) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return (current ?? 0) + 1
      }),
    ),
  )
  expect(await b.get('n')).toBe(20)
  const entries = await readdir(join(file, '..'))
  expect(entries.filter((name) => name.includes('.lock'))).toEqual([])
})

test('update returning current writes nothing; undefined deletes; a throw writes nothing', async () => {
  const file = await tempFile()
  const store = createJSONFileStore<{ v: number }>(file)
  await store.set('k', { v: 1 })
  const before = (await stat(file)).mtimeMs
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(await store.update('k', (current) => current)).toEqual({ v: 1 })
  expect((await stat(file)).mtimeMs).toBe(before)

  await expect(
    store.update('k', () => {
      throw new Error('nope')
    }),
  ).rejects.toThrow('nope')
  expect(await store.get('k')).toEqual({ v: 1 })

  expect(await store.update('k', () => undefined)).toBeUndefined()
  expect(await store.keys()).toEqual([])
})

test('keys lists stored keys and get ignores inherited properties', async () => {
  const file = await tempFile()
  const store = createJSONFileStore<string>(file)
  await store.set('a', 'x')
  await store.set('b', 'y')
  await store.delete('a')
  expect(await store.keys()).toEqual(['b'])
  expect(await store.get('toString')).toBeUndefined()
})

test('takes over a stale lock left by a crashed writer', async () => {
  const file = await tempFile()
  await writeFile(`${file}.lock`, 'crashed:owner')
  const old = new Date(Date.now() - 60_000)
  await utimes(`${file}.lock`, old, old)
  const store = createJSONFileStore<string>(file, { staleLockMs: 1_000 })
  await store.set('k', 'v')
  expect(await store.get('k')).toBe('v')
  const entries = await readdir(join(file, '..'))
  expect(entries.filter((name) => name.includes('.lock'))).toEqual([])
})

test('waits for a live lock and times out instead of taking it', async () => {
  const file = await tempFile()
  await writeFile(`${file}.lock`, 'live:owner')
  const store = createJSONFileStore<string>(file, { staleLockMs: 60_000, lockTimeoutMs: 100 })
  await expect(store.set('k', 'v')).rejects.toThrow(/Timed out after 100ms waiting for lock/)
  expect(await store.get('k')).toBeUndefined()
})
