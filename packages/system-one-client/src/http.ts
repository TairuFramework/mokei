import { RetryExhaustedError, type RetryPolicy, retry, TimeoutInterruption } from '@sozai/async'
import ky, { HTTPError, type KyInstance } from 'ky'

import type { SystemOneBackend, SystemOneBackendPredictParams, SystemOneResult } from './backend.js'
import {
  SystemOneAuthError,
  SystemOneConnectionError,
  SystemOneError,
  SystemOneInputError,
  SystemOneModelError,
  SystemOneOverloadedError,
  SystemOneRateLimitError,
  type ValidationIssue,
} from './errors.js'
import { retryableSystemOneError } from './retryable-error.js'

export type SystemOneHTTPClientParams = {
  url: string
  apiKey?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  timeout?: number
  defaultModel?: string
  retry?: RetryPolicy
}

function mapRetryError(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) {
    throw signal.reason
  }
  if (error instanceof RetryExhaustedError) {
    if (error.reason === 'total_timeout') {
      throw new SystemOneConnectionError({
        message: 'System One request did not complete within the retry budget',
        cause: error,
      })
    }
    if (error.cause instanceof SystemOneError) {
      throw error.cause
    }
    if (error.cause instanceof TimeoutInterruption && error.cause.cause === 'attempt') {
      throw new SystemOneConnectionError({ message: 'System One request timed out', cause: error })
    }
  }
  if (error instanceof SystemOneError) {
    throw error
  }
  throw error
}

export type HTTPSystemOneBackendParams = Omit<SystemOneHTTPClientParams, 'defaultModel'>

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function isPathKey(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number'
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
      const path = Array.isArray(loc) ? loc.filter(isPathKey) : []
      return [path.length > 0 ? { message: text, path } : { message: text }]
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
    if (cause instanceof TimeoutInterruption) {
      throw cause
    }
    if (cause instanceof HTTPError) {
      const status = cause.response.status
      if (status === 401 || status === 403) {
        const mapped = new SystemOneAuthError({
          message: 'System One backend rejected the API key',
          cause,
        })
        throw mapped
      }
      if (status === 404) {
        const mapped = new SystemOneModelError({ message: 'Model or endpoint not found', cause })
        throw mapped
      }
      const issues = errorIssues(cause.data)
      if (status === 422) {
        const message = withReason('System One backend rejected the request (422)', issues)
        const mapped = new SystemOneInputError({ message, issues, cause })
        throw mapped
      }
      const message = withReason(`System One backend returned ${status}`, issues)
      if (status === 429 || status === 529) {
        const ErrorClass = status === 429 ? SystemOneRateLimitError : SystemOneOverloadedError
        const mapped = new ErrorClass({
          message,
          cause,
          status,
          retryAfterMs: retryAfterMs(cause.response),
        })
        throw mapped
      }
      const mapped = new SystemOneConnectionError({ message, cause, status })
      throw mapped
    }
    if (
      typeof DOMException !== 'undefined' &&
      cause instanceof DOMException &&
      cause.name === 'AbortError'
    ) {
      throw cause
    }
    const mapped = new SystemOneConnectionError({
      message: 'Failed to reach System One backend',
      cause,
    })
    throw mapped
  }
}

export class HTTPSystemOneBackend implements SystemOneBackend {
  #http: KyInstance
  #retry: RetryPolicy | undefined

  constructor(params: HTTPSystemOneBackendParams) {
    this.#retry = params.retry
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
    if (this.#retry == null) {
      return mapError(() => this.#post(params, params.signal))
    }

    try {
      return await retry(({ signal }) => mapError(() => this.#post(params, signal)), {
        policy: this.#retry,
        signal: params.signal,
        retryable: (error) =>
          error instanceof TimeoutInterruption && error.cause === 'attempt'
            ? true
            : retryableSystemOneError(error),
      })
    } catch (error) {
      mapRetryError(error, params.signal)
    }
  }

  #post(params: SystemOneBackendPredictParams, signal?: AbortSignal): Promise<SystemOneResult> {
    return this.#http
      .post('v1/systemone', {
        json: {
          state: params.state,
          questions: params.questions,
          ...(params.model === undefined ? {} : { model: params.model }),
        },
        signal,
      })
      .json<SystemOneResult>()
  }
}
