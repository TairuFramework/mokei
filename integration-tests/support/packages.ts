import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/** Built entry of a workspace package, resolved through its package name. */
export function packageEntry(name: string): string {
  return require.resolve(name)
}

/**
 * Root directory of a workspace package, resolved through its package name.
 * Walks up from the package entry because `exports` maps may not expose `package.json`.
 */
export function packageRoot(name: string): string {
  let directory = dirname(packageEntry(name))
  for (;;) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) {
      return directory
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`No package root found for ${name}`)
    directory = parent
  }
}

/** Absolute path of a file inside a workspace package, such as a bin script or example. */
export function packageFile(name: string, path: string): string {
  return join(packageRoot(name), path)
}

/** Parse a JSON file shipped inside a workspace package. */
export function readPackageJSON<T = unknown>(name: string, path: string): T {
  return JSON.parse(readFileSync(packageFile(name, path), 'utf8')) as T
}
