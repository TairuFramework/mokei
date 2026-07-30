import type { Schema } from '@sozai/schema'

import type { ClientCapabilities, Implementation } from '../initialize.js'
import type { LoggingLevel } from '../logging.js'
import type { Request } from '../rpc.js'

export type ProtocolVersion = '2025-11-25' | '2026-07-28'

/** What a client knows about itself when decorating an outgoing request. */
export type ClientRequestContext = {
  capabilities: ClientCapabilities
  clientInfo?: Implementation
  logLevel?: LoggingLevel
}

/** Protocol metadata a server reads off an inbound request. */
export type RequestMetaInfo = {
  protocolVersion?: string
  clientInfo?: Implementation
  clientCapabilities?: ClientCapabilities
  logLevel?: LoggingLevel
}

/** What a server knows about itself when wrapping an outgoing result. */
export type ServerResultContext = {
  serverInfo: Implementation
}

export type ProtocolDefinition = {
  version: ProtocolVersion
  /** True when the client must complete `initialize`/`initialized` before other traffic. */
  requiresHandshake: boolean
  /** True when every request must carry protocol version and client capabilities in `_meta`. */
  requiresRequestMeta: boolean
  /** True when `complete` results of cacheable methods must carry `ttlMs`/`cacheScope`. */
  requiresCacheHints: boolean
  /**
   * True when log level is scoped to the individual request — read via `readRequestMeta` off
   * each request's own `_meta` — rather than session-scoped through a standing
   * `logging/setLevel` call. Always mirrors whether `logging/setLevel` is absent from
   * `clientMethods`.
   */
  requiresPerRequestLogLevel: boolean
  /** Methods a client may send in this revision. */
  clientMethods: ReadonlySet<string>
  /** Methods a server may send in this revision. */
  serverMethods: ReadonlySet<string>
  /** Inbound-message validators, used by the server and client read loops. */
  clientMessage: Schema
  serverMessage: Schema
  /** Adds this revision's protocol `_meta` to an outgoing request's params. */
  decorateRequest: (params: unknown, context: ClientRequestContext) => unknown
  /** Reads this revision's protocol `_meta` off an inbound request. */
  readRequestMeta: (request: Request) => RequestMetaInfo
  /** Adds this revision's result envelope to an outgoing result. */
  wrapResult: (
    result: Record<string, unknown>,
    context: ServerResultContext,
  ) => Record<string, unknown>
}
