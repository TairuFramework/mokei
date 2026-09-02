/**
 * A `tools/list` surface that answers across multiple pages, served by the official SDK v2 server,
 * to drive mokei's client-side cursor walk (`ContextClient.listTools`, `@mokei/context-client`'s
 * `#listPaged`) against a real paginating peer.
 *
 * The high-level `McpServer` returns its whole registered tool set in one page — it does not
 * server-side paginate a registry — so this fixture never calls `registerTool`. It overrides the
 * underlying low-level server's `tools/list` handler (`McpServer.server.setRequestHandler`) with
 * one that slices a fixed tool list into `PAGE_SIZE`-sized pages behind an opaque cursor. Going
 * through `McpServer` (rather than a bare low-level `Server`) keeps the SDK's era negotiation and
 * `serveStdio` compatibility, so the same fixture serves both `2025-11-25` and `2026-07-28`.
 *
 * The interop gap this closes: the SDK-peer matrix (`interop-sdk-client.test.ts` et al.) only ever
 * served single-page results, so mokei's multi-page walk — the exact path whose first-page
 * truncation was a real bug once (PR #36) — was never exercised against the SDK.
 */
import { McpServer } from '@modelcontextprotocol/server'

/** How many tools the fixture serves in total, across all pages. */
export const TOOL_COUNT = 5

/** Tools per page. `TOOL_COUNT = 5` over `PAGE_SIZE = 2` yields three pages: 2 + 2 + 1. */
export const PAGE_SIZE = 2

/** The tool name at a given index — `tool-0` … `tool-4`. */
export function toolName(index: number): string {
  return `tool-${index}`
}

/** Every tool name the walk must recover, in order. */
export const ALL_TOOL_NAMES: ReadonlyArray<string> = Array.from({ length: TOOL_COUNT }, (_, i) =>
  toolName(i),
)

const TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

/**
 * The opaque cursor for the page that starts at `start`. Base64 of the start index — opaque to the
 * client, which only ever echoes it back verbatim.
 */
function encodeCursor(start: number): string {
  return Buffer.from(String(start), 'utf8').toString('base64')
}

/** Inverse of {@link encodeCursor}; `undefined`/absent means the first page (start 0). */
function decodeCursor(cursor: string | undefined): number {
  if (cursor == null) {
    return 0
  }
  const start = Number.parseInt(Buffer.from(cursor, 'base64').toString('utf8'), 10)
  if (!Number.isInteger(start) || start < 0) {
    throw new Error(`Invalid pagination cursor: ${cursor}`)
  }
  return start
}

/**
 * The SDK v2 server for the pagination fixture. `paginate` defaults to `true`; a test can pass
 * `false` to serve every tool in a single page (no `nextCursor`) — the non-vacuity check that a
 * walk which stops after page one is actually caught.
 */
export function createSDKPaginationServer({
  paginate = true,
}: {
  paginate?: boolean
} = {}): McpServer {
  const server = new McpServer(
    { name: 'interop-pagination-fixture', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.server.setRequestHandler('tools/list', (request) => {
    if (!paginate) {
      return {
        tools: ALL_TOOL_NAMES.map((name) => ({ name, inputSchema: TOOL_INPUT_SCHEMA })),
      }
    }
    const start = decodeCursor(request.params?.cursor)
    const end = Math.min(start + PAGE_SIZE, TOOL_COUNT)
    const tools = ALL_TOOL_NAMES.slice(start, end).map((name) => ({
      name,
      inputSchema: TOOL_INPUT_SCHEMA,
    }))
    return end < TOOL_COUNT ? { tools, nextCursor: encodeCursor(end) } : { tools }
  })

  return server
}
