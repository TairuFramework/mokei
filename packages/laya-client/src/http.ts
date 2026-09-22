import ky, { HTTPError, type KyInstance } from 'ky'

import type {
  LayaBackend,
  LayaBackendBatchParams,
  LayaBackendListModelsParams,
  LayaBackendPredictParams,
  LayaResult,
} from './backend.js'
import { LayaAuthError, LayaConnectionError, LayaModelError, LayaResponseError } from './errors.js'
import type { LayaModel } from './types.js'
import { validateModels } from './validation.js'

export type LayaHTTPClientOptions = {
  url: string
  apiKey?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  timeout?: number
  defaultModel?: string
  /**
   * Enable the `/v1/decide/batch` endpoint. It is available on the local
   * `laya.cpp` backend only -- a hosted backend without this endpoint 404s,
   * so it defaults to unset/false and `LayaClient.predictBatch` falls back
   * to sequential `predict` calls.
   */
  batch?: boolean
}

export type HTTPLayaBackendParams = Omit<LayaHTTPClientOptions, 'defaultModel'>

async function mapError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    if (cause instanceof HTTPError) {
      const status = cause.response.status
      if (status === 401 || status === 403) {
        throw new LayaAuthError('Laya sidecar rejected the API key', { cause })
      }
      if (status === 404) {
        throw new LayaModelError('Model or endpoint not found', { cause })
      }
      throw new LayaConnectionError(`Sidecar returned ${status}`, { cause })
    }
    if (
      typeof DOMException !== 'undefined' &&
      cause instanceof DOMException &&
      cause.name === 'AbortError'
    ) {
      throw cause
    }
    throw new LayaConnectionError('Failed to reach Laya sidecar', { cause })
  }
}

export class HTTPLayaBackend implements LayaBackend {
  #http: KyInstance

  /**
   * Present only when the backend is constructed with `batch: true`. The
   * `/v1/decide/batch` endpoint is local-only, so a hosted backend must not
   * advertise this capability -- `LayaClient.predictBatch` checks
   * `backend.batch != null` and falls back to sequential `predict` calls
   * when it is absent.
   */
  batch?: (params: LayaBackendBatchParams) => Promise<Array<LayaResult>>

  constructor(params: HTTPLayaBackendParams) {
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
      this.batch = async (batchParams: LayaBackendBatchParams): Promise<Array<LayaResult>> => {
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
          throw new LayaResponseError('Batch response missing a results array', [
            { message: 'results must be an array', path: ['results'] },
          ])
        }
        const results = (body as { results: Array<LayaResult> }).results
        if (results.length !== batchParams.states.length) {
          throw new LayaResponseError('Batch result count does not match states', [
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

  async predict(params: LayaBackendPredictParams): Promise<LayaResult> {
    return mapError(() =>
      this.#http
        .post('v1/systemone', {
          json: { state: params.state, model: params.model, questions: params.questions },
          signal: params.signal,
        })
        .json<LayaResult>(),
    )
  }

  async listModels(params?: LayaBackendListModelsParams): Promise<Array<LayaModel>> {
    const raw = await mapError(() => this.#http.get('v1/models', { signal: params?.signal }).json())
    return validateModels({ raw })
  }
}
