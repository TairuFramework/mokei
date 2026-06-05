/** Signals that a single tool call exceeded the configured per-tool timeout. */
export class ToolCallTimeoutError extends Error {
  #toolName: string
  #timeoutMs: number

  constructor(toolName: string, timeoutMs: number) {
    super(`tool "${toolName}" timed out after ${timeoutMs}ms`)
    this.name = 'ToolCallTimeoutError'
    this.#toolName = toolName
    this.#timeoutMs = timeoutMs
  }

  get toolName(): string {
    return this.#toolName
  }

  get timeoutMs(): number {
    return this.#timeoutMs
  }
}

/** Signals that the user cancelled the tool call while it was executing. */
export class ToolCallCancelledError extends Error {
  #toolName: string

  constructor(toolName: string) {
    super(`tool "${toolName}" cancelled by user`)
    this.name = 'ToolCallCancelledError'
    this.#toolName = toolName
  }

  get toolName(): string {
    return this.#toolName
  }
}

/**
 * Signals that the model asked to call a tool that is not callable (unknown
 * name, disabled, or a malformed namespaced ID). The message lists the
 * available tools so the model can self-correct on the next iteration.
 */
export class UnknownToolError extends Error {
  #toolName: string
  #availableTools: Array<string>

  constructor(toolName: string, availableTools: Array<string>) {
    const list = availableTools.length > 0 ? availableTools.join(', ') : '(none available)'
    super(`unknown tool "${toolName}". Available tools: ${list}`)
    this.name = 'UnknownToolError'
    this.#toolName = toolName
    this.#availableTools = availableTools
  }

  get toolName(): string {
    return this.#toolName
  }

  get availableTools(): Array<string> {
    return this.#availableTools
  }
}
