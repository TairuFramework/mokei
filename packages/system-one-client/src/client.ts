import type { SystemOneBackend } from './backend.js'
import { SystemOneError, SystemOneInputError } from './errors.js'
import { HTTPSystemOneBackend, type SystemOneHTTPClientOptions } from './http.js'
import type { PredictResult, QuestionMap, State, SystemOneModel } from './types.js'
import { validateQuestions, validateResult, validateState } from './validation.js'

export type SystemOnePredictParams<TQuestions extends QuestionMap> = {
  state: State
  questions: TQuestions
  model?: string
  signal?: AbortSignal
}

/** Maximum concurrent predict calls when the backend has no batch endpoint. */
const DEFAULT_BATCH_CONCURRENCY = 4

export type SystemOnePredictBatchParams<TQuestions extends QuestionMap> = {
  states: Array<State>
  questions: TQuestions
  model?: string
  signal?: AbortSignal
  /** Maximum concurrent predict calls when the backend has no batch endpoint. Defaults to 4. */
  concurrency?: number
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
    if (
      params.concurrency != null &&
      (!Number.isInteger(params.concurrency) || params.concurrency < 1)
    ) {
      throw new SystemOneInputError('concurrency must be a positive integer', [
        { message: 'must be an integer of at least 1', path: ['concurrency'] },
      ])
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
    return await this.#predictConcurrently(params, model)
  }

  /** Fallback when the backend has no batch endpoint: bounded concurrent predict calls, in input order. */
  async #predictConcurrently<TQuestions extends QuestionMap>(
    params: SystemOnePredictBatchParams<TQuestions>,
    model: string,
  ): Promise<Array<PredictResult<TQuestions>>> {
    const { states, questions } = params
    // Aborted on the first failure so in-flight siblings stop. Linked to the caller's signal by hand
    // rather than with AbortSignal.any, which React Native runtimes may lack.
    const controller = new AbortController()
    const { signal } = controller
    const onCallerAbort = () => controller.abort(params.signal?.reason)
    if (params.signal?.aborted) {
      onCallerAbort()
    } else {
      params.signal?.addEventListener('abort', onCallerAbort, { once: true })
    }
    const results: Array<PredictResult<TQuestions>> = new Array(states.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < states.length && !signal.aborted) {
        const index = next++
        const state = states[index] as State
        const raw = await this.#backend.predict({ state, questions, model, signal })
        results[index] = validateResult({ questions, raw })
      }
    }
    const workerCount = Math.min(params.concurrency ?? DEFAULT_BATCH_CONCURRENCY, states.length)
    try {
      await Promise.all(Array.from({ length: workerCount }, worker))
    } catch (error) {
      controller.abort(error)
      throw error
    } finally {
      params.signal?.removeEventListener('abort', onCallerAbort)
    }
    if (signal.aborted) {
      // Caller aborted between calls: workers stopped early, so results are incomplete.
      throw signal.reason
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
