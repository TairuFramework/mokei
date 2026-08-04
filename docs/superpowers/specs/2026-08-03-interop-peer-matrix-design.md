# Interop peer matrix + request-header coverage — design

**Date:** 2026-08-03
**Origin:** `docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md` §3.2.1, §3.2.3, §3.2.4
**Milestone:** `docs/agents/plans/milestones/2026-06-08-mcp-draft-migration.md`
**Scope:** integration tests and their fixtures only. No protocol, transport or client/server
production change is planned; see [Red tests](#red-tests) for what happens if coverage turns one up.

## Problem

mokei's HTTP client encodes three request headers the specification's standard request headers
define — `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*`. mokei's HTTP server validates none of them:
there are zero references to any of those header names under `packages/http-server/src`. So the
encoder has only ever been exercised against a peer that ignores its output, and **any
client-side header-encoding bug is invisible to every mokei-against-mokei suite by construction**,
however many are added.

That is not hypothetical. It has already produced two defects, both found the day a real SDK peer
was pointed at the code rather than by any preceding mokei-against-mokei coverage:

- `Mcp-Name` was omitted entirely for `resources/read` (the header mirrors `params.name` for
  `tools/call` and `prompts/get` but `params.uri` there).
- `Mcp-Name` was written raw to a `Headers` object, so any non-Latin-1 resource URI threw a
  `ByteString` `TypeError` before the request left the process.

`Mcp-Param-*` is built by the same code and still has unit coverage only.

Separately, the cross-stack peer matrix is incomplete on `2026-07-28`. `checkMokeiClient`
(`integration-tests/support/interop/expectations.ts`) has four call sites. Two drive a real SDK
server at `2025-11-25` over the shared fixture; the other two drive mokei's own server. An SDK
`2026-07-28` HTTP peer already exists in the harness (`startSDK20260728HTTPServer`) but is checked
by bespoke inline assertions instead of the shared expectations, and the SDK-client-against-mokei
direction has no harness helper on that revision at all.

## What makes this newly tractable

SDK `2.0.0` implements the header rules on the server side. In
`@modelcontextprotocol/server`'s bundled `core-internal/src/shared/mcpParamHeaders.ts`:

- `validateMcpParamHeaders(declarations, args, headers)` walks every `x-mcp-header` declaration on
  the named tool's `inputSchema` and cross-checks it against the body `arguments`.
- It decodes the Base64 sentinel and rejects a payload that is not canonical Base64 or not valid
  UTF-8.
- Integer-typed declarations are compared numerically; everything else as decoded strings.
- A disagreement is rejected as `-32020` `HeaderMismatch`, HTTP `400`, with the offending pair in
  `data.mismatch`. The same classifier performs the standard `Mcp-Method` / `Mcp-Name`
  cross-checks.
- When the body value is `null` or absent the server MUST NOT expect the header, and a header
  present anyway is **ignored**.

So a conformant decoder exists, and it is reachable from the integration suite today.

This also invalidates two premises recorded against **G7 part 5** (the `-32020` refresh-and-retry)
in the backlog: "no server emits HeaderMismatch today" is false, and "`-32001` already means
`SESSION_EXPIRED_CODE`" is beside the point, since the specification's code is `-32020`, which
mokei already reserves as `HEADER_MISMATCH`. G7 part 5 stays out of this spec — it is production
code — but its blocker is gone and the backlog entry should be corrected to say so.

## Goals

1. Close the four-quadrant `2026-07-28` peer matrix (mokei client ↔ SDK server, SDK client ↔ mokei
   server, each over stdio and Streamable HTTP), driven by the shared expectations rather than
   bespoke assertions.
2. Put mokei's `Mcp-Param-*` encoder in front of the SDK's decoder, including the Base64 sentinel
   and integer paths.
3. Leave the matrix structurally enumerable, so a missing quadrant is visible in the code rather
   than discovered later by reading a backlog file.

## Non-goals

- `subscriptions/listen` coverage — belongs with B4.
- The `MissingRequiredClientCapability` (`-32021`) ladders. On `2026-07-28` a server sends no
  requests (`PROTOCOL.serverMethods` is empty), so no handler can need an undeclared client
  capability; the emitter arrives with MRTR (B7).
- Task-augmented params. SEP-2663 removed tasks from the specification and mokei never implemented
  them.
- G7 part 5's retry loop, and any change making mokei's server validate inbound request headers.
  Both are production work.

## Design

### Approach: parameterize the connection, not the assertions

The two direction files each gain a revision table and a `describe.each` over it. The table
carries only *how to connect* — stdio server path, HTTP server starter, client factory,
expectations options. Assertions that exist on one revision and not the other (`initialize()` on
`2025-11-25`, `discover()` and the `2026-07-28` `_meta` `serverInfo`) live in their own named tests
beside the shared block, never as table fields.

The alternative considered was fully version-blind bodies with the differences pushed into more
config fields. Rejected: the two revisions differ in what can be asserted at all, so a blind body
either drops those assertions or encodes them as configuration, which turns the table into a
second language. The other alternative — explicit per-revision blocks with no `.each` — keeps the
differences readable but stops the quadrants being enumerable, and non-enumerability is the exact
reason the missing quadrant went unnoticed.

### Layout

Today the organizing axis is inconsistent: `interop-sdk-{client,server}.test.ts` are per-direction
and `2025-11-25`-only, while the cross-stack HTTP block for `2026-07-28` sits inside a
revision-conformance file. After this change the axis is uniform:

| File | Holds |
|---|---|
| `interop-sdk-client.test.ts` | SDK client → mokei server, both revisions, stdio + HTTP |
| `interop-sdk-server.test.ts` | mokei client → SDK server, both revisions, stdio + HTTP, plus the header cases |
| `interop-2026-07-28-http.test.ts` | mokei ↔ mokei only |
| `interop-2026-07-28-stdio.test.ts` | mokei ↔ mokei, plus the SDK-zod-schema oracle over mokei's emitted shapes |

The SDK block currently in `interop-2026-07-28-http.test.ts` moves to `interop-sdk-server.test.ts`.

### Components

| Change | File | Detail |
|---|---|---|
| `headerEcho` tool | `support/interop/fixture.ts` | SDK fixture only. `inputSchema` declares `x-mcp-header` on one string property and one integer property, both optional. New `SDK_TOOL_NAMES` export beside `SDK_RESOURCE_URIS`. |
| `toolNames` option | `support/interop/expectations.ts` | On `checkMokeiClient`, mirroring the existing `resourceURIs` option; defaults to `['echo', 'sum']`. |
| `protocolVersion` option | `support/interop/expectations.ts` | On `checkSDKClient`. Drives `getNegotiatedProtocolVersion()`, and on `2026-07-28` a `getServerVersion()` sourced from the discover result's `_meta`. No `resourceURIs` / `toolNames`: both call sites serve the mokei fixture. |
| SDK stdio server, `2026-07-28`-only | `support/interop/sdk-stdio-server-2026-07-28.ts` | `serveStdio(factory, { legacy: 'reject' })`. |
| SDK client factories | `support/interop/servers.ts` | Stdio and HTTP. `versionNegotiation: { mode: { pin: '2026-07-28' } }` on the new revision, plain `new Client(info)` on `2025-11-25`. This direction has no helper today. |
| Revision tables | both `interop-sdk-*.test.ts` | Connect-only records, per the approach above. |

The `headerEcho` tool goes in the SDK fixture alone, following the documented precedent of the
non-ASCII resource: the annotated surface exists where a peer enforces it. mokei's own suites keep
asserting `['echo', 'sum']` unchanged. The alternative — adding it to both fixtures for symmetry —
would touch every tool-name assertion across the interop and `2026-07-28` conformance suites and
give mokei's server surface no mokei test needs.

### Why the single-revision servers

On the SDK-client rows, the mokei server is `MOKEI_STDIO_SERVER_2026_07_28_PATH`, not the
both-revisions server; on the mokei-client rows the SDK stdio server carries `legacy: 'reject'`.
Same reasoning in both directions, and it is already written into `startSDK20260728HTTPServer`:
against a both-revisions peer, a client that silently fell back to `2025-11-25` would pass every
assertion below while testing the wrong revision. A pin plus a single-revision server turns that
silent fallback into a connect failure.

### Header cases

Their own named tests, not part of `checkMokeiClient` — and **Streamable HTTP only**, since
request headers do not exist on stdio. `headerEcho` is still visible to the stdio rows through
`SDK_TOOL_NAMES` in the shared `listTools` assertion; it is only *called* from the HTTP block.

All three drive mokei's encoder into the SDK's decoder. `-32020` with `data.mismatch` is the
failure signal.

| Case | `headerEcho` argument | Proves |
|---|---|---|
| Plain token value | `tenant: "acme"` | Header emitted, name derived from the annotation, value equals the body value |
| Non-Latin-1 value | `tenant: "文書"` | The Base64 sentinel round-trips through a conformant decoder — one layer below the `Mcp-Name` defect's shape |
| Integer value | `limit: 42` | Numeric comparison on the SDK side; canonical decimal on mokei's |

Plus one absence case: calling `headerEcho` with the annotated argument omitted must emit no
`Mcp-Param-Tenant`. A stray header there is *ignored* by the SDK, so the peer cannot fail it —
this one is asserted on the outgoing request by wrapping `globalThis.fetch`, the technique the
`Mcp-Session-Id` tripwire in `interop-2026-07-28-http.test.ts` already uses. That patch is safe
only because vitest runs the tests within a file serially, and the existing comment saying so
applies verbatim.

### The omitted negative

§3.2.4 lists "negative `Mcp-Name` cases". Written the obvious way — a raw `fetch` carrying a
deliberately wrong `Mcp-Name`, asserting `-32020` back — that assertion tests the SDK, not mokei:
it passes identically if mokei's encoder is deleted, because the request never goes through it.
The mokei-side negative worth having is the absence case above, which is in scope. The wrong-header
test is deliberately not built, and this paragraph is the record of that decision rather than an
oversight.

## Expected failure modes

- **Discover `_meta` carries no `serverInfo`.** `getServerVersion()` returns `undefined` on
  `2026-07-28` unless the discover result's `_meta` carries it (a specification SHOULD).
  `PROTOCOL.wrapResult` stamps `io.modelcontextprotocol/serverInfo` on every result, so this is
  expected to pass; if it does not, it is a real conformance gap and a small one.
- **The SDK client's pin fails against mokei's stdio server.** The SDK probes with
  `server/discover` on a disposable sibling process for its stdio transport. A mokei stdio server
  that does not answer a probe on a fresh connection is a genuine defect, and unlikely to be small.
- **`Mcp-Param-*` mismatch.** The likeliest red of the three header cases. Diagnosis is direct
  from `data.mismatch`.
- **Flake surface.** Three new server startups — the `2026-07-28` SDK stdio server, and mokei's
  stdio and HTTP servers on the SDK-client rows for that revision. Every HTTP one goes through the
  existing `listening()` helper on port 0. No new timing surface.

### Red tests

A defect fixable inside this test-scoped change is fixed on the branch. A defect needing protocol
or transport surgery gets a backlog entry, and its test lands as `test.skip` carrying the entry's
path — so the branch merges green with the gap visible in code rather than only in a document.

## Verification

`pnpm build`, then package tests, the integration suites, and biome. The interop suites need no
model backend, so unlike the backend-gated suites they run unconditionally: a skip here means a
real failure, not a missing local server.

## Follow-ups this spec creates

- Correct the G7 part 5 entry in `docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md`:
  both recorded blockers are stale (see [What makes this newly tractable](#what-makes-this-newly-tractable)).
- Mark §3.2.3 closed and prune the §3.2.4 items this spec covers, leaving the three that belong to
  B4 and B7.
