import type { LayaModel, QuestionMap, State } from './types.js'

/**
 * Raw result as returned by a backend, before the client validates and maps it.
 * `answers` and `usage` carry the wire shapes (snake_case usage); the client's
 * `validateResult` validates them and maps `usage` to the camelCase `Usage`.
 */
export type LayaResult = {
  model: string
  answers: Record<string, unknown>
  usage: { input_tokens: number; output_tokens: number }
  extras?: Record<string, unknown>
}

export type LayaBackendPredictParams = {
  state: State
  questions: QuestionMap
  model: string
  signal?: AbortSignal
}

export type LayaBackendBatchParams = {
  states: Array<State>
  questions: QuestionMap
  model: string
  signal?: AbortSignal
}

export type LayaBackendListModelsParams = {
  signal?: AbortSignal
}

export type LayaBackend = {
  predict: (params: LayaBackendPredictParams) => Promise<LayaResult>
  batch?: (params: LayaBackendBatchParams) => Promise<Array<LayaResult>>
  listModels?: (params?: LayaBackendListModelsParams) => Promise<Array<LayaModel>>
  close?: () => Promise<void>
}
