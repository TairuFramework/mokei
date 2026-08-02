import type { DiscoverResult, ProtocolVersion, ServerCapabilities } from '@mokei/context-protocol'

export type DiscoverParams = {
  capabilities: ServerCapabilities
  protocolVersions: Array<ProtocolVersion>
  /**
   * Part of the spec's `DiscoverResult`, so it is carried through even though no `ServerConfig`
   * field feeds it yet. Not dead: it is the only way a server can describe itself in prose.
   */
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
