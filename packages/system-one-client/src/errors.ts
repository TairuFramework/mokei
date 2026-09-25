export type ValidationIssue = {
  message: string
  path?: ReadonlyArray<unknown>
}

export class SystemOneError extends Error {
  constructor(params: SystemOneErrorParams) {
    super(params.message, { cause: params.cause })
    this.name = 'SystemOneError'
  }
}
export type SystemOneErrorParams = { message: string; cause?: unknown }

class ValidationError extends SystemOneError {
  #issues: Array<ValidationIssue>

  constructor(params: ValidationErrorParams) {
    super(params)
    this.#issues = params.issues
  }

  get issues(): Array<ValidationIssue> {
    return this.#issues
  }
}
type ValidationErrorParams = SystemOneErrorParams & { issues: Array<ValidationIssue> }

/**
 * Caller-supplied questions or state failed validation: in the client before any request, or in
 * the backend (a 422 response).
 */
export class SystemOneInputError extends ValidationError {
  constructor(params: SystemOneInputErrorParams) {
    super({ ...params, issues: params.issues ?? [] })
    this.name = 'SystemOneInputError'
  }
}
export type SystemOneInputErrorParams = SystemOneErrorParams & { issues?: Array<ValidationIssue> }

export type SystemOneConnectionErrorParams = SystemOneErrorParams & {
  /** HTTP status of the response; absent when the backend could not be reached. */
  status?: number
}

/** The System One backend could not be reached, or returned an unmapped non-2xx status. */
export class SystemOneConnectionError extends SystemOneError {
  #status: number | undefined

  constructor(params: SystemOneConnectionErrorParams) {
    super(params)
    this.name = 'SystemOneConnectionError'
    this.#status = params.status
  }

  get status(): number | undefined {
    return this.#status
  }
}
export type SystemOneRetryableErrorParams = SystemOneConnectionErrorParams & {
  /** Delay the backend asked for in its `Retry-After` header, in milliseconds. */
  retryAfterMs?: number
}

class RetryableError extends SystemOneConnectionError {
  #retryAfterMs: number | undefined

  constructor(params: SystemOneRetryableErrorParams) {
    super(params)
    this.#retryAfterMs = params.retryAfterMs
  }

  get retryAfterMs(): number | undefined {
    return this.#retryAfterMs
  }
}
/** 429: the caller exceeded its rate limit. Retry after `retryAfterMs` when set. */
export class SystemOneRateLimitError extends RetryableError {
  constructor(params: SystemOneRateLimitErrorParams) {
    super(params)
    this.name = 'SystemOneRateLimitError'
  }
}
export type SystemOneRateLimitErrorParams = SystemOneRetryableErrorParams

/** 529: the backend is overloaded. Retry later, after `retryAfterMs` when set. */
export class SystemOneOverloadedError extends RetryableError {
  constructor(params: SystemOneOverloadedErrorParams) {
    super(params)
    this.name = 'SystemOneOverloadedError'
  }
}
export type SystemOneOverloadedErrorParams = SystemOneRetryableErrorParams

/** 401 or 403: a missing or rejected Bearer key. */
export class SystemOneAuthError extends SystemOneError {
  constructor(params: SystemOneAuthErrorParams) {
    super(params)
    this.name = 'SystemOneAuthError'
  }
}
export type SystemOneAuthErrorParams = SystemOneErrorParams

/** The System One backend response was malformed or failed schema validation. */
export class SystemOneResponseError extends ValidationError {
  constructor(params: SystemOneResponseErrorParams) {
    super({ ...params, issues: params.issues ?? [] })
    this.name = 'SystemOneResponseError'
  }
}
export type SystemOneResponseErrorParams = SystemOneInputErrorParams

/** 404, or an unknown or unavailable model. */
export class SystemOneModelError extends SystemOneError {
  constructor(params: SystemOneModelErrorParams) {
    super(params)
    this.name = 'SystemOneModelError'
  }
}
export type SystemOneModelErrorParams = SystemOneErrorParams
