# Close the `x-mcp-header` story — pieces B and C

**Status:** next
**Origin:** `backlog/2026-06-20-mcp-draft-remaining.md`, §1 (piece B) and §3.2.4 (piece C).
**Milestone:** `milestones/2026-06-08-mcp-draft-migration.md`

Two small, independent items that together finish the SEP-2243 request-header work. The encoder
is conformant against a real decoder as of 2026-08-04, but nothing recovers from a stale schema
and nothing asserts `Mcp-Method` directly.

## B. Stale-schema retry on `-32020`

On a `-32020` `HeaderMismatch`, refresh the tool schema via `tools/list` and retry the
`tools/call` once. Self-contained in `@mokei/http-client`; the retry loop itself is unwritten.

Both blockers recorded against this item were corrected on 2026-08-04:

- SDK `2.0.0`'s server does emit `-32020` `HeaderMismatch` for an `Mcp-Param-*` disagreement
  (`core-internal/src/shared/mcpParamHeaders.ts`, `validateMcpParamHeaders`, HTTP `400`,
  offending pair in `data.mismatch`), reachable from the integration suite through
  `startSDK20260728HTTPServer`.
- The `-32001` / `SESSION_EXPIRED_CODE` collision was beside the point: the specification's code
  is `-32020`, which mokei already reserves as `HEADER_MISMATCH`.

`-32020` is the constant's only emitter, so this also closes half of §3.3.1.

**Acceptance:** a `tools/call` against a peer whose schema changed under the client succeeds on
the retry, driven by a real SDK peer rather than a stub.

## C. Direct `Mcp-Method` assertion

`Mcp-Method` is never asserted directly today, only implied by the SDK's inbound classifier
accepting the `2026-07-28` HTTP calls. Cheap to close where the omitted-argument case already
wraps `globalThis.fetch` in `integration-tests/suites/interop-sdk-server.test.ts`: the captured
`Headers` carries it.

**Acceptance:** the captured request headers assert `Mcp-Method` for a `tools/call`, a
`prompts/get` and a `resources/read`.

## Non-blocking polish, if these files are open anyway

- Cache collected `x-mcp-header` annotations alongside the schema in `#toolSchemas`
  (`http-client/src/transport.ts`) to skip the per-`tools/call` walk recompute.
- Clarify the `collectHeaderAnnotations` error message for the `$ref`-wrapper-plus-target
  duplicate edge; it currently reports "Duplicate", which misattributes the cause.
- Two `useLiteralKeys` Biome infos in `http-client/src/x-mcp-header.ts`.
