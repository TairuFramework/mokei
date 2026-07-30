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

export type { DiscoverRequest, DiscoverResult }
// `clientMessage` (the schema value, as opposed to the `ClientMessage` type above) is
// `2025-11-25`'s own schema — it predates the version split and nothing besides that revision's
// own `PROTOCOL.clientMessage` currently consumes it as a value. Multi-revision wire validation
// goes through `PROTOCOLS[version].clientMessage` instead; this is kept only for existing
// callers of the value export.
export { clientMessage, META_CLIENT_CAPABILITIES, META_PROTOCOL_VERSION }

/** Supported revisions, newest first. */
export const PROTOCOL_VERSIONS = [
  '2026-07-28',
  '2025-11-25',
] as const satisfies ReadonlyArray<ProtocolVersion>

export function isSupportedProtocolVersion(version: string): version is ProtocolVersion {
  return (PROTOCOL_VERSIONS as ReadonlyArray<string>).includes(version)
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
