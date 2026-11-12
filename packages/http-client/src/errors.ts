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

const REDACTED_URL = '<redacted-url>'

/** The origin of an http(s)/ws(s) URL, else a fixed placeholder. Never the path or query. */
function redactURL(url: string): string {
  try {
    const { origin } = new URL(url)
    return origin === 'null' ? REDACTED_URL : origin
  } catch {
    return REDACTED_URL
  }
}

// Schemes that can carry a path or payload. A known list keeps text like `connect failed: x` or
// `127.0.0.1:8080` readable; the `//` is not required (`https:host/path`, `https:/host/path`).
const URL_TOKEN =
  /\b(?:https?|wss?|ftps?|file|data|blob|javascript|mailto|about|ssh|git|sftp|tel|urn):\S+/gi

/** Replaces every URL in a message with its origin: paths and queries can carry credentials. */
function redactURLs(message: string): string {
  // Everything up to whitespace belongs to the URL: apostrophes, quotes and brackets are valid
  // in a path or query, so no character is trusted as a boundary.
  return message.replace(URL_TOKEN, redactURL)
}

const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
  'AggregateError',
  'AbortError',
  'TimeoutError',
  'NetworkError',
  'NotAllowedError',
  'NotFoundError',
  'InvalidStateError',
  'SecurityError',
  'DataCloneError',
  'RequestTimeoutError',
  'SessionExpiredError',
  'AuthRequiredError',
])

/**
 * A copy of `cause` safe to keep: allowlisted name, redacted message, a stack that is only the
 * header, and no nested cause. The raw error can hold the full URL in its name, message, stack or
 * cause chain.
 */
function sanitizeCause(cause: unknown): unknown {
  if (!(cause instanceof Error))
    return cause == null ? undefined : new Error(redactURLs(String(cause)))
  const copy = new Error(redactURLs(cause.message))
  copy.name = SAFE_ERROR_NAMES.has(cause.name) ? cause.name : 'Error'
  copy.stack = redactURLs(`${copy.name}: ${copy.message}`)
  return copy
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
      { cause: sanitizeCause(cause) },
    )
    this.name = 'NetworkError'
    this.#url = url
  }

  get url(): string {
    return this.#url
  }
}
export type NetworkErrorParams = { url: string; cause?: unknown }
