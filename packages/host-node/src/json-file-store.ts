import { randomBytes } from 'node:crypto'
import { link, mkdir, open, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { KeyValueStore } from '@mokei/http-client'
import { createKeyedQueue } from '@sozai/async'
import { readJSONFile } from '@tejika/env'

export type JSONFileStoreOptions = {
  /**
   * How long a lock file may go without a heartbeat before another writer takes it over, in
   * milliseconds (default 10000). A live holder refreshes it every third of this interval, so
   * only a crashed holder's lock goes stale.
   */
  staleLockMs?: number
  /** How long a write waits for the lock before failing, in milliseconds (default 60000). */
  lockTimeoutMs?: number
}

const DEFAULT_STALE_LOCK_MS = 10_000
const DEFAULT_LOCK_TIMEOUT_MS = 60_000

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

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

async function readLockOwner(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Takes over `lockPath` if it has gone `staleMs` without a heartbeat. The lock is moved aside
 * rather than deleted, and only discarded if it is still the lock judged stale: a writer that
 * lost the race to another taker must not remove that taker's fresh lock. Returns whether the
 * caller should retry acquiring at once.
 */
async function takeOverStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  let mtimeMs: number
  try {
    mtimeMs = (await stat(lockPath)).mtimeMs
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return true
    throw error
  }
  if (Date.now() - mtimeMs <= staleMs) return false
  const stale = await readLockOwner(lockPath)
  if (stale == null) return true
  const aside = `${lockPath}.${randomBytes(6).toString('hex')}.stale`
  try {
    await rename(lockPath, aside)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return true
    throw error
  }
  const moved = await readLockOwner(aside)
  if (moved !== stale) {
    // Another taker replaced the stale lock first and this rename moved *its* lock: put it back
    // unless yet another writer already holds the path.
    await link(aside, lockPath).catch(() => {})
  }
  await rm(aside, { force: true })
  return true
}

async function withFileLock<T>(
  lockPath: string,
  options: Required<JSONFileStoreOptions>,
  run: () => Promise<T>,
): Promise<T> {
  const owner = `${process.pid}:${randomBytes(8).toString('hex')}`
  const deadline = Date.now() + options.lockTimeoutMs
  let delay = 5
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(owner)
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
    if (await takeOverStaleLock(lockPath, options.staleLockMs)) continue
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${options.lockTimeoutMs}ms waiting for lock ${lockPath}`)
    }
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, 100)
  }

  const heartbeat = setInterval(
    () => {
      const now = new Date()
      void utimes(lockPath, now, now).catch(() => {})
    },
    Math.max(1, Math.floor(options.staleLockMs / 3)),
  )
  heartbeat.unref()
  try {
    return await run()
  } finally {
    clearInterval(heartbeat)
    // Remove only our own lock: if it was taken over as stale, the path now belongs to someone else.
    if ((await readLockOwner(lockPath).catch(() => undefined)) === owner) {
      await rm(lockPath, { force: true })
    }
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
  const lockOptions: Required<JSONFileStoreOptions> = {
    staleLockMs: options.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
    lockTimeoutMs: options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
  }

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
