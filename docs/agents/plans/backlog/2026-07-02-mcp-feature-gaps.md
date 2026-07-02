# MCP 2025-11-25 feature gaps (SDK v2 comparison)

**Status:** backlog
**Origin:** SDK v2 evaluation, 2026-07-02. Comparing mokei's surface against the official
SDK v2 surfaced three spec features mokei types but does not implement. All verified by
grep on 2026-07-02 (zero hits in `context-client`/`context-server`/`host` src).

## 1. Client-side pagination walk (interop bug, highest priority)

`ContextClient.listTools` / `listPrompts` / `listResources` / `listResourceTemplates`
issue a single request and never follow `nextCursor`. Against a paginating server (SDK v2
clients get aggregate-walk with `listMaxPages` by default; SDK servers may paginate),
mokei silently sees **only the first page** — `ContextHost` tool aggregation and the
session layer then operate on a truncated tool set. Mokei's own server returns full lists,
which is why this never bit locally.

**Fix:** cursor-walk in the client list methods (aggregate until no `nextCursor`, with a
page cap à la SDK's `listMaxPages`), or expose a paged iterator. Interop test against an
SDK v2 server with >1 page (see `2026-07-02-mcp-sdk-v2-adoption.md` item 1).

## 2. Tool `outputSchema` + `structuredContent`

`context-protocol` has `outputSchema` on the tool schema, but `createTool` doesn't accept
one, the server never advertises it, and neither side produces/validates
`structuredContent` in `CallToolResult`. SDK v2 supports both (`registerTool`
`outputSchema`, structured results validated; SEP-2106 extends to non-object roots in
`2026-07-28`).

**Fix:** `createTool` optional `outputSchema` (advertised in `tools/list`), server
validates handler `structuredContent` against it; client validates received
`structuredContent` when the tool advertised a schema. Typing flows through `FromSchema`
like `inputSchema`.

## 3. `resources/subscribe` wiring

Protocol types exist (`subscribeRequest` / `unsubscribeRequest` /
`resourceUpdatedNotification` in `context-protocol/src/resource.ts`) but no client
methods, no server dispatch, no `resources.subscribe` capability declaration. Low
priority: the `2026-07-28` era replaces this surface with `subscriptions/listen` (B4 in
`2026-06-20-mcp-draft-remaining.md`) — but mokei keeps `2025-11-25` per the coexistence
decision, so legacy peers may expect it. Implement only if a real peer needs it, or fold
into the B4 work as the legacy-side branch.

**Incidental typo found (fix when touching the file):**
`context-protocol/src/resource.ts:312` — `export type UnsubscribeRequest =
FromSchema<typeof subscribeRequest>` references the wrong schema; should be
`unsubscribeRequest`.

## Non-gaps confirmed while comparing

- Tasks: removed from the spec (SEP-2663) — mokei's skip is correct.
- Server-side pagination (cursoring out own lists): spec-optional, full lists are
  conformant; only worth it if mokei servers ever host huge tool sets.
- Client response caching (SEP-2549 hints → cache store): mokei ships the server-side
  hints (G1); client-side consumption noted on the roadmap P3 "tool-result caching" line
  with SDK v2's `InMemoryResponseCacheStore` as design reference.
