/** Official SDK v2 client ↔ mokei server, over stdio and Streamable HTTP, on both revisions. */
import { type Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import type { ProtocolVersion } from '@mokei/context-protocol'
import { afterEach, describe, test } from 'vitest'

import { checkSDKClient } from '../support/interop/expectations.ts'
import {
  createSDKClient,
  MOKEI_STDIO_SERVER_2026_07_28_PATH,
  MOKEI_STDIO_SERVER_PATH,
  type RunningHTTPServer,
  startMokeiHTTPServer,
} from '../support/interop/servers.ts'

/**
 * One row per protocol revision, carrying only *how to connect*. Assertions that exist on one
 * revision and not the other stay out of it — the shared body below is identical for both, and
 * the revision-specific part of it is `checkSDKClient`'s own `protocolVersion` option.
 */
type MokeiServerRow = {
  protocolVersion: ProtocolVersion
  stdioServerPath: string
  startHTTPServer: () => Promise<RunningHTTPServer>
}

const ROWS: ReadonlyArray<MokeiServerRow> = [
  {
    protocolVersion: '2025-11-25',
    // The both-revisions servers, deliberately: an SDK client in its default `'legacy'` mode
    // cannot select `2026-07-28` at all, so there is nothing here for a single-revision server
    // to catch, and a dual-revision peer is the more realistic one.
    stdioServerPath: MOKEI_STDIO_SERVER_PATH,
    startHTTPServer: () => startMokeiHTTPServer(),
  },
  {
    protocolVersion: '2026-07-28',
    // Single-revision, matching the reasoning already written into `startSDK20260728HTTPServer`:
    // against a both-revisions peer, a client that silently fell back to `2025-11-25` would pass
    // every assertion below while testing the wrong revision. A pin plus a single-revision server
    // turns that silent fallback into a connect failure.
    stdioServerPath: MOKEI_STDIO_SERVER_2026_07_28_PATH,
    startHTTPServer: () => startMokeiHTTPServer(['2026-07-28']),
  },
]

describe.each(ROWS)('SDK v2 client against the mokei server on $protocolVersion', (row) => {
  let httpServer: RunningHTTPServer | null = null
  let client: Client | null = null

  afterEach(async () => {
    if (client != null) {
      await client.close()
      client = null
    }
    if (httpServer != null) {
      await httpServer.dispose()
      httpServer = null
    }
  })

  test('over stdio', async () => {
    client = createSDKClient(row.protocolVersion)
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [row.stdioServerPath] }),
    )
    await checkSDKClient(client, { protocolVersion: row.protocolVersion })
  })

  test('over Streamable HTTP', async () => {
    httpServer = await row.startHTTPServer()
    client = createSDKClient(row.protocolVersion)
    await client.connect(new StreamableHTTPClientTransport(new URL(httpServer.url)))
    await checkSDKClient(client, { protocolVersion: row.protocolVersion })
  })
})
