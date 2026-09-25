import {
  type ErrorResponse,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  type RequestID,
  type Response,
} from '@mokei/context-protocol'

/**
 * Checks a response carries a well-formed JSON-RPC error object, so a peer sending
 * `error: null` or an error missing its `code`/`message` is not read as one.
 */
export function isErrorResponse(response: Response): response is ErrorResponse {
  if (!('error' in response)) {
    return false
  }
  const error = response.error as Record<string, unknown> | null | undefined
  return (
    typeof error === 'object' &&
    error != null &&
    typeof error.code === 'number' &&
    typeof error.message === 'string'
  )
}

export class RPCError extends Error {
  static fromResponse(response: ErrorResponse): RPCError {
    return new RPCError({
      code: response.error.code,
      message: response.error.message,
      data: response.error.data,
    })
  }

  #code: number
  // `unknown`, not `Record<string, unknown>`: JSON-RPC says only that `error.data` is "defined
  // by the Server", so a peer may put a string, a number, an array or `null` there. Narrowing it
  // here would have made this class unable to carry what the wire schema now admits.
  #data?: unknown

  constructor(params: RPCErrorParams) {
    super(params.message, { cause: params.cause })
    this.#code = params.code
    this.#data = params.data
  }

  get code(): number {
    return this.#code
  }

  get data(): unknown {
    return this.#data
  }

  get isInternal(): boolean {
    return this.code === INTERNAL_ERROR
  }

  get isInvalidParams(): boolean {
    return this.code === INVALID_PARAMS
  }

  get isInvalidRequest(): boolean {
    return this.code === INVALID_REQUEST
  }

  get isMethodNotFound(): boolean {
    return this.code === METHOD_NOT_FOUND
  }

  toResponse(id: RequestID): ErrorResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: this.#code, message: this.message, data: this.#data },
    }
  }
}

export type RPCErrorParams = { code: number; message: string; data?: unknown; cause?: unknown }

export function errorResponse(id: RequestID, cause: unknown): ErrorResponse {
  if (cause instanceof RPCError) {
    return cause.toResponse(id)
  }

  const message =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'Unknown error'
  return {
    jsonrpc: '2.0',
    id,
    error: { code: INTERNAL_ERROR, message },
  }
}

export class TransportClosedError extends Error {
  constructor(params: TransportClosedErrorParams = {}) {
    super(params.message ?? 'Transport closed', { cause: params.cause })
    this.name = 'TransportClosedError'
  }
}

export type TransportClosedErrorParams = { message?: string; cause?: unknown }

export class RequestTimeoutError extends Error {
  constructor(params: RequestTimeoutErrorParams) {
    super(params.message, { cause: params.cause })
    this.name = 'RequestTimeoutError'
  }
}

export type RequestTimeoutErrorParams = { message: string; cause?: unknown }
