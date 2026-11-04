import {
  collectHeaderAnnotations,
  HEADER_MISMATCH,
  type HeaderAnnotation,
  MCP_NAME_HEADER_SOURCE,
} from '@mokei/context-protocol'

const BASE64_SENTINEL_PREFIX = '=?base64?'
const BASE64_SENTINEL_SUFFIX = '?='
const BASE64_CANONICAL = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * Decodes an `Mcp-Name` or `Mcp-Param-*` header value. A value wrapped in the
 * `=?base64?…?=` sentinel is decoded as UTF-8; any other value is returned as-is. Returns
 * `undefined` for a sentinel whose payload is not canonical Base64 or not valid UTF-8, which a
 * server must reject.
 */
export function decodeHeaderValue(value: string): string | undefined {
  if (
    value.length < BASE64_SENTINEL_PREFIX.length + BASE64_SENTINEL_SUFFIX.length ||
    !value.startsWith(BASE64_SENTINEL_PREFIX) ||
    !value.endsWith(BASE64_SENTINEL_SUFFIX)
  ) {
    return value
  }
  const payload = value.slice(BASE64_SENTINEL_PREFIX.length, -BASE64_SENTINEL_SUFFIX.length)
  if (!BASE64_CANONICAL.test(payload)) return undefined
  try {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

function headerMismatch(id: string | number | null, header: string, detail: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code: HEADER_MISMATCH,
        message: `Bad Request: the request headers and body disagree: ${detail}`,
        data: { mismatch: { header, body: detail } },
      },
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )
}

/**
 * SEP-2243 standard request headers for a `2026-07-28` POST, checked against the parsed body.
 * Returns the `400` (JSON-RPC `-32020`, `data.mismatch: { header, body }`) for the first failure,
 * or `null` when the headers agree with the body:
 *
 * - `MCP-Protocol-Version` must equal the body's `_meta` revision, and is required on requests;
 * - `Mcp-Method` must equal the body's `method`, and is required on requests;
 * - on a request whose method is in {@link MCP_NAME_HEADER_SOURCE} and whose body carries that
 *   field as a string, `Mcp-Name` is required and must decode to the same value.
 *
 * Notifications are checked only for disagreement, never for absence. `data.mismatch.header`
 * names the header (the client's stale-schema retry keys on `Mcp-Param-*` names there).
 */
export function validateStandardHeaders(params: {
  request: Request
  body: Record<string, unknown>
  protocolVersion: string
}): Response | null {
  const { request, body, protocolVersion } = params
  const method = typeof body.method === 'string' ? body.method : undefined
  const rawID = body.id
  const id = typeof rawID === 'string' || typeof rawID === 'number' ? rawID : null
  const isRequest = method != null && 'id' in body

  const versionHeader = request.headers.get('MCP-Protocol-Version')
  if (versionHeader == null) {
    if (isRequest) {
      return headerMismatch(
        id,
        'MCP-Protocol-Version',
        `the body envelope names protocol version ${protocolVersion} but the required MCP-Protocol-Version header is absent`,
      )
    }
  } else if (versionHeader !== protocolVersion) {
    return headerMismatch(
      id,
      'MCP-Protocol-Version',
      `the body envelope names protocol version ${protocolVersion} but the MCP-Protocol-Version header names ${versionHeader}`,
    )
  }

  if (method == null) return null
  const methodHeader = request.headers.get('Mcp-Method')
  if (methodHeader == null) {
    if (isRequest) {
      return headerMismatch(
        id,
        'Mcp-Method',
        `the body names method ${method} but the required Mcp-Method header is absent`,
      )
    }
  } else if (methodHeader !== method) {
    return headerMismatch(
      id,
      'Mcp-Method',
      `the body names method ${method} but the Mcp-Method header names ${methodHeader}`,
    )
  }

  if (!isRequest) return null
  const field = MCP_NAME_HEADER_SOURCE.get(method)
  if (field == null) return null
  const bodyParams = body.params
  const raw =
    bodyParams != null && typeof bodyParams === 'object'
      ? (bodyParams as Record<string, unknown>)[field]
      : undefined
  const bodyValue = typeof raw === 'string' ? raw : undefined
  const nameHeader = request.headers.get('Mcp-Name')
  if (nameHeader == null) {
    if (bodyValue == null) return null
    return headerMismatch(
      id,
      'Mcp-Name',
      `the body carries params.${field}=${JSON.stringify(bodyValue)} but the required Mcp-Name header is absent`,
    )
  }
  const decoded = decodeHeaderValue(nameHeader)
  if (decoded == null) {
    return headerMismatch(
      id,
      'Mcp-Name',
      'the Mcp-Name header carries an invalid Base64 sentinel value',
    )
  }
  if (bodyValue != null && decoded !== bodyValue) {
    return headerMismatch(
      id,
      'Mcp-Name',
      `the body carries params.${field}=${JSON.stringify(bodyValue)} but the Mcp-Name header names ${JSON.stringify(decoded)}`,
    )
  }
  return null
}

/** Collected annotations per `inputSchema` object; tool definitions are usually long-lived. */
const annotationCache = new WeakMap<object, Array<HeaderAnnotation> | null>()

function annotationsFor(inputSchema: unknown): Array<HeaderAnnotation> | null {
  if (inputSchema == null || typeof inputSchema !== 'object') return null
  let cached = annotationCache.get(inputSchema)
  if (cached === undefined) {
    const collected = collectHeaderAnnotations(inputSchema)
    // A tool with invalid annotations has nothing to check against: SEP-2243 clients exclude
    // such tools from their lists, so they never send headers for it.
    cached = collected.valid ? collected.annotations : null
    annotationCache.set(inputSchema, cached)
  }
  return cached
}

function valueAtPath(root: unknown, path: Array<string>): unknown {
  let node = root
  for (const key of path) {
    if (node == null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

const CANONICAL_DECIMAL = /^-?\d+(\.\d+)?$/

/**
 * SEP-2243 `Mcp-Param-*` headers for a `2026-07-28` `tools/call`, checked against the arguments
 * of the tool's `x-mcp-header` annotations (`server.toolInputSchema`). Returns the `400`
 * (`-32020`, `data.mismatch.header` naming the `Mcp-Param-*` header) for the first header that
 * is missing, badly encoded or different from the body, or `null` when they all agree.
 *
 * An argument that is absent, `null` or not a primitive needs no header, and a header for it is
 * ignored. Numbers compare numerically (`42.0` equals `42`). Unknown tools, and tools whose
 * annotations are invalid, are not checked.
 */
export function validateParamHeaders(params: {
  request: Request
  body: Record<string, unknown>
  server: { toolInputSchema(name: string): unknown }
}): Response | null {
  const { request, body, server } = params
  if (body.method !== 'tools/call' || !('id' in body)) return null
  const callParams = body.params as { name?: unknown; arguments?: unknown } | undefined
  if (typeof callParams?.name !== 'string') return null
  const annotations = annotationsFor(server.toolInputSchema(callParams.name))
  if (annotations == null || annotations.length === 0) return null
  const rawID = body.id
  const id = typeof rawID === 'string' || typeof rawID === 'number' ? rawID : null
  for (const { headerName, path } of annotations) {
    const header = `Mcp-Param-${headerName}`
    const value = valueAtPath(callParams.arguments, path)
    let expected: string
    if (typeof value === 'string') expected = value
    else if (typeof value === 'boolean') expected = value ? 'true' : 'false'
    else if (typeof value === 'number' && Number.isFinite(value)) expected = String(value)
    else continue
    const argument = `${path.join('.')}=${JSON.stringify(value)}`
    const raw = request.headers.get(header)
    if (raw == null) {
      return headerMismatch(
        id,
        header,
        `the body carries ${argument} but the ${header} header is absent`,
      )
    }
    const decoded = decodeHeaderValue(raw)
    if (decoded == null) {
      return headerMismatch(
        id,
        header,
        `the ${header} header carries an invalid Base64 sentinel value`,
      )
    }
    const agrees =
      typeof value === 'number' && CANONICAL_DECIMAL.test(decoded)
        ? Number(decoded) === value
        : decoded === expected
    if (!agrees) {
      return headerMismatch(
        id,
        header,
        `the ${header} header decodes to ${JSON.stringify(decoded)} but the body carries ${argument}`,
      )
    }
  }
  return null
}
