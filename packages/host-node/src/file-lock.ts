import { randomBytes } from 'node:crypto'
import { link, mkdir, open, readFile, rename, rm, stat, utimes } from 'node:fs/promises'
import { dirname } from 'node:path'

/** How a {@link withFileLock} caller waits for, and detects a crashed holder of, a lock file. */
export type FileLockOptions = {
  /**
   * How long a lock file may go without a heartbeat before another writer takes it over, in
   * milliseconds (default 10000). A live holder refreshes it every third of this interval, so
   * only a crashed holder's lock goes stale.
   */
  staleLockMs?: number
  /** How long a write waits for the lock before failing, in milliseconds (default 60000). */
  lockTimeoutMs?: number
}

export const DEFAULT_STALE_LOCK_MS = 10_000
export const DEFAULT_LOCK_TIMEOUT_MS = 60_000

/** Fills in the defaults of {@link FileLockOptions}. */
export function resolveFileLockOptions(options?: FileLockOptions): Required<FileLockOptions> {
  return {
    staleLockMs: options?.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
    lockTimeoutMs: options?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
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

/**
 * Runs `run` while holding the lock file at `lockPath` (created `0600`, its directory `0700`),
 * shared across processes. A heartbeat keeps the lock fresh; a lock that goes `staleLockMs`
 * without one is taken over. Throws when the lock is not acquired within `lockTimeoutMs`.
 */
export async function withFileLock<T>(
  lockPath: string,
  options: Required<FileLockOptions>,
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
