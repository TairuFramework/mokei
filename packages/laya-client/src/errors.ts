export type ValidationIssue = {
  message: string
  path?: ReadonlyArray<unknown>
}

export class LayaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LayaError'
  }
}

class ValidationError extends LayaError {
  #issues: Array<ValidationIssue>

  constructor(message: string, issues: Array<ValidationIssue>, options?: ErrorOptions) {
    super(message, options)
    this.#issues = issues
  }

  get issues(): Array<ValidationIssue> {
    return this.#issues
  }
}

/** Caller-supplied questions or state failed schema validation. Thrown before any request. */
export class LayaInputError extends ValidationError {
  constructor(message: string, issues: Array<ValidationIssue> = [], options?: ErrorOptions) {
    super(message, issues, options)
    this.name = 'LayaInputError'
  }
}

/** The sidecar could not be reached, or returned an unmapped non-2xx status. */
export class LayaConnectionError extends LayaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LayaConnectionError'
  }
}

/** 401 or 403: a missing or rejected Bearer key. */
export class LayaAuthError extends LayaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LayaAuthError'
  }
}

/** The sidecar response was malformed or failed schema validation. */
export class LayaResponseError extends ValidationError {
  constructor(message: string, issues: Array<ValidationIssue> = [], options?: ErrorOptions) {
    super(message, issues, options)
    this.name = 'LayaResponseError'
  }
}

/** 404, or an unknown or unavailable model. */
export class LayaModelError extends LayaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LayaModelError'
  }
}
