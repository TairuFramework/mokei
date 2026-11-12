export type ContextUnavailableErrorParams = { key: string; cause?: unknown }

/**
 * The context cannot serve a request: a reconnect did not finish in time, or the context was
 * removed (or removed and re-added) while the request waited for it. `cause` says why.
 */
export class ContextUnavailableError extends Error {
  #key: string

  constructor(params: ContextUnavailableErrorParams) {
    super(`Context ${params.key} is unavailable`, { cause: params.cause })
    this.name = 'ContextUnavailableError'
    this.#key = params.key
  }

  get key(): string {
    return this.#key
  }
}

export type ReconnectExhaustedErrorParams = { key: string; attempts: number; cause?: unknown }

/** Every reconnect attempt for a lost context failed. `cause` is the last attempt's error. */
export class ReconnectExhaustedError extends Error {
  #key: string
  #attempts: number

  constructor(params: ReconnectExhaustedErrorParams) {
    super(`Context ${params.key} could not reconnect after ${params.attempts} attempts`, {
      cause: params.cause,
    })
    this.name = 'ReconnectExhaustedError'
    this.#key = params.key
    this.#attempts = params.attempts
  }

  get key(): string {
    return this.#key
  }

  get attempts(): number {
    return this.#attempts
  }
}

/**
 * Thrown by a reconnect factory to give up on the loss without spending attempts: the reconnect
 * ends with a {@link ReconnectExhaustedError} (`attempts: 0`) whose `cause` is this error.
 */
export class ReconnectDeclinedError extends Error {
  constructor(params: ReconnectDeclinedErrorParams = {}) {
    super(params.message ?? 'reconnect declined', { cause: params.cause })
    this.name = 'ReconnectDeclinedError'
  }
}
export type ReconnectDeclinedErrorParams = { message?: string; cause?: unknown }
