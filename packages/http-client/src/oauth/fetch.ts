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
 * Read `res`'s body up to `maxBytes`, throwing before an oversized body is fully buffered, then
 * parse as JSON. `content-length` is a cheap fast-path; the running total is re-checked per chunk
 * since a response can omit or lie about that header (e.g. chunked transfer-encoding).
 */
async function readCappedJSON(res: Response, url: string, maxBytes: number): Promise<unknown> {
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
 * Fetch an OAuth endpoint with a bounded deadline and a response-size cap, then parse as JSON.
 * `redirect: 'error'` guards against SSRF/redirects. A caller `signal` is combined with the
 * timeout via `AbortSignal.any`, so an aborted outer request cancels this one without loosening
 * the deadline. Throws `Error(\`${errorLabel} HTTP ${status}\`)` on a non-ok response.
 */
export async function fetchOAuthJSON(
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
  return readCappedJSON(res, url, maxBytes)
}
