import ky, { HTTPError, type KyInstance } from 'ky'

import type { SystemOneBackend, SystemOneBackendPredictParams, SystemOneResult } from './backend.js'
import {
  SystemOneAuthError,
  SystemOneConnectionError,
  SystemOneInputError,
  SystemOneModelError,
  SystemOneOverloadedError,
  SystemOneRateLimitError,
  type ValidationIssue,
} from './errors.js'

export type SystemOneHTTPClientOptions = {
  url: string
  apiKey?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  timeout?: number
  defaultModel?: string
}

export type HTTPSystemOneBackendParams = Omit<SystemOneHTTPClientOptions, 'defaultModel'>

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Pull the reasons out of an error body. Covers FastAPI (`laya-serve`: `detail` as a string or a
 * validation list of `{ loc, msg }`), a top-level `message`, an `error` string or `{ message }`,
 * and plain text.
 */
function errorIssues(data: unknown): Array<ValidationIssue> {
  if (typeof data === 'string') {
    const text = stringOrNull(data.trim())
    return text == null ? [] : [{ message: text }]
  }
  if (data == null || typeof data !== 'object') {
    return []
  }
  const { detail, message, error } = data as Record<string, unknown>
  if (Array.isArray(detail)) {
    return detail.flatMap((item) => {
      const { loc, msg } = (item ?? {}) as { loc?: unknown; msg?: unknown }
      const text = stringOrNull(msg)
      if (text == null) return []
      return [Array.isArray(loc) ? { message: text, path: loc } : { message: text }]
    })
  }
  const text =
    stringOrNull(detail) ??
    stringOrNull(message) ??
    stringOrNull(error) ??
    stringOrNull((error as { message?: unknown } | null)?.message)
  return text == null ? [] : [{ message: text }]
}

// Keeps a proxy's HTML error page or a stack trace out of error messages (and MCP tool output).
const MAX_REASON_LENGTH = 300

function withReason(message: string, issues: Array<ValidationIssue>): string {
  if (issues.length === 0) return message
  const reason = issues.map((i) => i.message).join('; ')
  return `${message}: ${reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH)}…` : reason}`
}

/** `Retry-After` as delay-seconds or an HTTP date, in milliseconds. */
function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after')?.trim()
  if (value == null || value === '') return undefined
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now())
}

async function mapError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    if (cause instanceof HTTPError) {
      const status = cause.response.status
      if (status === 401 || status === 403) {
        throw new SystemOneAuthError('System One backend rejected the API key', { cause })
      }
      if (status === 404) {
        throw new SystemOneModelError('Model or endpoint not found', { cause })
      }
      const issues = errorIssues(cause.data)
      if (status === 422) {
        const message = withReason('System One backend rejected the request (422)', issues)
        // biome-ignore lint/style/useErrorCause: cause is passed in the third argument, after issues
        throw new SystemOneInputError(message, issues, { cause })
      }
      const message = withReason(`System One backend returned ${status}`, issues)
      if (status === 429 || status === 529) {
        const ErrorClass = status === 429 ? SystemOneRateLimitError : SystemOneOverloadedError
        throw new ErrorClass(message, {
          cause,
          status,
          retryAfterMs: retryAfterMs(cause.response),
        })
      }
      throw new SystemOneConnectionError(message, { cause, status })
    }
    if (
      typeof DOMException !== 'undefined' &&
      cause instanceof DOMException &&
      cause.name === 'AbortError'
    ) {
      throw cause
    }
    throw new SystemOneConnectionError('Failed to reach System One backend', { cause })
  }
}

export class HTTPSystemOneBackend implements SystemOneBackend {
  #http: KyInstance

  constructor(params: HTTPSystemOneBackendParams) {
    const headers = new Headers(params.headers)
    if (params.apiKey != null && params.apiKey !== '') {
      headers.set('Authorization', `Bearer ${params.apiKey}`)
    }
    this.#http = ky.create({
      prefix: params.url,
      headers,
      fetch: params.fetch,
      timeout: params.timeout,
    })
  }

  async predict(params: SystemOneBackendPredictParams): Promise<SystemOneResult> {
    return mapError(() =>
      this.#http
        .post('v1/systemone', {
          json: { state: params.state, model: params.model, questions: params.questions },
          signal: params.signal,
        })
        .json<SystemOneResult>(),
    )
  }
}
