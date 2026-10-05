import { randomBytes } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { StoredTokens, TokenStore } from '@mokei/http-client'
import { createKeyedQueue } from '@sozai/async'
import { readJSONFile } from '@tejika/env'

// Stores sharing a resolved path must not interleave read-modify-write operations.
const pathQueue = createKeyedQueue<string>()

async function readAll(path: string): Promise<Record<string, StoredTokens>> {
  let parsed: unknown
  try {
    parsed = await readJSONFile(path, { default: {} })
  } catch (error) {
    // A subsequent write repairs corrupt JSON; filesystem failures must still propagate.
    if (error instanceof Error && error.cause instanceof SyntaxError) return {}
    throw error
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  return parsed as Record<string, StoredTokens>
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
    return pathQueue.run(resolved, op)
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
