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

/**
 * Caller-supplied questions or state failed validation: in the client before any request, or in
 * the backend (a 422 response).
 */
export class SystemOneInputError extends ValidationError {
  constructor(message: string, issues: Array<ValidationIssue> = [], options?: ErrorOptions) {
    super(message, issues, options)
    this.name = 'SystemOneInputError'
  }
}

export type SystemOneConnectionErrorOptions = ErrorOptions & {
  /** HTTP status of the response; absent when the backend could not be reached. */
  status?: number
}

/** The System One backend could not be reached, or returned an unmapped non-2xx status. */
export class SystemOneConnectionError extends SystemOneError {
  #status: number | undefined

  constructor(message: string, options: SystemOneConnectionErrorOptions = {}) {
    const { status, ...errorOptions } = options
    super(message, errorOptions)
    this.name = 'SystemOneConnectionError'
    this.#status = status
  }

  get status(): number | undefined {
    return this.#status
  }
}

export type SystemOneRetryableErrorOptions = SystemOneConnectionErrorOptions & {
  /** Delay the backend asked for in its `Retry-After` header, in milliseconds. */
  retryAfterMs?: number
}

class RetryableError extends SystemOneConnectionError {
  #retryAfterMs: number | undefined

  constructor(message: string, options: SystemOneRetryableErrorOptions = {}) {
    const { retryAfterMs, ...connectionOptions } = options
    super(message, connectionOptions)
    this.#retryAfterMs = retryAfterMs
  }

  get retryAfterMs(): number | undefined {
    return this.#retryAfterMs
  }
}

/** 429: the caller exceeded its rate limit. Retry after `retryAfterMs` when set. */
export class SystemOneRateLimitError extends RetryableError {
  constructor(message: string, options?: SystemOneRetryableErrorOptions) {
    super(message, options)
    this.name = 'SystemOneRateLimitError'
  }
}

/** 529: the backend is overloaded. Retry later, after `retryAfterMs` when set. */
export class SystemOneOverloadedError extends RetryableError {
  constructor(message: string, options?: SystemOneRetryableErrorOptions) {
    super(message, options)
    this.name = 'SystemOneOverloadedError'
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
