/**
 * JSON-RPC error code carried by responses synthesized when the server reports
 * the session is gone (HTTP 404 with an active `Mcp-Session-Id`). Surfaced to the
 * originating request as a coded `RPCError` so the client layer can detect it and
 * start a new session via initialize.
 *
 * Uses the implementation-defined server-error range (-32000..-32099) reserved by
 * the JSON-RPC 2.0 spec.
 */
export const SESSION_EXPIRED_CODE = -32001

/** Human-readable message paired with {@link SESSION_EXPIRED_CODE}. */
export const SESSION_EXPIRED_MESSAGE = 'MCP session expired; re-initialize to start a new session'

/**
 * Raised when the server reports the session is gone (HTTP 404 with an active
 * Mcp-Session-Id). The client layer should start a new session via initialize.
 *
 * The transport surfaces this condition to the originating request as a JSON-RPC
 * error response carrying {@link SESSION_EXPIRED_CODE}; use
 * {@link isSessionExpiredCode} to detect it on a caught `RPCError`.
 */
export class SessionExpiredError extends Error {
  /** JSON-RPC error code, matching {@link SESSION_EXPIRED_CODE}. */
  readonly code = SESSION_EXPIRED_CODE

  constructor() {
    super(SESSION_EXPIRED_MESSAGE)
    this.name = 'SessionExpiredError'
  }
}

/** True when a JSON-RPC error code marks an expired/gone MCP session. */
export function isSessionExpiredCode(code: unknown): boolean {
  return code === SESSION_EXPIRED_CODE
}
