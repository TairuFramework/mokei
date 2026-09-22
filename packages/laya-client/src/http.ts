import ky, { HTTPError, type KyInstance } from 'ky'

import type {
  LayaBackend,
  LayaBackendBatchParams,
  LayaBackendListModelsParams,
  LayaBackendPredictParams,
  LayaResult,
} from './backend.js'
import { LayaAuthError, LayaConnectionError, LayaModelError } from './errors.js'
import type { LayaModel } from './types.js'
import { validateModels } from './validation.js'

export type LayaHTTPClientOptions = {
  url: string
  apiKey?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  timeout?: number
  defaultModel?: string
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

  constructor(params: HTTPLayaBackendParams) {
    const headers = { ...params.headers }
    if (params.apiKey != null && params.apiKey !== '') {
      headers.Authorization = `Bearer ${params.apiKey}`
    }
    this.#http = ky.create({
      prefix: params.url,
      headers,
      fetch: params.fetch,
      timeout: params.timeout,
    })
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

  async batch(params: LayaBackendBatchParams): Promise<Array<LayaResult>> {
    const body = await mapError(() =>
      this.#http
        .post('v1/decide/batch', {
          json: { states: params.states, model: params.model, questions: params.questions },
          signal: params.signal,
        })
        .json<{ results: Array<LayaResult> }>(),
    )
    return body.results
  }

  async listModels(params?: LayaBackendListModelsParams): Promise<Array<LayaModel>> {
    const raw = await mapError(() => this.#http.get('v1/models', { signal: params?.signal }).json())
    return validateModels({ raw })
  }
}
