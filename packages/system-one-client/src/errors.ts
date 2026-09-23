export type ValidationIssue = {
  message: string
  path?: ReadonlyArray<unknown>
}

export class SystemOneError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SystemOneError'
  }
}

class ValidationError extends SystemOneError {
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
export class SystemOneInputError extends ValidationError {
  constructor(message: string, issues: Array<ValidationIssue> = [], options?: ErrorOptions) {
    super(message, issues, options)
    this.name = 'SystemOneInputError'
  }
}

/** The System One backend could not be reached, or returned an unmapped non-2xx status. */
export class SystemOneConnectionError extends SystemOneError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SystemOneConnectionError'
  }
}

/** 401 or 403: a missing or rejected Bearer key. */
export class SystemOneAuthError extends SystemOneError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SystemOneAuthError'
  }
}

/** The System One backend response was malformed or failed schema validation. */
export class SystemOneResponseError extends ValidationError {
  constructor(message: string, issues: Array<ValidationIssue> = [], options?: ErrorOptions) {
    super(message, issues, options)
    this.name = 'SystemOneResponseError'
  }
}

/** 404, or an unknown or unavailable model. */
export class SystemOneModelError extends SystemOneError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SystemOneModelError'
  }
}
