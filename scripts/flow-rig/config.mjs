import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const ENUMS = {
  predictor: ['real', 'fake'],
  input: ['inbox', 'dialog'],
  confirm: ['desktop', 'deny', 'approve'],
}

const DEFAULTS = {
  predictor: 'real',
  input: 'inbox',
  confirm: 'desktop',
}

/** Match a tool id against `*` globs; `*` never crosses a `:` segment boundary. */
export function matchesAllow(toolID, globs) {
  return globs.some((glob) => {
    const source = glob
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^:]*')
    return new RegExp(`^${source}$`).test(toolID)
  })
}

function resolveSibling(sibling) {
  const args = (sibling.args ?? []).map((arg) =>
    typeof arg === 'string' && arg.endsWith('.js') && !isAbsolute(arg)
      ? resolve(REPO_ROOT, arg)
      : arg,
  )
  return { ...sibling, args }
}

export async function loadConfig(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'))
  const configDir = dirname(resolve(path))

  const config = {
    siblings: Object.fromEntries(
      Object.entries(raw.siblings ?? {}).map(([name, sibling]) => [name, resolveSibling(sibling)]),
    ),
    flowsDir: resolve(configDir, raw.flowsDir ?? 'flows'),
    allow: raw.allow ?? [],
    predictor: raw.predictor ?? DEFAULTS.predictor,
    fakeAnswers: raw.fakeAnswers ?? {},
    input: raw.input ?? DEFAULTS.input,
    confirm: raw.confirm ?? DEFAULTS.confirm,
  }

  for (const [field, values] of Object.entries(ENUMS)) {
    if (!values.includes(config[field])) {
      throw new Error(
        `Invalid config field "${field}": ${JSON.stringify(config[field])} (expected one of ${values.join(', ')})`,
      )
    }
  }
  return config
}
