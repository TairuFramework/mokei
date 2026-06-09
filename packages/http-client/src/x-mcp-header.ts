/**
 * Client-side support for the `x-mcp-header` tool-parameter annotation (SEP-2243).
 *
 * A server marks a `tools/call` argument to be mirrored into an HTTP header by adding
 * `"x-mcp-header": "<Name>"` to that parameter's schema entry inside the tool's
 * `inputSchema`. Clients construct an `Mcp-Param-{Name}` header carrying the encoded
 * argument value on the outgoing POST.
 *
 * @see https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http
 */

/** RFC 9110 field-name token characters (`1*tchar`). */
const TCHAR = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/

/** Base64 sentinel wrapper pattern, e.g. `=?base64?<value>?=`. */
const SENTINEL = /^=\?base64\?.*\?=$/

/** JSON Schema primitive types eligible for `x-mcp-header` (note: not `number`). */
const PRIMITIVE_TYPES = new Set(['boolean', 'integer', 'string'])

/** A validated `x-mcp-header` annotation and the argument path it maps to. */
export type HeaderAnnotation = {
  /** Header name portion: produces the `Mcp-Param-{headerName}` header. */
  headerName: string
  /** Property path into the `tools/call` arguments object. */
  path: Array<string>
}

/** Result of collecting `x-mcp-header` annotations from a tool `inputSchema`. */
export type CollectResult = {
  /** Valid annotations discovered (empty when {@link CollectResult.valid} is false). */
  annotations: Array<HeaderAnnotation>
  /** Whether every annotation in the schema satisfies the SEP-2243 constraints. */
  valid: boolean
  /** Human-readable validation errors (used for tool-list filtering warnings). */
  errors: Array<string>
}

/**
 * Whether a string is a valid `x-mcp-header` name: non-empty and matching the RFC 9110
 * `1*tchar` field-name token syntax.
 */
export function isValidHeaderParamName(name: string): boolean {
  return name.length > 0 && TCHAR.test(name)
}

function needsEncoding(value: string): boolean {
  if (value !== value.trim()) {
    return true
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    // Control characters and any non-ASCII (> 0x7E) require encoding.
    if (code < 0x20 || code > 0x7e) {
      return true
    }
  }
  // A plain value that itself matches the sentinel must be encoded to avoid ambiguity.
  return SENTINEL.test(value)
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/**
 * Encode a primitive argument value for use in an `Mcp-Param-*` header. Integers become
 * decimal strings, booleans become `"true"`/`"false"`, strings pass through unless they
 * require Base64 wrapping (non-ASCII, control characters, surrounding whitespace, or a
 * sentinel collision).
 *
 * @throws if given a non-integer number.
 */
export function encodeHeaderValue(value: string | number | boolean): string {
  let text: string
  if (typeof value === 'boolean') {
    text = value ? 'true' : 'false'
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error('x-mcp-header supports integer values only, not arbitrary numbers')
    }
    text = String(value)
  } else {
    text = value
  }
  return needsEncoding(text) ? `=?base64?${base64Utf8(text)}?=` : text
}

/**
 * Walk a tool `inputSchema` and collect every `x-mcp-header` annotation, validating the
 * SEP-2243 constraints: header names must be valid tokens, case-insensitively unique
 * within the schema, and may annotate only primitive (boolean/integer/string) types.
 */
export function collectHeaderAnnotations(inputSchema: unknown): CollectResult {
  const annotations: Array<HeaderAnnotation> = []
  const errors: Array<string> = []
  const seen = new Set<string>()

  const walk = (schema: unknown, path: Array<string>): void => {
    if (schema == null || typeof schema !== 'object') {
      return
    }
    const properties = (schema as { properties?: unknown }).properties
    if (properties == null || typeof properties !== 'object') {
      return
    }
    for (const [key, rawChild] of Object.entries(properties as Record<string, unknown>)) {
      if (rawChild == null || typeof rawChild !== 'object') {
        continue
      }
      const child = rawChild as Record<string, unknown>
      const childPath = [...path, key]
      const annotation = child['x-mcp-header']
      if (annotation !== undefined) {
        const at = childPath.join('.')
        if (typeof annotation !== 'string' || !isValidHeaderParamName(annotation)) {
          errors.push(`Invalid x-mcp-header name at ${at}`)
        } else if (seen.has(annotation.toLowerCase())) {
          errors.push(`Duplicate x-mcp-header "${annotation}" at ${at}`)
        } else if (typeof child.type !== 'string' || !PRIMITIVE_TYPES.has(child.type)) {
          errors.push(`x-mcp-header "${annotation}" at ${at} must annotate boolean/integer/string`)
        } else {
          seen.add(annotation.toLowerCase())
          annotations.push({ headerName: annotation, path: childPath })
        }
      }
      walk(child, childPath)
    }
  }

  walk(inputSchema, [])
  const valid = errors.length === 0
  return { annotations: valid ? annotations : [], valid, errors }
}

/**
 * Build the `Mcp-Param-*` headers for a `tools/call` from previously collected
 * annotations and the call arguments. Null or absent argument values are omitted.
 */
export function buildParamHeaders(
  annotations: Array<HeaderAnnotation>,
  args: Record<string, unknown> | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {}
  if (args == null) {
    return headers
  }
  for (const { headerName, path } of annotations) {
    let value: unknown = args
    for (const key of path) {
      if (value == null || typeof value !== 'object') {
        value = undefined
        break
      }
      value = (value as Record<string, unknown>)[key]
    }
    if (value == null) {
      continue
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      headers[`Mcp-Param-${headerName}`] = encodeHeaderValue(value)
    }
  }
  return headers
}
