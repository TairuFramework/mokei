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
  constructor(params: AuthRequiredErrorParams = {}) {
    super(params.message ?? 'Authorization required', { cause: params.cause })
    this.name = 'AuthRequiredError'
  }
}
export type AuthRequiredErrorParams = { message?: string; cause?: unknown }

/** The origin of a URL, or a placeholder when it does not parse. Never the path or query. */
function redactURL(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return '<url>'
  }
}

/** Replaces every URL in a message with its origin: paths and queries can carry credentials. */
function redactURLs(message: string): string {
  return message.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, redactURL)
}

/**
 * Raised by the raw fetch when the network call to the MCP URL itself fails: no response, not
 * an abort, not a timeout. Requests a middleware makes elsewhere (an OAuth server) never raise it.
 *
 * The message carries the origin only: MCP URLs can hold credentials in the path or query, and
 * the message reaches JSON-RPC errors, tool results, spans and logs. The full `url` stays a
 * getter (not enumerable) for code that needs it.
 */
export class NetworkError extends Error {
  #url: string

  constructor(params: NetworkErrorParams) {
    const { url, cause } = params
    super(
      `Network request to ${redactURL(url)} failed${cause instanceof Error ? `: ${redactURLs(cause.message)}` : ''}`,
      { cause },
    )
    this.name = 'NetworkError'
    this.#url = url
  }

  get url(): string {
    return this.#url
  }
}
export type NetworkErrorParams = { url: string; cause?: unknown }
