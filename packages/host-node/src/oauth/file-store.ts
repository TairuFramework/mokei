import { randomBytes } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { StoredTokens, TokenStore } from '@mokei/http-client'

async function readAll(path: string): Promise<Record<string, StoredTokens>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, StoredTokens>
  } catch {
    return {}
  }
}

async function writeAll(path: string, data: Record<string, StoredTokens>): Promise<void> {
  const tmp = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(tmp, JSON.stringify(data), { mode: 0o600 })
  await rename(tmp, path)
}

export function createFileTokenStore(path: string): TokenStore {
  // Serializes every operation on this store instance through a tail-promise chain (a simple
  // in-process mutex), so concurrent `get`/`set`/`clear` calls can't interleave their
  // read-modify-write and clobber each other.
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const run = tail.then(op, op)
    tail = run.catch(() => {})
    return run
  }
  return {
    get(key) {
      return serialize(async () => (await readAll(path))[key])
    },
    set(key, tokens) {
      return serialize(async () => {
        const all = await readAll(path)
        all[key] = tokens
        await writeAll(path, all)
      })
    },
    clear(key) {
      return serialize(async () => {
        const all = await readAll(path)
        delete all[key]
        await writeAll(path, all)
      })
    },
  }
}
