import type { ProtocolDefinition, ProtocolVersion } from './types.js'

/** Supported revisions, newest first. */
export const PROTOCOL_VERSIONS = [
  '2026-07-28',
  '2025-11-25',
] as const satisfies ReadonlyArray<ProtocolVersion>

export function isSupportedProtocolVersion(version: string): version is ProtocolVersion {
  return (PROTOCOL_VERSIONS as ReadonlyArray<string>).includes(version)
}

// PROTOCOLS is populated in Task 3, once both version files exist.
export const PROTOCOLS = {} as Record<ProtocolVersion, ProtocolDefinition>

export type {
  ClientRequestContext,
  ProtocolDefinition,
  ProtocolVersion,
  RequestMetaInfo,
  ServerResultContext,
} from './types.js'
