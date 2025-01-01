import { readFile as read, writeFile as write } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

export function resolvePath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value)
}

export async function readJSON<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await read(resolvePath(path), { encoding: 'utf8' })) as T
}

export async function writeFile(path: string, value: string): Promise<void> {
  await write(resolvePath(path), value, { encoding: 'utf8' })
}

export async function writeJSON(path: string, value: unknown, format = false): Promise<void> {
  await writeFile(path, format ? JSON.stringify(value, null, 2) : JSON.stringify(value))
}
