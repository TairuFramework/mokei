import type { StandardSchemaV1 } from '@sozai/schema'

import type { SystemOneBackend } from './backend.js'
import { SystemOneError, SystemOneInputError, SystemOneResponseError } from './errors.js'
import { HTTPSystemOneBackend, type SystemOneHTTPClientParams } from './http.js'
import type { PredictResult, QuestionMap, State } from './types.js'
import { validateQuestions, validateResult, validateState } from './validation.js'

function inputValue<T>(result: StandardSchemaV1.Result<T>, message: string): T {
  if (result.issues != null) throw new SystemOneInputError({ message, issues: result.issues })
  return result.value
}

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
    inputValue(validateQuestions({ questions: params.questions }), 'Invalid question map')
    inputValue(validateState({ state: params.state }), 'Invalid state')
    const model = this.#resolveModel(params.model)
    const raw = await this.#backend.predict({
      state: params.state,
      questions: params.questions,
      model,
      signal: params.signal,
    })
    const result = validateResult({ questions: params.questions, raw })
    if (result.issues != null) {
      throw new SystemOneResponseError({
        message: 'Response failed validation',
        issues: result.issues,
      })
    }
    return result.value
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
