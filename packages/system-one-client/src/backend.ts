import type { QuestionMap, State } from './types.js'

/**
 * Raw result as returned by a backend, before the client validates and maps it.
 * `answers` and `usage` carry the wire shapes (snake_case usage); the client's
 * `validateResult` validates them and maps `usage` to the camelCase `Usage`.
 */
export type SystemOneResult = {
  model: string
  answers: Record<string, unknown>
  usage: { input_tokens: number; output_tokens: number }
}

export type SystemOneBackendPredictParams = {
  state: State
  questions: QuestionMap
  model: string
  signal?: AbortSignal
}

export type SystemOneBackend = {
  predict: (params: SystemOneBackendPredictParams) => Promise<SystemOneResult>
  close?: () => Promise<void>
}
