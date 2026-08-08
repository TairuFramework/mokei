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
  /** Request methods a client may send in this revision. */
  clientMethods: ReadonlySet<string>
  /**
   * Notification methods a client may send in this revision — the notification counterpart of
   * {@link ProtocolDefinition.clientMethods}, and kept separate from it so that gating requests
   * on the method table cannot accidentally admit a notification as a request.
   *
   * Must name exactly the members of this revision's `clientNotification` union: a name here
   * that the union rejects produces a frame the peer's own validator refuses, and a member of
   * the union missing here is refused locally though the peer would accept it. Guarded by a
   * test in `packages/context-protocol/test/versions.test.ts`.
   */
  clientNotifications: ReadonlySet<string>
  /** Methods a server may send in this revision. */
  serverMethods: ReadonlySet<string>
  /**
   * Methods this revision carries as requests embedded in an `input_required` result (MRTR,
   * SEP-2322), rather than as server-initiated requests.
   *
   * Disjoint from {@link ProtocolDefinition.serverMethods} by construction: a method is reachable
   * one way or the other, never both. `2025-11-25` sends all three as real requests and so carries
   * none here; `2026-07-28` sends no requests at all and so carries all three.
   */
  inputRequestMethods: ReadonlySet<string>
  /** Inbound-message validators, used by the server and client read loops. */
  clientMessage: Schema
  serverMessage: Schema
  /** Adds this revision's protocol `_meta` to an outgoing request's params. */
  decorateRequest: (params: unknown, context: ClientRequestContext) => unknown
  /**
   * Adds this revision's protocol `_meta` to an outgoing notification's params.
   *
   * Separate from `decorateRequest` and deliberately context-free: a notification is not a
   * request, so it carries only what a peer needs to route it to the right revision — never the
   * `clientInfo`/`clientCapabilities`/`logLevel` envelope, which describes a request.
   */
  decorateNotification: (params: unknown) => unknown
  /** Reads this revision's protocol `_meta` off an inbound request. */
  readRequestMeta: (request: Request) => RequestMetaInfo
  /** Adds this revision's result envelope to an outgoing result. */
  wrapResult: (
    result: Record<string, unknown>,
    context: ServerResultContext,
  ) => Record<string, unknown>
}

/**
 * The client capability each input-request method requires, independent of revision.
 *
 * Read by the client when deciding whether a handler is configurable, and by the server when
 * deciding whether an embedded request may be sent to this client (`-32021`). One table so the
 * two cannot disagree about what `sampling` means.
 */
export const INPUT_REQUEST_CAPABILITIES = {
  'sampling/createMessage': 'sampling',
  'elicitation/create': 'elicitation',
  'roots/list': 'roots',
} as const satisfies Record<string, keyof ClientCapabilities>
