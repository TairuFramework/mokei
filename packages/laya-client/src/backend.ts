import type { LayaModel, QuestionMap, State, Usage } from './types.js'

export type LayaResult = {
  model: string
  answers: Record<string, unknown>
  usage: Usage
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
