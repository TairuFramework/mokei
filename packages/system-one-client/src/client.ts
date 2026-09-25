import type { SystemOneBackend } from './backend.js'
import { SystemOneError } from './errors.js'
import { HTTPSystemOneBackend, type SystemOneHTTPClientParams } from './http.js'
import type { PredictResult, QuestionMap, State } from './types.js'
import { validateQuestions, validateResult, validateState } from './validation.js'

export type SystemOnePredictParams<TQuestions extends QuestionMap> = {
  state: State
  questions: TQuestions
  model?: string
  signal?: AbortSignal
}

export type SystemOneClientParams = {
  backend: SystemOneBackend
  defaultModel?: string
}

export class SystemOneClient {
  #backend: SystemOneBackend
  #defaultModel?: string

  constructor(params: SystemOneClientParams) {
    this.#backend = params.backend
    this.#defaultModel = params.defaultModel
  }

  #resolveModel(model?: string): string {
    const resolved = model ?? this.#defaultModel
    if (resolved == null) {
      throw new SystemOneError({
        message: 'A model is required: pass `model` or set `defaultModel`',
      })
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
}

export type CreateSystemOneClientParams = SystemOneHTTPClientParams | SystemOneClientParams

export function createSystemOneClient(params: CreateSystemOneClientParams): SystemOneClient {
  if ('backend' in params) {
    return new SystemOneClient(params)
  }
  return new SystemOneClient({
    backend: new HTTPSystemOneBackend(params),
    defaultModel: params.defaultModel,
  })
}
