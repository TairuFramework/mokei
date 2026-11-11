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
  #code = SESSION_EXPIRED_CODE

  constructor(params: SessionExpiredErrorParams = {}) {
    super(SESSION_EXPIRED_MESSAGE, { cause: params.cause })
    this.name = 'SessionExpiredError'
  }

  get code(): number {
    return this.#code
  }
}
export type SessionExpiredErrorParams = { cause?: unknown }

/** True when a JSON-RPC error code marks an expired/gone MCP session. */
export function isSessionExpiredCode(code: unknown): boolean {
  return code === SESSION_EXPIRED_CODE
}

/** Thrown by a fetch middleware when a request needs a sign-in it may not start. */
export class AuthRequiredError extends Error {
  constructor(message = 'Authorization required', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AuthRequiredError'
  }
}

/**
 * Raised by the raw fetch when the network call to the MCP URL itself fails: no response, not
 * an abort, not a timeout. Requests a middleware makes elsewhere (an OAuth server) never raise it.
 */
export class NetworkError extends Error {
  #url: string

  constructor(url: string, options?: { cause?: unknown }) {
    super(
      `Network request to ${url} failed${options?.cause instanceof Error ? `: ${options.cause.message}` : ''}`,
      options,
    )
    this.name = 'NetworkError'
    this.#url = url
  }

  get url(): string {
    return this.#url
  }
}
