/**
 * node-pty ships its prebuilt `spawn-helper` without the executable bit, and every
 * `pnpm install` restores the package from the store — so a manual `chmod +x` does not
 * survive. Without it the PTY-based integration suites fail with `posix_spawnp failed`.
 *
 * Runs as the root `postinstall`; a silent no-op when node-pty is absent.
 */
import { chmodSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STORE = join(ROOT, 'node_modules', '.pnpm')
const EXECUTABLE = 0o755

function readDirectory(path) {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

/** Ensures `path` is executable, returning whether the bit had to be added. */
function makeExecutable(path) {
  try {
    const mode = statSync(path).mode & 0o777
    if ((mode & 0o111) === 0o111) {
      return false
    }
    chmodSync(path, EXECUTABLE)
    return true
  } catch {
    return false
  }
}

let fixed = 0
for (const entry of readDirectory(STORE)) {
  if (!entry.startsWith('node-pty@')) {
    continue
  }
  const prebuilds = join(STORE, entry, 'node_modules', 'node-pty', 'prebuilds')
  for (const platform of readDirectory(prebuilds)) {
    if (makeExecutable(join(prebuilds, platform, 'spawn-helper'))) {
      fixed += 1
    }
  }
}

if (fixed > 0) {
  console.log(`Made ${fixed} node-pty spawn-helper binar${fixed === 1 ? 'y' : 'ies'} executable`)
}
