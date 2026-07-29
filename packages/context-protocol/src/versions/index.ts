import { PROTOCOL as PROTOCOL_2025_11_25 } from './2025-11-25.js'
import { PROTOCOL as PROTOCOL_2026_07_28 } from './2026-07-28.js'
import type { ProtocolDefinition, ProtocolVersion } from './types.js'

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
