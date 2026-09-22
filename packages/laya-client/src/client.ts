import type { LayaBackend } from './backend.js'
import { LayaError } from './errors.js'
import { HttpLayaBackend, type LayaHTTPClientOptions } from './http.js'
import type { LayaModel, PredictResult, QuestionMap, State } from './types.js'
import { validateQuestions, validateResult, validateState } from './validation.js'

export type LayaPredictParams<TQuestions extends QuestionMap> = {
  state: State
  questions: TQuestions
  model?: string
  signal?: AbortSignal
}

export type LayaPredictBatchParams<TQuestions extends QuestionMap> = {
  states: Array<State>
  questions: TQuestions
  model?: string
  signal?: AbortSignal
}

export type LayaListModelsParams = {
  signal?: AbortSignal
}

export type LayaBackendClientOptions = {
  backend: LayaBackend
  defaultModel?: string
}

export class LayaClient {
  #backend: LayaBackend
  #defaultModel?: string

  constructor(options: LayaBackendClientOptions) {
    this.#backend = options.backend
    this.#defaultModel = options.defaultModel
  }

  #resolveModel(model?: string): string {
    const resolved = model ?? this.#defaultModel
    if (resolved == null) {
      throw new LayaError('A model is required: pass `model` or set `defaultModel`')
    }
    return resolved
  }

  async predict<TQuestions extends QuestionMap>(
    params: LayaPredictParams<TQuestions>,
  ): Promise<PredictResult<TQuestions>> {
    validateQuestions({ questions: params.questions })
    validateState({ state: params.state })
    const model = this.#resolveModel(params.model)
    const raw = await this.#backend.predict({
      state: params.state,
      questions: params.questions,
      model,
      signal: params.signal,
    })
    return validateResult({ questions: params.questions, raw })
  }

  async predictBatch<TQuestions extends QuestionMap>(
    params: LayaPredictBatchParams<TQuestions>,
  ): Promise<Array<PredictResult<TQuestions>>> {
    if (params.states.length === 0) {
      return []
    }
    validateQuestions({ questions: params.questions })
    for (const state of params.states) {
      validateState({ state })
    }
    const model = this.#resolveModel(params.model)
    if (this.#backend.batch != null) {
      const raws = await this.#backend.batch({
        states: params.states,
        questions: params.questions,
        model,
        signal: params.signal,
      })
      return raws.map((raw) => validateResult({ questions: params.questions, raw }))
    }
    const results: Array<PredictResult<TQuestions>> = []
    for (const state of params.states) {
      const raw = await this.#backend.predict({
        state,
        questions: params.questions,
        model,
        signal: params.signal,
      })
      results.push(validateResult({ questions: params.questions, raw }))
    }
    return results
  }

  async listModels(params?: LayaListModelsParams): Promise<Array<LayaModel>> {
    if (this.#backend.listModels == null) {
      throw new LayaError('Backend does not support listModels')
    }
    return this.#backend.listModels(params)
  }
}

export type CreateLayaClientOptions = LayaHTTPClientOptions | LayaBackendClientOptions

export function createLayaClient(options: CreateLayaClientOptions): LayaClient {
  if ('backend' in options) {
    return new LayaClient(options)
  }
  return new LayaClient({
    backend: new HttpLayaBackend(options),
    defaultModel: options.defaultModel,
  })
}
