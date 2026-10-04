export type FlowControlErrorCode =
  | 'FLOW_UNAVAILABLE'
  | 'FLOW_INVALID'
  | 'FLOW_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'INBOX_ITEM_NOT_FOUND'
  | 'INBOX_ANSWER_INVALID'
  | 'PROMPT_UNSUPPORTED'
  | 'PROMPT_IN_PROGRESS'
  | 'INTERNAL_ERROR'
  | 'DISCONNECTED'

export type FlowControlErrorParams = {
  code: FlowControlErrorCode
  message: string
  data?: Record<string, unknown>
  cause?: unknown
}

export class FlowControlError extends Error {
  #code: FlowControlErrorCode
  #data?: Record<string, unknown>

  constructor(params: FlowControlErrorParams) {
    super(params.message, params.cause === undefined ? undefined : { cause: params.cause })
    this.name = 'FlowControlError'
    this.#code = params.code
    this.#data = params.data
  }

  get code(): FlowControlErrorCode {
    return this.#code
  }

  get data(): Record<string, unknown> | undefined {
    return this.#data
  }
}

export function isFlowControlError(
  error: unknown,
  code?: FlowControlErrorCode,
): error is FlowControlError {
  return error instanceof FlowControlError && (code === undefined || error.code === code)
}
