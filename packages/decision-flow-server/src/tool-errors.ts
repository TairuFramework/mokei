export type ToolErrorCode =
  | 'tool_error'
  | 'tool_call_failed'
  | 'tool_rejected'
  | 'tool_invalid_args'
  | 'tool_invalid_output'
  | 'tool_unavailable'
  | 'tool_not_approved'
  | 'tool_task_failed'
  | 'tool_task_cancelled'

export class ToolNodeError extends Error {
  #code: ToolErrorCode
  #retryable: boolean

  constructor(code: ToolErrorCode, message: string, retryable = false, cause?: unknown) {
    super(message, { cause })
    this.name = 'ToolNodeError'
    this.#code = code
    this.#retryable = retryable
  }

  get code(): ToolErrorCode {
    return this.#code
  }

  get retryable(): boolean {
    return this.#retryable
  }
}
