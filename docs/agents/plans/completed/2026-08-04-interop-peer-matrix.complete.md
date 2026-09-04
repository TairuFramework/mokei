# Interop peer matrix + request-header coverage — complete

**Date:** 2026-08-04
**Branch:** `feat/interop-peer-matrix`
**Status:** complete
**Scope:** §3.2.1, §3.2.3 and part of §3.2.4 from
`docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md` — piece A of that file's six
independent sub-projects
**Milestone:** `docs/agents/plans/completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md`

## Goal

mokei's HTTP client encodes the three standard request headers the specification defines —
`Mcp-Method`, `Mcp-Name` and `Mcp-Param-*` (SEP-2243). mokei's HTTP server validates none of
them. So the encoder had only ever been exercised against a peer that ignores its output, and
**any client-side header-encoding bug was invisible to every mokei-against-mokei suite by
construction**, however many were added.

That was not hypothetical. It had already produced two defects, both found the day a real SDK
peer was first pointed at the code rather than by any preceding mokei-against-mokei coverage:
`Mcp-Name` omitted entirely for `resources/read` (the header mirrors `params.name` for
`tools/call` and `prompts/get` but `params.uri` there), and `Mcp-Name` written raw to a `Headers`
object, so any non-Latin-1 resource URI threw a `ByteString` `TypeError` before the request left
the process. `Mcp-Param-*` is built by the same code and still had unit coverage only.

Separately, the cross-stack peer matrix was incomplete on `2026-07-28`. An SDK `2026-07-28` HTTP
peer existed in the harness but was checked by bespoke inline assertions instead of the shared
expectations, and the SDK-client-against-mokei direction had no harness helper on that revision
at all.

## What made it tractable

SDK `2.0.0` implements the header rules on the server side, on its `2026-07-28` HTTP path. It
walks every `x-mcp-header` declaration on the named tool's `inputSchema` and cross-checks it
against the body `arguments`, decoding the `=?base64?…?=` sentinel and rejecting a payload that
is not canonical Base64 or not valid UTF-8. Integer-typed declarations are compared numerically;
everything else as decoded strings. A disagreement is rejected as `-32020` `HeaderMismatch`, HTTP
`400`, with the offending pair in `data.mismatch`. When the body value is `null` or absent the
server MUST NOT expect the header, and a header present anyway is ignored.

So a conformant decoder existed and was reachable from the integration suite.

## What was built

Tests and fixtures only — no production code changed, by design.

**Fixture.** A `headerEcho` tool in the SDK fixture, declaring `x-mcp-header` on one `string` and
one `integer` property, both optional. New `MOKEI_TOOL_NAMES` / `SDK_TOOL_NAMES` exports, and a
`toolNames` option on the shared `checkMokeiClient` mirroring its existing `resourceURIs`.

**The matrix.** Both direction files carry a revision table driven by `describe.each`. Eight
cross-stack rows now run where four did: mokei client ↔ SDK server and SDK client ↔ mokei server,
each over stdio and Streamable HTTP, on both `2025-11-25` and `2026-07-28`. A new
`2026-07-28`-only SDK stdio server (`serveStdio(factory, { legacy: 'reject' })`) and a
`protocolVersion` option on `checkSDKClient` supply the missing halves.

**Header coverage.** Four `Mcp-Param-*` cases drive mokei's encoder into the SDK's validator: a
plain token value, a non-Latin-1 value exercising the Base64 sentinel, an integer value, and an
omitted-argument case. Streamable HTTP only — request headers do not exist on stdio.

**Backlog reconciliation.** §3.2.3 closed, §3.2.4 pruned, and G7 part 5's two recorded blockers
corrected (see Design decisions below).

## Design decisions

**Parameterize the connection, not the assertions.** The revision tables carry only *how to
connect* — server path, HTTP starter, client factory. Assertions that exist on one revision and
not the other (`initialize()` on `2025-11-25`, `discover()` and the `2026-07-28` `_meta`
`serverInfo`) live in their own named tests beside the shared block, never as table fields. The
two revisions differ in what can be asserted at all, so a version-blind body would either drop
those assertions or encode them as configuration, turning the table into a second language.

**Organize by direction, not by revision.** The axis was inconsistent: per-direction files that
were `2025-11-25`-only, plus a cross-stack block living inside a revision-conformance file. The
cross-stack block moved out, so the `interop-2026-07-28-*` files are mokei-against-mokei only and
every cross-stack row lives with its direction.

**Single-revision servers on the new rows.** On the SDK-client rows the mokei server serves
`2026-07-28` alone; on the mokei-client rows the SDK server carries `legacy: 'reject'`. Against a
both-revisions peer, a client that silently fell back to `2025-11-25` would pass every assertion
while testing the wrong revision. A pin plus a single-revision server turns that silent fallback
into a connect failure. The `2025-11-25` rows keep their both-revisions servers deliberately: a
client in the SDK's default negotiation mode cannot select the newer revision, so there is
nothing there for a single-revision server to catch.

**`headerEcho` on the SDK side only,** following the documented precedent of the non-ASCII
resource: the annotated surface exists where a peer enforces it. Adding it to both fixtures for
symmetry would have touched every tool-name assertion across the interop and conformance suites
and given mokei's server a surface no mokei test needs.

**The omitted negative, deliberately not built.** §3.2.4 listed "negative `Mcp-Name` cases".
Written the obvious way — a raw `fetch` carrying a deliberately wrong `Mcp-Name`, asserting
`-32020` back — that assertion tests the SDK, not mokei: it passes identically if mokei's encoder
is deleted, because the request never goes through it. The mokei-side negative worth having is
the absence case, which was built.

**The absence case is asserted on the wire.** When the body value is absent, a stray header is
*ignored* by the SDK, so the peer cannot fail it. That case wraps `globalThis.fetch` instead —
safe only because vitest runs the tests within a file serially — and asserts both that
`Mcp-Param-Tenant` is absent and that `Mcp-Param-Limit` is present, the second being what proves
the header machinery ran for that request at all.

**G7 part 5 is unblocked.** Its two recorded blockers were both stale: "no server emits
HeaderMismatch today" is false, and the `-32001` / `SESSION_EXPIRED_CODE` collision was beside
the point, since the specification's code is `-32020`, which mokei already reserves as
`HEADER_MISMATCH`. The retry loop itself remains unwritten — only the reasons for deferring it
changed.

## Status

No defect surfaced. Every new row passed, nothing was skipped, and nothing was filed. Both
failures the design anticipated on `2026-07-28` — a discover result carrying no `serverInfo`, and
the SDK's stdio pin failing against mokei's server — failed to reproduce, most likely because
`5914afa` ("close the MCP 2026-07-28 defect wave") is the base commit.

The green was checked for vacuity rather than accepted: the three positive header cases rest on
the SDK rejecting a body value whose declared header is *absent* (`param-header-missing`), which
it does — without that, all three would pass against an encoder emitting nothing.

`pnpm build`, `pnpm test` and biome all clean. Integration suites: 47 passed, 22 skipped, skips
confined to suites gated on a local model backend.

## What this now proves, and what it does not

**Proves.** mokei's `Mcp-Param-*` encoder is conformant against a real decoder on every encoding
path: header name derived from the annotation, value matching the body, Base64 sentinel decoding
back to the original UTF-8, integers written as canonical decimal, and no header emitted for an
omitted annotated argument. Secondarily, `getServerVersion()` on the SDK-client `2026-07-28` rows
is the first assertion that mokei's `server/discover` `_meta` carries `serverInfo` as a real SDK
client consumes it.

**Does not prove.** mokei's *server* still validates no inbound request header, so the
SDK-client → mokei-server quadrant exercises nothing header-related on either revision — the
matrix is closed for protocol behaviour, but the header asymmetry is one-directional by
construction. Stdio rows prove nothing about headers at all. `Mcp-Method` is never asserted
directly; it is only implied by the SDK's classifier accepting the `2026-07-28` HTTP calls.
`subscriptions/listen`, the `-32021` ladders and G7 part 5's retry loop remain uncovered, and the
backlog records each accurately.
