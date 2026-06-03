/** Thrown internally when a single tool call exceeds the per-tool timeout. */
export class ToolCallTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(toolName: string, timeoutMs: number) {
    super(`tool "${toolName}" timed out after ${timeoutMs}ms`)
    this.name = 'ToolCallTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/** Thrown internally when the user cancels the active tool call. */
export class ToolCallCancelledError extends Error {
  constructor(toolName: string) {
    super(`tool "${toolName}" cancelled by user`)
    this.name = 'ToolCallCancelledError'
  }
}
