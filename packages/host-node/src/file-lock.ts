import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock as withSozaiFileLock } from '@sozai/lock'

/** How a store waits for, and judges an abandoned holder of, its lock file (`@sozai/lock`). */
export type FileLockOptions = {
  /**
   * How long a lock file may be honoured when its holder's liveness cannot be proven (another
   * host, another boot, or an unreadable record), in milliseconds (default 60000). A holder whose
   * process is provably alive is never treated as stale, however long it holds the lock.
   */
  staleLockMs?: number
  /** How long a write waits for the lock before failing, in milliseconds (default 60000). */
  lockTimeoutMs?: number
}

export const DEFAULT_STALE_LOCK_MS = 60_000
export const DEFAULT_LOCK_TIMEOUT_MS = 60_000

/** Fills in the defaults of {@link FileLockOptions}. */
export function resolveFileLockOptions(options?: FileLockOptions): Required<FileLockOptions> {
  return {
    staleLockMs: options?.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
    lockTimeoutMs: options?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
  }
}

/**
 * Runs `run` while holding the cross-process lock file at `lockPath` (`@sozai/lock`), creating
 * its directory (`0700`) first. Throws, without running `run`, when the lock is not acquired
 * within `lockTimeoutMs`.
 */
export async function withFileLock<T>(
  lockPath: string,
  options: Required<FileLockOptions>,
  run: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
  return await withSozaiFileLock(lockPath, run, {
    timeout: options.lockTimeoutMs,
    staleTimeout: options.staleLockMs,
  })
}
