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
  return {
    async get(key) {
      return (await readAll(path))[key]
    },
    async set(key, tokens) {
      const all = await readAll(path)
      all[key] = tokens
      await writeAll(path, all)
    },
    async clear(key) {
      const all = await readAll(path)
      delete all[key]
      await writeAll(path, all)
    },
  }
}
