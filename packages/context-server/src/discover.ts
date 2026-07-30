import type {
  DiscoverResult,
  Implementation,
  ProtocolVersion,
  ServerCapabilities,
} from '@mokei/context-protocol'

export type DiscoverParams = {
  capabilities: ServerCapabilities
  protocolVersions: Array<ProtocolVersion>
  serverInfo: Implementation
  instructions?: string
}

/**
 * Assembles the `server/discover` result. `resultType` and the `serverInfo` `_meta` key are
 * added by the protocol record's `wrapResult`, so this returns the body only.
 */
export function buildDiscoverResult(
  params: DiscoverParams,
): Omit<DiscoverResult, 'resultType' | '_meta'> {
  return {
    capabilities: params.capabilities,
    supportedVersions: params.protocolVersions,
    ...(params.instructions == null ? {} : { instructions: params.instructions }),
  }
}
