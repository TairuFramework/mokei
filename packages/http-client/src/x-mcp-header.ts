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

import {
  type CollectResult,
  collectHeaderAnnotations,
  type HeaderAnnotation,
  isValidHeaderParamName,
} from '@mokei/context-protocol'

export {
  type CollectResult,
  collectHeaderAnnotations,
  type HeaderAnnotation,
  isValidHeaderParamName,
}

/** Base64 sentinel wrapper pattern, e.g. `=?base64?<value>?=`. */
const SENTINEL = /^=\?base64\?.*\?=$/

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
 * Encode a primitive value for use in an `Mcp-Param-*` or `Mcp-Name` header. Integers become
 * decimal strings, booleans become `"true"`/`"false"`, strings pass through unless they
 * require Base64 wrapping (non-ASCII, control characters, surrounding whitespace, or a
 * sentinel collision).
 *
 * Both headers share this encoding because both carry values a caller chooses freely -- a tool
 * argument, a tool/prompt name, a resource URI -- into a field an HTTP header can only hold as a
 * ByteString.
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
