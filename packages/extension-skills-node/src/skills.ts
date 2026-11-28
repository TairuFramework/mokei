import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { validatePathSegments } from '@mokei/extension-skills'
import {
  createSkillCatalog,
  type SkillCatalog,
  type SkillCatalogOptions,
  type SkillDefinition,
} from '@mokei/extension-skills-server'

const SKILL_FILE = 'SKILL.md'

export type LoadSkillOptions = {
  /** Path prefix prepended to every skill path, such as `acme`. */
  prefix?: string
}

type Tree = {
  /** Relative `/`-joined path to absolute path, for every non-skipped file. */
  files: Map<string, string>
  /** Relative `/`-joined path of every non-skipped directory. */
  dirs: Set<string>
}

async function scan(root: string): Promise<Tree> {
  const tree: Tree = { files: new Map(), dirs: new Set() }
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) {
        continue
      }
      const abs = join(dir, entry.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (entry.isDirectory()) {
        tree.dirs.add(rel)
        await walk(abs)
      } else if (entry.isFile()) {
        tree.files.set(rel, abs)
      }
    }
  }
  await walk(root)
  return tree
}

/**
 * Load skill definitions from disk. A skill is any directory containing a `SKILL.md` file.
 * Dotfiles and symlinks are skipped. Definitions are sorted by path.
 */
export async function loadSkillDefinitions(
  root: string,
  options: LoadSkillOptions = {},
): Promise<Array<SkillDefinition>> {
  const prefix = options.prefix == null ? [] : validatePathSegments(options.prefix)
  const tree = await scan(root)

  // '' is the root directory itself
  const skillDirs: Array<string> = []
  for (const rel of tree.files.keys()) {
    if (rel === SKILL_FILE) {
      skillDirs.push('')
    } else if (rel.endsWith(`/${SKILL_FILE}`)) {
      skillDirs.push(rel.slice(0, -SKILL_FILE.length - 1))
    }
  }

  const definitions: Array<SkillDefinition> = []
  for (const skillDir of skillDirs) {
    if (skillDir === '' && prefix.length === 0) {
      continue // root skill needs a prefix to get a path
    }
    const base = skillDir === '' ? '' : `${skillDir}/`
    const files: Record<string, Uint8Array> = {}
    const withFiles = new Set<string>()
    for (const [rel, abs] of tree.files) {
      if (!rel.startsWith(base)) {
        continue
      }
      const key = rel.slice(base.length)
      files[key] = new Uint8Array(await readFile(abs))
      const parts = key.split('/')
      for (let i = 1; i < parts.length; i++) {
        withFiles.add(parts.slice(0, i).join('/'))
      }
    }
    const directories: Array<string> = []
    for (const dir of tree.dirs) {
      if (dir.startsWith(base) && dir !== skillDir) {
        const key = dir.slice(base.length)
        if (!withFiles.has(key)) {
          directories.push(key)
        }
      }
    }
    directories.sort()
    const path = [...prefix, ...(skillDir === '' ? [] : skillDir.split('/'))].join('/')
    definitions.push({ path, files, directories })
  }
  return definitions.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Load skills from disk and build a served catalog. */
export async function loadSkillCatalog(
  root: string,
  options: LoadSkillOptions & SkillCatalogOptions = {},
): Promise<SkillCatalog> {
  const { prefix, ...catalogOptions } = options
  const definitions = await loadSkillDefinitions(root, { prefix })
  return await createSkillCatalog(definitions, catalogOptions)
}
