import type {
  DiscoverResult,
  Implementation,
  ProtocolVersion,
  ServerCapabilities,
} from '@mokei/context-protocol'

export type DiscoverParams = {
  capabilities: ServerCapabilities
  protocolVersions: Array<ProtocolVersion>
  // Unused here — kept because it's part of the documented `DiscoverParams` interface.
  serverInfo: Implementation
  instructions?: string
}

/** Assembles the `server/discover` result body (`resultType` and `_meta` are added by `wrapResult`). */
export function buildDiscoverResult(
  params: DiscoverParams,
): Omit<DiscoverResult, 'resultType' | '_meta'> {
  return {
    capabilities: params.capabilities,
    supportedVersions: params.protocolVersions,
    ...(params.instructions == null ? {} : { instructions: params.instructions }),
  }
}
