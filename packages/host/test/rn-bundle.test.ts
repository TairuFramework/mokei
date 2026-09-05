import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// Specifiers that must never be reachable from an RN-safe barrel's built import graph.
const BANNED = [/^node:/, /@enkaku\/node-streams/, /@tejika\/process/, /^nano-spawn$/]

const require = createRequire(import.meta.url)

// Resolve a package's built entry to an absolute lib/ path.
function entryOf(pkg: string): string {
  return require.resolve(pkg)
}

// Resolve a relative import specifier (as written in built ESM output) to a real file on disk.
// Built lib JS may reference the target extensionless or with a trailing `.js`, so try both
// plus the directory-index form before giving up.
function resolveRelative(fromFile: string, spec: string): string {
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [base, `${base}.js`, resolve(base, 'index.js')]) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`Could not resolve relative specifier "${spec}" from ${fromFile}`)
}

// Walk static imports/exports reachable from an entry, following relative and @mokei/* edges
// only (third-party and Node builtin specifiers are recorded but not followed).
function reachableSpecifiers(entry: string): { specs: Set<string>; visited: number } {
  const seen = new Set<string>()
  const specs = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const file = stack.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    // The scan below is a static, non-parsing regex match over source text, so any comment
    // stripping we do must never risk truncating a real import/export line. Built lib JS
    // keeps JSDoc blocks (including `@example` snippets that themselves contain literal
    // `import ... from '...'` text, e.g. packages/host/src/local-tools.ts), which are not
    // real import edges and would otherwise be picked up as false ones. We strip ONLY
    // `/* ... */` block comments (a whole-comment removal, not a same-line truncation) to
    // clear those false edges. We deliberately do NOT strip `//` line comments: several
    // built files carry `//`-prefixed doc-link lines (e.g. spec URLs), and a naive
    // `.replace(/\/\/.*$/gm, '')` doesn't distinguish those from `//` occurring inside a
    // string/regex literal on the same line as a real import -- silently truncating such a
    // line would drop a genuine edge from the walk and make the guard pass vacuously. Block
    // comments are safe to strip in full because MCP/TS source in this repo never opens a
    // `/*` on the same line as, or before, a real import statement it wants preserved.
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of src.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1]
      if (spec == null) {
        continue
      }
      specs.add(spec)
      if (spec.startsWith('.')) {
        stack.push(resolveRelative(file, spec))
      } else if (spec.startsWith('@mokei/')) {
        stack.push(entryOf(spec))
      }
    }
  }
  return { specs, visited: seen.size }
}

describe('RN bundle safety', () => {
  for (const pkg of ['@mokei/host', '@mokei/context-server']) {
    test(`${pkg} barrel reaches no Node-only specifier`, () => {
      const { specs, visited } = reachableSpecifiers(entryOf(pkg))
      // Guard against a vacuous walk: the graph must span more than just the entry file.
      expect(visited).toBeGreaterThan(1)
      const leaks = [...specs].filter((s) => BANNED.some((re) => re.test(s)))
      expect(leaks).toEqual([])
    })
  }
})
