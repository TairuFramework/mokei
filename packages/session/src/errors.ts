/** Signals that a single tool call exceeded the configured per-tool timeout. */
export class ToolCallTimeoutError extends Error {
  readonly toolName: string
  readonly timeoutMs: number

  constructor(toolName: string, timeoutMs: number) {
    super(`tool "${toolName}" timed out after ${timeoutMs}ms`)
    this.name = 'ToolCallTimeoutError'
    this.toolName = toolName
    this.timeoutMs = timeoutMs
  }
}

/** Signals that the user cancelled the tool call while it was executing. */
export class ToolCallCancelledError extends Error {
  readonly toolName: string

  constructor(toolName: string) {
    super(`tool "${toolName}" cancelled by user`)
    this.name = 'ToolCallCancelledError'
    this.toolName = toolName
  }
}
