/** Signals that a single tool call exceeded the configured per-tool timeout. */
export class ToolCallTimeoutError extends Error {
  #toolName: string
  #timeoutMs: number

  constructor(params: ToolCallTimeoutErrorParams) {
    super(`tool "${params.toolName}" timed out after ${params.timeoutMs}ms`, {
      cause: params.cause,
    })
    this.name = 'ToolCallTimeoutError'
    this.#toolName = params.toolName
    this.#timeoutMs = params.timeoutMs
  }

  get toolName(): string {
    return this.#toolName
  }

  get timeoutMs(): number {
    return this.#timeoutMs
  }
}
export type ToolCallTimeoutErrorParams = { toolName: string; timeoutMs: number; cause?: unknown }

/** Signals that the user cancelled the tool call while it was executing. */
export class ToolCallCancelledError extends Error {
  #toolName: string

  constructor(params: ToolCallCancelledErrorParams) {
    super(`tool "${params.toolName}" cancelled by user`, { cause: params.cause })
    this.name = 'ToolCallCancelledError'
    this.#toolName = params.toolName
  }

  get toolName(): string {
    return this.#toolName
  }
}
export type ToolCallCancelledErrorParams = { toolName: string; cause?: unknown }

/**
 * Signals that the model asked to call a tool that is not callable (unknown
 * name, disabled, or a malformed namespaced ID). The message lists the
 * available tools so the model can self-correct on the next iteration.
 */
export class UnknownToolError extends Error {
  #toolName: string
  #availableTools: Array<string>

  constructor(params: UnknownToolErrorParams) {
    const list =
      params.availableTools.length > 0 ? params.availableTools.join(', ') : '(none available)'
    super(`unknown tool "${params.toolName}". Available tools: ${list}`, { cause: params.cause })
    this.name = 'UnknownToolError'
    this.#toolName = params.toolName
    this.#availableTools = params.availableTools
  }

  get toolName(): string {
    return this.#toolName
  }

  get availableTools(): Array<string> {
    return this.#availableTools
  }
}
export type UnknownToolErrorParams = {
  toolName: string
  availableTools: Array<string>
  cause?: unknown
}
