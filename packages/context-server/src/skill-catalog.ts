import {
  computeDigest,
  decodeExactUTF8,
  isValidSkillName,
  joinSkillURI,
  parseSkillFrontmatter,
  type Resource,
  SKILL_LIMITS,
  type Skill,
  SkillFormatError,
  validatePathSegments,
  validateSkillFrontmatter,
} from '@mokei/context-protocol'
import { toB64 } from '@sozai/codec'

import type { CacheHints } from './server.js'

export type SkillDefinition = {
  /** Slash-separated skill path, its last segment being the skill name. */
  path: string
  /** File contents keyed by path relative to the skill directory. Must include `SKILL.md`. */
  files: Record<string, string | Uint8Array>
  /** Extra (possibly empty) directories, relative to the skill directory. */
  directories?: Array<string>
}

export type SkillCatalogOptions = {
  directoryRead?: boolean
  cache?: CacheHints
  scopes?: Array<string>
}

export type SkillFileContents = { uri: string; mimeType: string; text?: string; blob?: string }

export type SkillCatalog = {
  readonly entries: ReadonlyArray<Skill>
  readonly directoryRead: boolean
  readonly cache?: CacheHints
  readonly scopes?: ReadonlyArray<string>
  getEntry(uri: string): Skill | undefined
  getFile(uri: string): SkillFileContents | undefined
  getDirectory(uri: string): Array<Resource> | undefined
  has(uri: string): boolean
}

const DIRECTORY_MIME = 'inode/directory'
const SKILL_FILE = 'SKILL.md'

const MIME_TYPES: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  py: 'text/x-python',
  js: 'text/javascript',
  ts: 'text/typescript',
  sh: 'text/x-shellscript',
}

function getMimeType(name: string): string {
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
  return MIME_TYPES[extension] ?? 'application/octet-stream'
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

type PreparedSkill = {
  path: string
  skillURI: string
  frontmatter: Record<string, unknown>
  files: Array<{ key: string; uri: string; bytes: Uint8Array }>
  directories: Array<string>
}

/** Validate a definition, attributing every format error to its path. */
function prepareSkill(definition: SkillDefinition): PreparedSkill {
  try {
    return prepareSkillUnattributed(definition)
  } catch (error) {
    if (error instanceof SkillFormatError && error.skill == null) {
      const { path } = definition
      // biome-ignore lint/style/useErrorCause: cause is passed through the options argument
      throw new SkillFormatError(`${path}: ${error.message}`, path, { cause: error })
    }
    throw error
  }
}

function prepareSkillUnattributed(definition: SkillDefinition): PreparedSkill {
  const { path } = definition
  const segments = validatePathSegments(path)
  const name = segments[segments.length - 1] as string
  if (!isValidSkillName(name)) {
    throw new SkillFormatError(`Invalid skill name "${name}"`, path)
  }
  const keys = Object.keys(definition.files).sort()
  if (keys.length > SKILL_LIMITS.maxFiles) {
    throw new SkillFormatError(`Skill has more than ${SKILL_LIMITS.maxFiles} files`, path)
  }
  let totalBytes = 0
  const files = keys.map((key) => {
    validatePathSegments(key)
    const bytes = toBytes(definition.files[key] as string | Uint8Array)
    totalBytes += bytes.length
    return { key, uri: joinSkillURI(path, key), bytes }
  })
  if (totalBytes > SKILL_LIMITS.maxBytes) {
    throw new SkillFormatError(`Skill exceeds ${SKILL_LIMITS.maxBytes} bytes`, path)
  }
  const skillFile = files.find((file) => file.key === SKILL_FILE)
  if (skillFile == null) {
    throw new SkillFormatError(`Skill is missing ${SKILL_FILE}`, path)
  }
  const text = decodeExactUTF8(skillFile.bytes)
  if (text == null) {
    throw new SkillFormatError(`${SKILL_FILE} is not valid UTF-8`, path)
  }
  const frontmatter = parseSkillFrontmatter(text)
  validateSkillFrontmatter(frontmatter)
  if (frontmatter.name !== name) {
    throw new SkillFormatError(
      `Frontmatter name "${String(frontmatter.name)}" does not match "${name}"`,
      path,
    )
  }
  const directories = (definition.directories ?? []).map((directory) => {
    validatePathSegments(directory)
    return joinSkillURI(path, directory)
  })
  return { path, skillURI: skillFile.uri, frontmatter, files, directories }
}

function parentURI(uri: string): string | undefined {
  const index = uri.lastIndexOf('/')
  // Stop at the first segment: `skill://name` has no parent.
  return index <= 'skill://'.length ? undefined : uri.slice(0, index)
}

/**
 * Build an immutable catalog of skills from in-code definitions, validating every definition
 * before computing any digest.
 */
export async function createSkillCatalog(
  definitions: Array<SkillDefinition>,
  options: SkillCatalogOptions = {},
): Promise<SkillCatalog> {
  const prepared = definitions.map(prepareSkill)

  const paths = new Set<string>()
  for (const skill of prepared) {
    if (paths.has(skill.path)) {
      throw new SkillFormatError(`Duplicate skill path "${skill.path}"`, skill.path)
    }
    paths.add(skill.path)
  }

  // One file store keyed by URI; the same URI must always hold the same bytes.
  const store = new Map<string, Uint8Array>()
  for (const skill of prepared) {
    for (const file of skill.files) {
      const existing = store.get(file.uri)
      if (existing != null && !bytesEqual(existing, file.bytes)) {
        throw new SkillFormatError(`Conflicting content for ${file.uri}`, skill.path)
      }
      store.set(file.uri, file.bytes)
    }
  }
  // An enclosing skill must list every file of the skills nested under it.
  for (const outer of prepared) {
    const known = new Set(outer.files.map((file) => file.uri))
    for (const inner of prepared) {
      if (!inner.path.startsWith(`${outer.path}/`)) {
        continue
      }
      for (const file of inner.files) {
        if (!known.has(file.uri)) {
          throw new SkillFormatError(
            `Skill "${outer.path}" must include file ${file.uri} of nested skill "${inner.path}"`,
            outer.path,
          )
        }
      }
    }
  }

  // Directory index: every ancestor of every file and skill root, plus declared directories.
  const children = new Map<string, Map<string, Resource>>()
  const addDirectory = (uri: string): void => {
    let current: string | undefined = uri
    while (current != null) {
      if (!children.has(current)) {
        children.set(current, new Map())
      }
      const parent = parentURI(current)
      if (parent != null) {
        const siblings = children.get(parent) ?? new Map<string, Resource>()
        children.set(parent, siblings)
        siblings.set(current, {
          uri: current,
          name: lastSegment(current),
          mimeType: DIRECTORY_MIME,
        })
      }
      current = parent
    }
  }
  for (const skill of prepared) {
    addDirectory(joinSkillURI(skill.path))
    for (const directory of skill.directories) {
      addDirectory(directory)
    }
  }
  const files = new Map<string, SkillFileContents>()
  for (const [uri, bytes] of store) {
    const name = lastSegment(uri)
    const mimeType = getMimeType(name)
    const text = decodeExactUTF8(bytes)
    files.set(uri, text == null ? { uri, mimeType, blob: toB64(bytes) } : { uri, mimeType, text })
    const parent = parentURI(uri)
    if (parent != null) {
      addDirectory(parent)
      children.get(parent)?.set(uri, { uri, name, mimeType, size: bytes.length })
    }
  }

  for (const uri of store.keys()) {
    if (children.has(uri)) {
      throw new SkillFormatError(`${uri} is both a file and a directory`)
    }
  }

  // All validation is done: compute digests.
  const digests = new Map<string, string>()
  for (const [uri, bytes] of store) {
    digests.set(uri, await computeDigest(bytes))
  }
  const entries: Array<Skill> = prepared.map((skill) => ({
    uri: skill.skillURI,
    frontmatter: skill.frontmatter as Skill['frontmatter'],
    resources: skill.files.map((file) => ({
      uri: file.uri,
      digest: digests.get(file.uri) as string,
      size: file.bytes.length,
    })),
  }))
  const entriesByURI = new Map(entries.map((entry) => [entry.uri, entry]))

  const directoryChildren = new Map<string, ReadonlyArray<Resource>>()
  for (const [uri, items] of children) {
    directoryChildren.set(
      uri,
      [...items.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    )
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    directoryRead: options.directoryRead ?? false,
    cache: options.cache,
    scopes: options.scopes == null ? undefined : Object.freeze([...options.scopes]),
    getEntry: (uri: string) => entriesByURI.get(uri),
    getFile: (uri: string) => files.get(uri),
    getDirectory: (uri: string) => directoryChildren.get(uri)?.map((item) => ({ ...item })),
    has: (uri: string) => files.has(uri) || directoryChildren.has(uri),
  })
}
