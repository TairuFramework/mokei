import type { FetchLike } from '../transport.js'

/** Default deadline for an OAuth metadata/token-endpoint fetch, in milliseconds. */
export const DEFAULT_OAUTH_FETCH_TIMEOUT_MS = 30_000

/** Default cap on an OAuth response body, in bytes. */
export const DEFAULT_OAUTH_MAX_RESPONSE_BYTES = 1_000_000

/** Concatenate a list of `Uint8Array` chunks into one contiguous buffer. */
function concatUint8(chunks: Array<Uint8Array>): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * Read `res`'s body up to `maxBytes`, throwing before any oversized body is fully buffered, then
 * parse it as JSON.
 *
 * The `content-length` header (when present) is checked first as a cheap fast-path; the running
 * total is checked again on every chunk since a response can omit or lie about that header (e.g.
 * chunked transfer-encoding).
 */
async function readCappedJson(res: Response, url: string, maxBytes: number): Promise<unknown> {
  const contentLength = Number(res.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`OAuth response from ${url} exceeds ${maxBytes} bytes`)
  }
  const body = res.body
  if (body == null) return {}
  const reader = body.getReader()
  const chunks: Array<Uint8Array> = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value != null) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error(`OAuth response from ${url} exceeds ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  }
  const text = new TextDecoder().decode(concatUint8(chunks))
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new Error(`OAuth response from ${url} is not valid JSON`, { cause })
  }
}

/**
 * Fetch an OAuth endpoint (protected-resource/AS metadata, a token endpoint) with a bounded
 * deadline and a response-size cap, then parse the body as JSON.
 *
 * `redirect: 'error'` is always set (every caller already relies on this SSRF/redirect guard). A
 * caller-supplied `signal`, when given, is combined with the timeout via `AbortSignal.any` so an
 * aborted outer request cancels this OAuth subrequest too, without ever loosening the deadline.
 *
 * Throws `Error(\`${errorLabel} HTTP ${status}\`)` on a non-ok response, so a caller's existing
 * message (e.g. `Token refresh HTTP 401`, `protected-resource metadata HTTP 404`) is reproduced
 * exactly by choosing `errorLabel` to match.
 */
export async function fetchOAuthJson(
  fetch: FetchLike,
  url: string,
  opts: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
    timeoutMs?: number
    maxBytes?: number
    errorLabel: string
  },
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_OAUTH_FETCH_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_OAUTH_MAX_RESPONSE_BYTES
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = opts.signal != null ? AbortSignal.any([opts.signal, timeout]) : timeout
  const res = await fetch(url, {
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
    redirect: 'error',
    signal,
  })
  if (!res.ok) {
    throw new Error(`${opts.errorLabel} HTTP ${res.status}`)
  }
  return readCappedJson(res, url, maxBytes)
}
