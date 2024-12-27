import {
  type ErrorResponse,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
} from '@mokei/context-protocol'

export class RPCError extends Error {
  static fromResponse(response: ErrorResponse): RPCError {
    return new RPCError(response.error.code, response.error.message, response.error.data)
  }

  #code: number
  #data?: Record<string, unknown>

  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message)
    this.#code = code
    this.#data = data
  }

  get code(): number {
    return this.#code
  }

  get data(): Record<string, unknown> | undefined {
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
}
