/** What went wrong with a provider request, independent of the provider's own error codes. */
export type ProviderErrorKind =
  /** Too many requests (`429`, a provider rate-limit error) */
  | 'rate_limit'
  /** The provider is temporarily over capacity (`503`, `529`, an overloaded error) */
  | 'overloaded'
  /** Any other server-side failure (`5xx`, a provider API error) */
  | 'server'
  /** The connection failed or the response stream was cut */
  | 'network'
  /** The request timed out (not a caller abort) */
  | 'timeout'
  /** The credentials were missing, invalid or not allowed (`401`, `403`) */
  | 'auth'
  /** The request itself was rejected (other `4xx`) */
  | 'invalid_request'
  /** The prompt is longer than the model's context window */
  | 'context_length'
  /** Anything that could not be classified */
  | 'unknown'

const RETRYABLE_KINDS: ReadonlySet<ProviderErrorKind> = new Set([
  'rate_limit',
  'overloaded',
  'server',
  'network',
  'timeout',
])

/** Whether failures of this kind can succeed when the same request is sent again. */
export function isRetryableKind(kind: ProviderErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind)
}

export type ProviderErrorParams = {
  message: string
  kind: ProviderErrorKind
  /** Provider name, as in `ProviderTelemetry.providerName` */
  provider: string
  /** Defaults from `kind`: rate limit, overloaded, server, network and timeout are retryable */
  retryable?: boolean
  /** HTTP status, when the failure came with one */
  status?: number
  /** Provider-specific error code or type, such as `overloaded_error` */
  code?: string
  /** How long the provider asked to wait before retrying, in milliseconds */
  retryAfterMs?: number
  cause?: unknown
}

/**
 * A failed provider request, classified so callers can tell a transient failure from a fatal
 * one. Providers throw it from their requests and carry it in stream `error` parts. The
 * original error (an HTTP error, a stream event) stays available as `cause`.
 */
export class ProviderError extends Error {
  #kind: ProviderErrorKind
  #provider: string
  #retryable: boolean
  #status: number | undefined
  #code: string | undefined
  #retryAfterMs: number | undefined

  constructor(params: ProviderErrorParams) {
    super(params.message, { cause: params.cause })
    this.name = 'ProviderError'
    this.#kind = params.kind
    this.#provider = params.provider
    this.#retryable = params.retryable ?? isRetryableKind(params.kind)
    this.#status = params.status
    this.#code = params.code
    this.#retryAfterMs = params.retryAfterMs
  }

  get kind(): ProviderErrorKind {
    return this.#kind
  }

  get provider(): string {
    return this.#provider
  }

  get retryable(): boolean {
    return this.#retryable
  }

  get status(): number | undefined {
    return this.#status
  }

  get code(): string | undefined {
    return this.#code
  }

  get retryAfterMs(): number | undefined {
    return this.#retryAfterMs
  }
}

/** Whether `error` is a {@link ProviderError} that can succeed when the request is sent again. */
export function isRetryableProviderError(error: unknown): boolean {
  return error instanceof ProviderError && error.retryable
}

/** Classify an HTTP status. `undefined` for statuses that are not failures. */
export function kindFromStatus(status: number): ProviderErrorKind | undefined {
  if (status === 429) return 'rate_limit'
  if (status === 503 || status === 529) return 'overloaded'
  if (status === 408) return 'timeout'
  if (status === 401 || status === 403) return 'auth'
  if (status >= 500) return 'server'
  if (status >= 400) return 'invalid_request'
  return undefined
}

/** Read-only view of the response headers, so callers need not pass a `Headers` instance. */
export type HeaderSource = { get(name: string): string | null }

/**
 * The wait a response asks for before a retry, in milliseconds: `retry-after-ms`, then
 * `Retry-After` as seconds or an HTTP date. `undefined` when absent or unparsable.
 */
export function parseRetryAfter(
  headers: HeaderSource,
  now: number = Date.now(),
): number | undefined {
  const ms = headers.get('retry-after-ms')
  if (ms != null) {
    const value = Number(ms)
    if (ms.trim() !== '' && Number.isFinite(value) && value >= 0) return value
  }
  const header = headers.get('retry-after')
  if (header == null || header.trim() === '') return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined
  const date = Date.parse(header)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - now)
}

const CONTEXT_LENGTH_PATTERN =
  /context[ _-]?(length|window)|maximum context|too many tokens|prompt is too long|input is too long/i

/** Whether a provider error message or code says the prompt exceeds the context window. */
export function isContextLengthMessage(text: string | undefined): boolean {
  return text != null && CONTEXT_LENGTH_PATTERN.test(text)
}

export type ProviderErrorFromResponseParams = {
  provider: string
  status: number
  headers?: HeaderSource
  /** Provider error code or type read from the body, such as `rate_limit_error` */
  code?: string
  /** Provider error message read from the body */
  message?: string
  /** Overrides the kind derived from `status` (a provider code can be more precise) */
  kind?: ProviderErrorKind
  cause?: unknown
}

/** Build a {@link ProviderError} from a failed HTTP response's status, headers and body fields. */
export function providerErrorFromResponse(params: ProviderErrorFromResponseParams): ProviderError {
  const { provider, status, code, message } = params
  let kind = params.kind ?? kindFromStatus(status) ?? 'unknown'
  if (
    params.kind == null &&
    kind === 'invalid_request' &&
    (isContextLengthMessage(code) || isContextLengthMessage(message))
  ) {
    kind = 'context_length'
  }
  const detail = message ?? code
  return new ProviderError({
    message: `${provider} request failed with status ${status}${detail ? `: ${detail}` : ''}`,
    kind,
    provider,
    status,
    code,
    retryAfterMs: params.headers == null ? undefined : parseRetryAfter(params.headers),
    cause: params.cause,
  })
}

/** Whether `error` is the abort reason of a cancelled request rather than a failure. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Classify a transport-level failure that is not an HTTP response: a request timeout or a
 * failed connection. Returns `undefined` for errors that are neither (including aborts), which
 * callers should rethrow unchanged.
 */
export function providerErrorFromTransport(
  provider: string,
  error: unknown,
): ProviderError | undefined {
  if (!(error instanceof Error) || isAbortError(error)) return undefined
  if (error.name === 'TimeoutError') {
    return new ProviderError({
      message: `${provider} request timed out`,
      kind: 'timeout',
      provider,
      cause: error,
    })
  }
  // `fetch` rejects with a TypeError on network failure; stream reads surface resets the same way.
  if (
    error.name === 'TypeError' &&
    /fetch|network|socket|terminated|ECONN|reset/i.test(error.message)
  ) {
    return new ProviderError({
      message: `${provider} connection failed: ${error.message}`,
      kind: 'network',
      provider,
      cause: error,
    })
  }
  return undefined
}

/**
 * Wrap a stream so a read failure surfaces as the error `mapError` returns: providers use it
 * to turn a connection reset mid-stream into a `network` {@link ProviderError}.
 */
export function mapStreamErrors<T>(
  stream: ReadableStream<T>,
  mapError: (error: unknown) => unknown,
): ReadableStream<T> {
  const reader = stream.getReader()
  return new ReadableStream<T>(
    {
      async pull(controller) {
        let result: ReadableStreamReadResult<T>
        try {
          result = await reader.read()
        } catch (error) {
          controller.error(mapError(error))
          return
        }
        if (result.done) {
          controller.close()
        } else {
          controller.enqueue(result.value)
        }
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    },
    { highWaterMark: 0 },
  )
}

/** What a provider reads from an error body: its code, its message, and any override. */
export type ErrorBodyFields = {
  code?: string
  message?: string
  /** Overrides the kind derived from the HTTP status */
  kind?: ProviderErrorKind
  /** Overrides the retryable default for the kind (such as a quota exhausted on a `429`) */
  retryable?: boolean
}

export type ToProviderErrorParams = {
  provider: string
  error: unknown
  /** Reads the provider's error body (already parsed JSON, or text) */
  readBody?: (data: unknown) => ErrorBodyFields
}

type HTTPErrorShape = {
  response: { status: number; headers: HeaderSource }
  data?: unknown
}

function isHTTPErrorShape(error: unknown): error is Error & HTTPErrorShape {
  if (!(error instanceof Error) || error.name !== 'HTTPError') return false
  const response = (error as { response?: unknown }).response
  return (
    typeof response === 'object' &&
    response != null &&
    typeof (response as { status?: unknown }).status === 'number'
  )
}

/**
 * Classify a failed provider request. Handles HTTP clients' `HTTPError` (with a `response` and
 * pre-parsed `data`, as ky throws), `NetworkError`, `TimeoutError` and `fetch` network
 * failures. A {@link ProviderError} passes through; aborts and unrecognised errors are returned
 * unchanged so callers can rethrow them.
 */
export function toProviderError(params: ToProviderErrorParams): unknown {
  const { provider, error } = params
  if (error instanceof ProviderError || !(error instanceof Error) || isAbortError(error)) {
    return error
  }
  if (isHTTPErrorShape(error)) {
    const fields = error.data === undefined ? {} : (params.readBody?.(error.data) ?? {})
    const mapped = providerErrorFromResponse({
      provider,
      status: error.response.status,
      headers: error.response.headers,
      code: fields.code,
      message: fields.message,
      kind: fields.kind,
      cause: error,
    })
    if (fields.retryable == null || fields.retryable === mapped.retryable) return mapped
    return new ProviderError({
      message: mapped.message,
      kind: mapped.kind,
      provider,
      retryable: fields.retryable,
      status: mapped.status,
      code: mapped.code,
      retryAfterMs: mapped.retryAfterMs,
      cause: error,
    })
  }
  if (error.name === 'NetworkError') {
    return new ProviderError({
      message: `${provider} connection failed: ${error.message}`,
      kind: 'network',
      provider,
      cause: error,
    })
  }
  return providerErrorFromTransport(provider, error) ?? error
}
