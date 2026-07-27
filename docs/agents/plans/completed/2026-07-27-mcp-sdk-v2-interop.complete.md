# SDK v2 interop test harness (`integration-tests`) — complete

**Status:** complete
**Date:** 2026-07-27
**Branch / PR:** `feat/mcp-sdk-v2-interop` (not yet opened)
**Relates to:** `backlog/2026-07-02-mcp-sdk-v2-adoption.md` (adopt item 1) ·
`backlog/2026-06-20-mcp-draft-remaining.md` (G7 part 5 needs this peer) ·
`milestones/2026-06-08-mcp-draft-migration.md` (the draft-era half plugs in with B-wiring)

## Goal

Validate mokei's MCP implementation against the official TypeScript SDK v2
(`2.0.0-beta.5`) in both directions and on both transports, so conformance is proven
against a reference implementation rather than against mokei's own assumptions. Doubles
as the standing "live peer" the `2026-07-28` draft wiring validates against once it exists.

## What was built

- **`integration-tests/support/interop/fixture.ts`** — one MCP surface defined twice, with
  mokei's `createTool`/`createPrompt`/resource definitions and with the SDK's
  `registerTool`/`registerPrompt`/`registerResource`. Tools `echo` (text content) and `sum`
  (`outputSchema` + `structuredContent`), prompt `greet` (argument schema), resource
  `test://greeting`.
- **`support/interop/servers.ts`** — stdio entry-point paths plus HTTP starters on ephemeral
  ports: `serveHTTP` for the mokei side, a `node:http` server driving
  `NodeStreamableHTTPServerTransport` for the SDK side.
- **`support/interop/{mokei,sdk}-stdio-server.ts`** — the two stdio entry points
  (`serveProcess` / SDK `serveStdio`).
- **`support/interop/expectations.ts`** — the shared assertion set, run once per client
  stack: negotiated protocol version equals `LATEST_PROTOCOL_VERSION`, `serverInfo`,
  `tools/list` including `outputSchema`, `tools/call` text content and `structuredContent`,
  `prompts/list` + `prompts/get`, `resources/list` + `resources/read`.
- **`suites/interop-sdk-server.test.ts`** (mokei client → SDK server) and
  **`suites/interop-sdk-client.test.ts`** (SDK client → mokei server), each covering stdio
  and Streamable HTTP — four combinations total.

## Key design decisions

- **JSON Schema on both sides, no Zod in the tests.** The SDK's schema slots take
  `StandardSchemaWithJSON`, so the fixture feeds the *same* JSON Schema objects mokei uses
  through `fromJsonSchema(schema, new AjvJsonSchemaValidator())`. Keeps the stack rule
  (`@sozai/schema` over Zod) intact and makes both definitions literally share their schemas,
  so a divergence in behaviour cannot be blamed on divergent schemas.
- **One fixture, one expectation set.** Both stacks serve an identical surface and both
  clients assert identical payloads; any difference in the wire behaviour of the two
  implementations shows up as a test failure rather than as differing test code.
- **Stdio fixtures are `.ts` executed directly by `node`** (native type stripping, Node ≥23.6;
  the repo runs 26). Avoids a build step for `integration-tests`, which is `noEmit`. Cost:
  `allowImportingTsExtensions: true` in `integration-tests/tsconfig.json` and `.ts` import
  specifiers inside `support/interop/` — `node` resolves the on-disk path and does not
  rewrite a `.js` specifier back to `.ts`.
- **The SDK HTTP server runs stateless** (`sessionIdGenerator: undefined`, a fresh
  `McpServer` per POST) — the simplest legal configuration. Consequence: mokei's client-side
  session handling is not exercised from this direction; the mokei HTTP server is exercised
  with its own default session behaviour by the SDK client.
- **SDK packages are devDependencies of the private `mokei-integration-tests` package**, pinned
  at `2.0.0-beta.5`. Root `pnpm test` runs only `packages/**` + `mcp-servers/**`, so the beta
  SDK never enters the published dependency graph or the default test run.

## Status / verification

Four tests, all passing (`vitest run`, ~0.8s); `tsc --noEmit` and `biome check` clean. The
assertions were sanity-checked by deliberately flipping an expected value and confirming the
tests fail on it, then reverting — they are not vacuous.

Note: this work was executed directly from the backlog item, without an intermediate
spec/plan pair, so there is no ephemeral design document behind this summary.

## Follow-on work

Recorded in `backlog/2026-07-02-mcp-sdk-v2-adoption.md` (item 1): multi-page cursor-walk
interop (needs a paginating fixture — the client-side cursor walk shipped in the
`2026-07-11-mcp-feature-gaps` work is currently only covered by unit tests),
`resources/subscribe` once the legacy branch of B4 exists, and the modern-era
(`2026-07-28`) half of the harness once the B-wiring lands.
