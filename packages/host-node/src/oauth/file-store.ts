import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { StoredTokens, TokenStore } from '@mokei/http-client'

// Serialization chain per resolved absolute path, at module scope so every store instance
// pointing at the same file shares it: an in-process mutex that stops concurrent
// read-modify-write from interleaving and clobbering. See `serialize` below.
const pathTails = new Map<string, Promise<unknown>>()

async function readAll(path: string): Promise<Record<string, StoredTokens>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, StoredTokens>
  } catch {
    return {} // corrupt JSON -> treat as empty (a subsequent write repairs it)
  }
}

async function writeAll(path: string, data: Record<string, StoredTokens>): Promise<void> {
  const tmp = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(tmp, JSON.stringify(data), { mode: 0o600 })
  try {
    await rename(tmp, path)
  } catch (err) {
    // A failed rename must not leave the temp file (a second on-disk copy of every token) behind.
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

export function createFileTokenStore(path: string): TokenStore {
  // Resolve once so differently-spelled paths (`./t.json` vs its absolute form) share one chain.
  const resolved = resolve(path)
  const serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const prev = pathTails.get(resolved) ?? Promise.resolve()
    const run = prev.then(op, op)
    const tail = run.catch(() => {})
    pathTails.set(resolved, tail)
    // Reclaim the entry once its tail settles, but only if it is still the live chain — the
    // identity check prevents deleting a chain a concurrent op has already extended. Without it,
    // `pathTails` would grow one permanent entry per distinct resolved path.
    void tail.then(() => {
      if (pathTails.get(resolved) === tail) pathTails.delete(resolved)
    })
    return run
  }
  return {
    get(key) {
      return serialize(async () => (await readAll(resolved))[key])
    },
    set(key, tokens) {
      return serialize(async () => {
        const all = await readAll(resolved)
        all[key] = tokens
        await writeAll(resolved, all)
      })
    },
    clear(key) {
      return serialize(async () => {
        const all = await readAll(resolved)
        delete all[key]
        await writeAll(resolved, all)
      })
    },
  }
}
