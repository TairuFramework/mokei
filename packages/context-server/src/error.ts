import { type ErrorResponse, INTERNAL_ERROR, type RequestID } from '@mokei/context-protocol'

export class RPCError extends Error {
  #code: number
  #data?: Record<string, unknown>

  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message)
    this.#code = code
    this.#data = data
  }

  toResponse(id: string | number): ErrorResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: this.#code, message: this.message, data: this.#data },
    }
  }
}

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
