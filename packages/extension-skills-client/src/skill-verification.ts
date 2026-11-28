import type { ReadResourceResult, Skill, SkillResource } from '@mokei/context-protocol'
import {
  computeDigest,
  decodeExactUTF8,
  frontmatterEquals,
  isValidDigest,
  isValidSkillName,
  isValidSkillURI,
  isWithinSkill,
  parseSkillFrontmatter,
  SKILL_LIMITS,
} from '@mokei/extension-skills'
import { fromB64 } from '@sozai/codec'

/** Why {@link SkillVerificationError} refused a skill entry or file. */
export type SkillVerificationReason =
  | 'invalid-entry'
  | 'limits'
  | 'unlisted'
  | 'response'
  | 'size'
  | 'digest'
  | 'frontmatter'

export type SkillVerificationErrorParams = {
  reason: SkillVerificationReason
  /** The entry or file URI the check failed on. */
  uri: string
  message: string
  cause?: unknown
}

/**
 * Thrown when a skill entry held by the caller, or a file read against it, fails verification.
 * Skill file content is never returned without passing these checks.
 */
export class SkillVerificationError extends Error {
  #reason: SkillVerificationReason
  #uri: string

  constructor(params: SkillVerificationErrorParams) {
    super(params.message, { cause: params.cause })
    this.name = 'SkillVerificationError'
    this.#reason = params.reason
    this.#uri = params.uri
  }

  get reason(): SkillVerificationReason {
    return this.#reason
  }

  get uri(): string {
    return this.#uri
  }
}

/** A skill file whose bytes were verified against the entry the caller holds. */
export type SkillFile = {
  uri: string
  mimeType?: string
  bytes: Uint8Array
  /** UTF-8 decode of `bytes`, present only when the server sent the file as text. */
  text?: string
}

const SKILL_FILE = 'SKILL.md'

function fail(
  reason: SkillVerificationReason,
  uri: string,
  message: string,
  cause?: unknown,
): never {
  throw new SkillVerificationError({ reason, uri, message, cause })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * The entry URI must name a `SKILL.md` directly inside a directory named after the skill. Checked
 * before any root-relative check: a one-segment URI such as `skill://SKILL.md` has no skill
 * directory, and its "root" would admit every URI of the scheme.
 */
function checkEntryURI(uri: string, name: string): void {
  if (!isValidSkillURI(uri)) {
    fail('invalid-entry', uri, `Skill entry URI ${uri} is not a valid skill URI`)
  }
  const segments = uri.slice(uri.indexOf('://') + 3).split('/')
  if (segments.length < 2 || segments[segments.length - 1] !== SKILL_FILE) {
    fail('invalid-entry', uri, `Skill entry URI ${uri} must end in /${SKILL_FILE}`)
  }
  const segment = segments[segments.length - 2] as string
  if (!isValidSkillName(segment) || segment !== name) {
    fail('invalid-entry', uri, `Skill entry URI ${uri} does not name the skill "${name}"`)
  }
}

/**
 * Checks a skill entry received from a server before anything is counted or read: types are not
 * trusted, so every field is checked at runtime. Throws {@link SkillVerificationError} with reason
 * `'invalid-entry'` for a malformed entry, or `'limits'` for one over {@link SKILL_LIMITS}.
 */
export function checkSkillEntry(entry: Skill): void {
  const value: unknown = entry
  if (!isRecord(value) || typeof value.uri !== 'string') {
    fail('invalid-entry', '', 'Skill entry must be an object with a string uri')
  }
  const uri = value.uri
  const frontmatter = value.frontmatter
  if (
    !isRecord(frontmatter) ||
    !isNonEmptyString(frontmatter.name) ||
    !isNonEmptyString(frontmatter.description)
  ) {
    fail('invalid-entry', uri, 'Skill frontmatter must carry a non-empty name and description')
  }
  checkEntryURI(uri, frontmatter.name)

  const resources = value.resources
  if (resources === 'dynamic') {
    return
  }
  if (!Array.isArray(resources)) {
    fail('invalid-entry', uri, 'Skill resources must be an array or "dynamic"')
  }
  const seen = new Set<string>()
  let total = 0
  for (const file of resources) {
    if (!isRecord(file) || typeof file.uri !== 'string') {
      fail('invalid-entry', uri, 'Every skill resource must have a string uri')
    }
    if (seen.has(file.uri)) {
      fail('invalid-entry', uri, `${file.uri} is listed more than once`)
    }
    seen.add(file.uri)
    if (!isWithinSkill(uri, file.uri)) {
      fail('invalid-entry', uri, `${file.uri} is not a valid URI within the skill`)
    }
    if (typeof file.digest !== 'string' || !isValidDigest(file.digest)) {
      fail('invalid-entry', uri, `${file.uri} has an invalid digest`)
    }
    if (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0) {
      fail('invalid-entry', uri, `${file.uri} has an invalid size`)
    }
    total += file.size
  }
  if (!seen.has(uri)) {
    fail('invalid-entry', uri, `Skill resources must list ${uri}`)
  }
  if (resources.length > SKILL_LIMITS.maxFiles) {
    fail('limits', uri, `Skill lists ${resources.length} files, over ${SKILL_LIMITS.maxFiles}`)
  }
  if (total > SKILL_LIMITS.maxBytes) {
    fail('limits', uri, `Skill files total ${total} bytes, over ${SKILL_LIMITS.maxBytes}`)
  }
}

/**
 * The manifest record for `uri` in a checked entry, or `null` for a `'dynamic'` entry, which
 * admits any URI within the skill root. Throws reason `'unlisted'` otherwise.
 */
export function listedSkillFile(entry: Skill, uri: string): SkillResource | null {
  if (entry.resources === 'dynamic') {
    if (!isWithinSkill(entry.uri, uri)) {
      fail('unlisted', uri, `${uri} is not within the skill ${entry.uri}`)
    }
    return null
  }
  const listed = entry.resources.find((file) => file.uri === uri)
  if (listed == null) {
    fail('unlisted', uri, `${uri} is not listed by the skill ${entry.uri}`)
  }
  return listed
}

/** The raw bytes of the single content entry for `uri`, picked strictly. */
function contentBytes(
  result: ReadResourceResult,
  uri: string,
): { bytes: Uint8Array; content: Record<string, unknown>; isText: boolean } {
  const contents: unknown = (result as { contents?: unknown }).contents
  if (!Array.isArray(contents) || contents.length !== 1) {
    fail('response', uri, `Expected exactly one content entry for ${uri}`)
  }
  const content: unknown = contents[0]
  if (!isRecord(content) || content.uri !== uri) {
    fail('response', uri, `The content entry does not match ${uri}`)
  }
  const hasText = Object.hasOwn(content, 'text')
  if (hasText === Object.hasOwn(content, 'blob')) {
    fail('response', uri, `The content entry for ${uri} must carry exactly one of text or blob`)
  }
  if (hasText) {
    if (typeof content.text !== 'string') {
      fail('response', uri, `The text content for ${uri} is not a string`)
    }
    return { bytes: new TextEncoder().encode(content.text), content, isText: true }
  }
  if (typeof content.blob !== 'string') {
    fail('response', uri, `The blob content for ${uri} is not a string`)
  }
  try {
    return { bytes: fromB64(content.blob), content, isText: false }
  } catch (cause) {
    fail('response', uri, `The blob content for ${uri} is not valid base64`, cause)
  }
}

/**
 * Verifies a `resources/read` result for `uri` against a checked entry and its manifest record
 * (`null` for a dynamic entry), returning only values derived from the verified bytes.
 */
export async function verifySkillFile(
  entry: Skill,
  uri: string,
  listed: SkillResource | null,
  result: ReadResourceResult,
): Promise<SkillFile> {
  const { bytes, content, isText } = contentBytes(result, uri)
  if (listed != null) {
    if (bytes.length !== listed.size) {
      fail('size', uri, `${uri} is ${bytes.length} bytes, the entry lists ${listed.size}`)
    }
    if ((await computeDigest(bytes)) !== listed.digest) {
      fail('digest', uri, `${uri} does not match the digest the entry lists`)
    }
  }
  const decoded = decodeExactUTF8(bytes)
  if (uri === entry.uri) {
    if (decoded == null) {
      fail('frontmatter', uri, `${uri} is not valid UTF-8`)
    }
    let frontmatter: Record<string, unknown>
    try {
      frontmatter = parseSkillFrontmatter(decoded)
    } catch (cause) {
      fail('frontmatter', uri, `${uri} has no readable frontmatter`, cause)
    }
    if (!frontmatterEquals(frontmatter, entry.frontmatter)) {
      fail('frontmatter', uri, `The frontmatter of ${uri} differs from the entry`)
    }
  }
  const file: SkillFile = { uri, bytes }
  if (typeof content.mimeType === 'string') {
    file.mimeType = content.mimeType
  }
  if (isText && decoded != null) {
    file.text = decoded
  }
  return file
}
