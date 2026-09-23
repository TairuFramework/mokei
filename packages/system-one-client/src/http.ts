import ky, { HTTPError, type KyInstance } from 'ky'

import type {
  SystemOneBackend,
  SystemOneBackendBatchParams,
  SystemOneBackendListModelsParams,
  SystemOneBackendPredictParams,
  SystemOneResult,
} from './backend.js'
import {
  SystemOneAuthError,
  SystemOneConnectionError,
  SystemOneModelError,
  SystemOneResponseError,
} from './errors.js'
import type { SystemOneModel } from './types.js'
import { validateModels } from './validation.js'

export type SystemOneHTTPClientOptions = {
  url: string
  apiKey?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  timeout?: number
  defaultModel?: string
  /**
   * Enable the `/v1/decide/batch` endpoint. It is available on the local
   * `laya.cpp` backend only -- a hosted backend without this endpoint 404s,
   * so it defaults to unset/false and `SystemOneClient.predictBatch` falls back
   * to individual `predict` calls with bounded concurrency.
   */
  batch?: boolean
}

export type HTTPSystemOneBackendParams = Omit<SystemOneHTTPClientOptions, 'defaultModel'>

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
      throw new SystemOneConnectionError(`System One backend returned ${status}`, { cause })
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

  /**
   * Present only when the backend is constructed with `batch: true`. The
   * `/v1/decide/batch` endpoint is local-only, so a hosted backend must not
   * advertise this capability -- `SystemOneClient.predictBatch` checks
   * `backend.batch != null` and falls back to individual `predict` calls
   * when it is absent.
   */
  batch?: (params: SystemOneBackendBatchParams) => Promise<Array<SystemOneResult>>

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

    if (params.batch === true) {
      this.batch = async (
        batchParams: SystemOneBackendBatchParams,
      ): Promise<Array<SystemOneResult>> => {
        const body = await mapError(() =>
          this.#http
            .post('v1/decide/batch', {
              json: {
                states: batchParams.states,
                model: batchParams.model,
                questions: batchParams.questions,
              },
              signal: batchParams.signal,
            })
            .json<unknown>(),
        )
        if (
          body == null ||
          typeof body !== 'object' ||
          !Array.isArray((body as { results?: unknown }).results)
        ) {
          throw new SystemOneResponseError('Batch response missing a results array', [
            { message: 'results must be an array', path: ['results'] },
          ])
        }
        const results = (body as { results: Array<SystemOneResult> }).results
        if (results.length !== batchParams.states.length) {
          throw new SystemOneResponseError('Batch result count does not match states', [
            {
              message: `expected ${batchParams.states.length} results, got ${results.length}`,
              path: ['results'],
            },
          ])
        }
        return results
      }
    }
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
