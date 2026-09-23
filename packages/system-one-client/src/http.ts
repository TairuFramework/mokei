import ky, { HTTPError, type KyInstance } from 'ky'

import type {
  SystemOneBackend,
  SystemOneBackendListModelsParams,
  SystemOneBackendPredictParams,
  SystemOneResult,
} from './backend.js'
import { SystemOneAuthError, SystemOneConnectionError, SystemOneModelError } from './errors.js'
import type { SystemOneModel } from './types.js'
import { validateModels } from './validation.js'

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
 * Pull a readable reason out of an error body. Covers FastAPI (`laya-serve`: `detail` as a string
 * or a validation list of `{ msg }`), a top-level `message`, an `error` string or `{ message }`,
 * and plain text.
 */
function errorDetail(data: unknown): string | null {
  if (typeof data === 'string') {
    return stringOrNull(data.trim())
  }
  if (data == null || typeof data !== 'object') {
    return null
  }
  const { detail, message, error } = data as Record<string, unknown>
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => stringOrNull((item as { msg?: unknown } | null)?.msg))
      .filter((msg) => msg != null)
    return messages.length === 0 ? null : messages.join('; ')
  }
  return (
    stringOrNull(detail) ??
    stringOrNull(message) ??
    stringOrNull(error) ??
    stringOrNull((error as { message?: unknown } | null)?.message)
  )
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
      const detail = errorDetail(cause.data)
      const message = `System One backend returned ${status}`
      throw new SystemOneConnectionError(detail == null ? message : `${message}: ${detail}`, {
        cause,
      })
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

  async listModels(params?: SystemOneBackendListModelsParams): Promise<Array<SystemOneModel>> {
    const raw = await mapError(() => this.#http.get('v1/models', { signal: params?.signal }).json())
    return validateModels({ raw })
  }
}
