/**
 * mokei's client-side cursor walk (`ContextClient.listTools`, `@mokei/context-client`'s
 * `#listPaged`) drained against a real multi-page `tools/list` served by the official SDK v2
 * server, on both revisions.
 *
 * The SDK-peer interop matrix (`interop-sdk-client.test.ts` et al.) only ever served single-page
 * results, so the walk that spans pages — the exact path whose first-page truncation was a real bug
 * once (PR #36) — was never exercised against the SDK. The fixture serves `TOOL_COUNT` tools over
 * `PAGE_SIZE`-sized pages; a client that stopped after page one would return only the first
 * `PAGE_SIZE`, so the full-set assertion is non-vacuous. The walk itself is revision-agnostic, but
 * both revisions are covered because the negotiation and wire codec around it are not.
 */
import type { ContextClient } from '@mokei/context-client'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { afterEach, describe, expect, test } from 'vitest'

import { ALL_TOOL_NAMES } from '../support/interop/pagination-fixture.ts'
import {
  SDK_STDIO_SERVER_PAGINATION_PATH,
  spawnMokeiStdioClient,
} from '../support/interop/servers.ts'

describe('tools/list pagination interop against the SDK v2 server', () => {
  let disposeClient: (() => Promise<void>) | null = null

  afterEach(async () => {
    if (disposeClient != null) {
      await disposeClient()
      disposeClient = null
    }
  })

  for (const protocolVersion of ['2025-11-25', '2026-07-28'] satisfies Array<ProtocolVersion>) {
    test(`walks every page on ${protocolVersion}`, async () => {
      const spawned = await spawnMokeiStdioClient(SDK_STDIO_SERVER_PAGINATION_PATH, protocolVersion)
      disposeClient = spawned.dispose
      const client: ContextClient = spawned.client

      const result = await client.listTools()

      expect(result.tools.map((tool) => tool.name)).toEqual(ALL_TOOL_NAMES)
      expect(result.nextCursor).toBeUndefined()
    })
  }
})
