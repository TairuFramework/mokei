import { randomBytes } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { StoredTokens, TokenStore } from '@mokei/http-client'

// Shared serialization chain per resolved absolute path, at module scope: two
// `createFileTokenStore` instances pointing at the same file (e.g. two HTTP contexts sharing an
// `--oauth-tokens` file within one process) must serialize their reads/writes against each other,
// or one instance's read-modify-write can race and clobber the other's.
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
  await rename(tmp, path)
}

export function createFileTokenStore(path: string): TokenStore {
  // Serializes every operation through a tail-promise chain shared, by resolved absolute path,
  // across every store instance pointing at the same file (a simple in-process mutex) — so
  // concurrent `get`/`set`/`clear` calls, even from different `createFileTokenStore` instances,
  // can't interleave their read-modify-write and clobber each other. Resolving once here also
  // means equivalent-but-differently-spelled paths (`./t.json` vs its absolute form) share the
  // same chain.
  const resolved = resolve(path)
  const serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const prev = pathTails.get(resolved) ?? Promise.resolve()
    const run = prev.then(op, op)
    const tail = run.catch(() => {})
    pathTails.set(resolved, tail)
    // Reclaim the entry once its tail settles, but only if it's still the live chain: a
    // concurrent op reads `pathTails.get(resolved)` (this `tail`) and chains onto it, then
    // replaces the map entry with its own tail, before this one settles -- so the identity check
    // below fails for it and the still-live chain is never deleted out from under it. Without
    // this, `pathTails` would grow one entry per distinct resolved path for the process lifetime.
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
