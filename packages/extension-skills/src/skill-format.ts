import { parse } from 'yaml'

/** Limits applied to a skill's file manifest. */
export const SKILL_LIMITS = { maxFiles: 512, maxBytes: 16777216 } as const

const DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/
const SKILL_NAME_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const URI_REGEX = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/
// RFC 3986 `pchar` without `%`: percent-encoding is rejected so a segment has a single spelling.
const SEGMENT_REGEX = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]+$/
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export class SkillFormatError extends Error {
  // biome-ignore lint/style/useNamingConvention: lint rule misfires on readonly class properties
  readonly skill?: string

  constructor(message: string, skill?: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SkillFormatError'
    this.skill = skill
  }
}

/** Compute the `sha256:<hex>` digest of the given bytes. */
export async function computeDigest(bytes: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
  let hex = ''
  for (const byte of new Uint8Array(hash)) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return `sha256:${hex}`
}

export function isValidDigest(digest: string): boolean {
  return DIGEST_REGEX.test(digest)
}

/** Agent Skills naming: lowercase letters, digits and single hyphens, 1-64 chars. */
export function isValidSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && SKILL_NAME_REGEX.test(name)
}

/** Split a skill path into segments, throwing if any segment is invalid. */
export function validatePathSegments(path: string): Array<string> {
  const segments = path.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new SkillFormatError(`Invalid path segment in "${path}"`)
    }
    if (!SEGMENT_REGEX.test(segment)) {
      throw new SkillFormatError(
        `Path segment "${segment}" must contain only URI path characters other than %`,
      )
    }
  }
  return segments
}

export function joinSkillURI(skillPath: string, relativePath?: string): string {
  validatePathSegments(skillPath)
  if (relativePath == null) {
    return `skill://${skillPath}`
  }
  validatePathSegments(relativePath)
  return `skill://${skillPath}/${relativePath}`
}

/** URI of the skill directory, given the URI of a file in it (typically SKILL.md). */
export function skillRootURI(skillURI: string): string {
  const index = skillURI.lastIndexOf('/')
  return index === -1 ? skillURI : skillURI.slice(0, index)
}

export function skillNameFromURI(skillURI: string): string {
  const root = skillRootURI(skillURI)
  return root.slice(root.lastIndexOf('/') + 1)
}

export function isWithinSkill(skillURI: string, fileURI: string): boolean {
  if (!isValidSkillURI(skillURI) || !isValidSkillURI(fileURI)) {
    return false
  }
  return fileURI.startsWith(`${skillRootURI(skillURI)}/`)
}

export function isValidSkillURI(uri: string): boolean {
  const match = URI_REGEX.exec(uri)
  if (match == null) {
    return false
  }
  try {
    validatePathSegments(match[2] ?? '')
    return true
  } catch {
    return false
  }
}

/** Decode UTF-8 strictly, keeping any BOM. Returns null for invalid input. */
export function decodeExactUTF8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse the YAML frontmatter of a SKILL.md, requiring string `name` and `description`. */
export function parseSkillFrontmatter(text: string): Record<string, unknown> {
  const match = FRONTMATTER_REGEX.exec(text)
  if (match == null) {
    throw new SkillFormatError('SKILL.md must start with YAML frontmatter delimited by ---')
  }
  let value: unknown
  try {
    value = parse(match[1] ?? '', { schema: 'core' })
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: cause is passed through the options argument
    throw new SkillFormatError(`Invalid YAML frontmatter: ${(error as Error).message}`, undefined, {
      cause: error,
    })
  }
  if (!isRecord(value)) {
    throw new SkillFormatError('Frontmatter must be a mapping')
  }
  if (typeof value.name !== 'string') {
    throw new SkillFormatError('Frontmatter "name" must be a string')
  }
  if (typeof value.description !== 'string') {
    throw new SkillFormatError('Frontmatter "description" must be a string')
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

/** Validate the Agent Skills frontmatter fields. Unknown fields are allowed. */
export function validateSkillFrontmatter(frontmatter: Record<string, unknown>): void {
  const { name, description, license, compatibility, metadata } = frontmatter
  if (typeof name !== 'string') {
    throw new SkillFormatError('Frontmatter "name" must be a string')
  }
  if (typeof description !== 'string' || description.length < 1 || description.length > 1024) {
    throw new SkillFormatError('Frontmatter "description" must be a string of 1-1024 characters')
  }
  if (license !== undefined && typeof license !== 'string') {
    throw new SkillFormatError('Frontmatter "license" must be a string')
  }
  if (
    compatibility !== undefined &&
    (typeof compatibility !== 'string' || compatibility.length < 1 || compatibility.length > 500)
  ) {
    throw new SkillFormatError('Frontmatter "compatibility" must be a string of 1-500 characters')
  }
  if (metadata !== undefined) {
    if (!isRecord(metadata) || !Object.values(metadata).every((v) => typeof v === 'string')) {
      throw new SkillFormatError('Frontmatter "metadata" must be a mapping of strings to strings')
    }
  }
  const allowedTools = frontmatter['allowed-tools']
  if (allowedTools !== undefined && typeof allowedTools !== 'string') {
    throw new SkillFormatError('Frontmatter "allowed-tools" must be a string')
  }
}

/** Deep equality for JSON values, ignoring object key order. */
export function frontmatterEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => frontmatterEquals(item, b[i]))
    )
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    return (
      keysA.length === keysB.length &&
      keysA.every((key) => Object.hasOwn(b, key) && frontmatterEquals(a[key], b[key]))
    )
  }
  return false
}
