import type { SystemOneBackend } from './backend.js'
import { SystemOneError } from './errors.js'
import { HTTPSystemOneBackend, type SystemOneHTTPClientOptions } from './http.js'
import type { PredictResult, QuestionMap, State, SystemOneModel } from './types.js'
import { validateQuestions, validateResult, validateState } from './validation.js'

export type SystemOnePredictParams<TQuestions extends QuestionMap> = {
  state: State
  questions: TQuestions
  model?: string
  signal?: AbortSignal
}

export type SystemOnePredictBatchParams<TQuestions extends QuestionMap> = {
  states: Array<State>
  questions: TQuestions
  model?: string
  signal?: AbortSignal
}

export type SystemOneListModelsParams = {
  signal?: AbortSignal
}

export type SystemOneBackendClientOptions = {
  backend: SystemOneBackend
  defaultModel?: string
}

export class SystemOneClient {
  #backend: SystemOneBackend
  #defaultModel?: string

  constructor(options: SystemOneBackendClientOptions) {
    this.#backend = options.backend
    this.#defaultModel = options.defaultModel
  }

  #resolveModel(model?: string): string {
    const resolved = model ?? this.#defaultModel
    if (resolved == null) {
      throw new SystemOneError('A model is required: pass `model` or set `defaultModel`')
    }
    return resolved
  }

  async predict<TQuestions extends QuestionMap>(
    params: SystemOnePredictParams<TQuestions>,
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
    params: SystemOnePredictBatchParams<TQuestions>,
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

  async listModels(params?: SystemOneListModelsParams): Promise<Array<SystemOneModel>> {
    if (this.#backend.listModels == null) {
      throw new SystemOneError('Backend does not support listModels')
    }
    return this.#backend.listModels(params)
  }
}

export type CreateSystemOneClientOptions =
  | SystemOneHTTPClientOptions
  | SystemOneBackendClientOptions

export function createSystemOneClient(options: CreateSystemOneClientOptions): SystemOneClient {
  if ('backend' in options) {
    return new SystemOneClient(options)
  }
  return new SystemOneClient({
    backend: new HTTPSystemOneBackend(options),
    defaultModel: options.defaultModel,
  })
}
