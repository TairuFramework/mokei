import {
  type ClientMessage as ClientMessage20251125,
  type ClientNotification as ClientNotification20251125,
  type ClientRequest as ClientRequest20251125,
  clientMessage,
  PROTOCOL as PROTOCOL_2025_11_25,
} from './2025-11-25.js'
import {
  type ClientMessage as ClientMessage20260728,
  type ClientNotification as ClientNotification20260728,
  type ClientRequest as ClientRequest20260728,
  type DiscoverRequest,
  type DiscoverResult,
  discoverResult,
  type InputRequest,
  type InputRequiredResult,
  type InputResponse,
  inputRequest,
  inputRequests,
  inputResponse,
  inputResponses,
  isInputRequiredResult,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  PROTOCOL as PROTOCOL_2026_07_28,
} from './2026-07-28.js'
import type { ProtocolDefinition, ProtocolVersion } from './types.js'

/** Any request a client speaking any supported revision may send. */
export type ClientRequest = ClientRequest20251125 | ClientRequest20260728
/** Any notification a client speaking any supported revision may send. */
export type ClientNotification = ClientNotification20251125 | ClientNotification20260728
/** Any message a client speaking any supported revision may send. */
export type ClientMessage = ClientMessage20251125 | ClientMessage20260728

export type { DiscoverRequest, DiscoverResult, InputRequest, InputRequiredResult, InputResponse }
// `clientMessage` (the schema value, as opposed to the `ClientMessage` type above) is
// `2025-11-25`'s own schema — it predates the version split and nothing besides that revision's
// own `PROTOCOL.clientMessage` currently consumes it as a value. Multi-revision wire validation
// goes through `PROTOCOLS[version].clientMessage` instead; this is kept only for existing
// callers of the value export.
export {
  clientMessage,
  discoverResult,
  inputRequest,
  inputRequests,
  inputResponse,
  inputResponses,
  isInputRequiredResult,
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
}

/** Supported revisions, newest first. */
export const PROTOCOL_VERSIONS = [
  '2026-07-28',
  '2025-11-25',
] as const satisfies ReadonlyArray<ProtocolVersion>

export function isSupportedProtocolVersion(version: string): version is ProtocolVersion {
  return (PROTOCOL_VERSIONS as ReadonlyArray<string>).includes(version)
}

/**
 * Whether a revision requires the `initialize`/`initialized` handshake before other traffic.
 * Derived from `clientMethods`; replaces the former `ProtocolDefinition.requiresHandshake` field.
 */
export function isHandshakeRequired(protocol: ProtocolDefinition): boolean {
  return protocol.clientMethods.has('initialize')
}

/**
 * Whether log level is scoped per request (read from each request's `_meta`) rather than set
 * session-wide via `logging/setLevel`. Derived from `clientMethods`; replaces the former
 * `ProtocolDefinition.requiresPerRequestLogLevel` field.
 *
 * This derivation relies on an invariant that any future revision must satisfy: a revision omits
 * `logging/setLevel` from `clientMethods` only when it scopes log level per request. A revision
 * that dropped `logging/setLevel` for some other reason -- e.g. because it removed logging
 * support entirely -- would be misread by this helper as using per-request log levels, so adding
 * such a revision must revisit this function rather than rely on the derivation as-is.
 */
export function isPerRequestLogLevel(protocol: ProtocolDefinition): boolean {
  return !protocol.clientMethods.has('logging/setLevel')
}

export const PROTOCOLS: Record<ProtocolVersion, ProtocolDefinition> = {
  '2025-11-25': PROTOCOL_2025_11_25,
  '2026-07-28': PROTOCOL_2026_07_28,
}

export type {
  ClientRequestContext,
  ProtocolDefinition,
  ProtocolVersion,
  RequestMetaInfo,
  ServerResultContext,
} from './types.js'
export { INPUT_REQUEST_CAPABILITIES } from './types.js'
