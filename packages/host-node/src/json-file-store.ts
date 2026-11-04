import { randomBytes } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { KeyValueStore } from '@mokei/http-client'
import { createKeyedQueue } from '@sozai/async'
import { readJSONFile } from '@tejika/env'

import { type FileLockOptions, resolveFileLockOptions, withFileLock } from './file-lock.js'

export type JSONFileStoreOptions = FileLockOptions

// Stores sharing a resolved path must not interleave read-modify-write operations in-process;
// the lock file does the same across processes.
const pathQueue = createKeyedQueue<string>()

async function readAll<V>(path: string): Promise<Record<string, V>> {
  let parsed: unknown
  try {
    parsed = await readJSONFile(path, { default: {} })
  } catch (error) {
    // A subsequent write repairs corrupt JSON; filesystem failures must still propagate.
    if (error instanceof Error && error.cause instanceof SyntaxError) return {}
    throw error
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  return parsed as Record<string, V>
}

async function writeAll<V>(path: string, data: Record<string, V>): Promise<void> {
  const tmp = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(tmp, JSON.stringify(data), { mode: 0o600 })
  try {
    await rename(tmp, path)
  } catch (err) {
    // A failed rename must not leave the temp file (a second on-disk copy of every value) behind.
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * A {@link KeyValueStore} kept in one JSON file. Writes are atomic (temp file and rename, mode
 * 0600). Every `set`, `delete` and `update` holds a lock file at `<path>.lock`, so stores in
 * different processes sharing the file never lose each other's writes, and `update` is a
 * cross-process read-decide-write. Reads take no lock.
 *
 * `fn` passed to `update` must not call `set`, `delete` or `update` on a store sharing this file:
 * it runs while the lock is held.
 */
export function createJSONFileStore<V>(
  path: string,
  options: JSONFileStoreOptions = {},
): KeyValueStore<V> {
  // Resolve once so differently-spelled paths (`./t.json` vs its absolute form) share one chain.
  const resolved = resolve(path)
  const lockPath = `${resolved}.lock`
  const lockOptions = resolveFileLockOptions(options)

  function write<T>(run: (all: Record<string, V>) => Promise<{ changed: boolean; result: T }>) {
    return pathQueue.run(resolved, () =>
      withFileLock(lockPath, lockOptions, async () => {
        const all = await readAll<V>(resolved)
        const { changed, result } = await run(all)
        if (changed) await writeAll(resolved, all)
        return result
      }),
    )
  }

  return {
    async get(key) {
      const all = await readAll<V>(resolved)
      return Object.hasOwn(all, key) ? all[key] : undefined
    },
    set(key, value) {
      return write(async (all) => {
        all[key] = value
        return { changed: true, result: undefined }
      })
    },
    delete(key) {
      return write(async (all) => {
        if (!Object.hasOwn(all, key)) return { changed: false, result: undefined }
        delete all[key]
        return { changed: true, result: undefined }
      })
    },
    async keys() {
      return Object.keys(await readAll<V>(resolved))
    },
    update(key, fn) {
      return write(async (all) => {
        const current = Object.hasOwn(all, key) ? all[key] : undefined
        const next = await fn(current)
        if (next === current) return { changed: false, result: current }
        if (next === undefined) delete all[key]
        else all[key] = next
        return { changed: true, result: next }
      })
    },
  }
}
