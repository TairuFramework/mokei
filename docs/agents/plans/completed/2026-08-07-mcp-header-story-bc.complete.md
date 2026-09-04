# `x-mcp-header` stale-schema retry + direct `Mcp-Method` assertions — complete

**Date:** 2026-08-07
**Branch:** `mcp-header-story-bc`
**Status:** complete
**Scope:** §1 (G7 part 5) and the remainder of §3.2.4 from
`docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md` — pieces B and C of that file's six
independent sub-projects, following piece A
(`completed/2026-08-04-interop-peer-matrix.complete.md`)
**Milestone:** `docs/agents/plans/completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md`

## Goal

Piece A proved mokei's SEP-2243 request-header *encoder* conformant against a real decoder. Two
gaps remained on the client side.

**Nothing recovered from a stale schema.** The transport cached each tool's `inputSchema` from
`tools/list` and read its `x-mcp-header` annotations on every `tools/call`. When a peer's schema
changed under a connected client — a tool gaining an annotation — the client kept sending the
pre-change header set, the SDK's `validateMcpParamHeaders` answered `param-header-missing`
(HTTP 400, JSON-RPC `-32020` `HeaderMismatch`, offending pair in `data.mismatch`), and mokei
surfaced that to the caller and stopped. A `tools/list` would have fixed it; nothing issued one.

**`Mcp-Method` was never asserted directly against a real peer.** The unit suite asserted the
outgoing header, but the interop suite only implied it — the SDK's inbound classifier accepted
the calls, which it would not do if the header were wrong. That is a weaker claim than asserting
the header.

## What was built

**The retry**, entirely inside `@mokei/http-client`'s `HTTPTransport`, below the RPC layer, so a
recovered call looks like an ordinary successful `tools/call` to every caller. Hooked into the
existing non-OK HTTP branch after `parseJSONRPCError` recovers the carried error. `-32020` naming
an `Mcp-Param-*` header on a `tools/call` that is not itself a retry and whose exchange was not
cancelled triggers `#refreshToolAnnotations`, then `#retryAfterSchemaRefresh` re-sends once if the
refreshed annotations change the header set.

**The annotation cache.** `#toolSchemas: Map<string, unknown>` became
`#toolAnnotations: Map<string, Array<HeaderAnnotation>>`. `#handleIncoming` already walked every
listed tool's schema for its validity filter, so keeping that walk's output costs nothing there
and removes a per-`tools/call` recompute. Both write sites go through one
`#cacheToolAnnotations(tools)` helper.

**`collectHeaderAnnotations` `$ref` handling** — the duplicate-message fix, which grew into the
type-deferral work described below.

**Interop coverage.** `createSDKServer` takes a `headerEchoSchema` getter (the `createMcpHandler`
factory runs per request, so a schema that changes mid-connection needs only mutable state the
factory reads — no `RegisteredTool.update()`), `HEADER_ECHO_UNANNOTATED_SCHEMA` joins the fixture,
and a `captureFetch(match, body)` helper replaces the one-off `globalThis.fetch` wrapper. Two new
tests: the retry acceptance case against a real peer whose schema gains an annotation behind the
client's back, and `Mcp-Method` asserted across a `tools/call`, a `prompts/get` and a
`resources/read`.

## Design decisions

**The refresh runs its own POST and consumes the response directly.** A `tools/list` this
transport minted has no caller in the RPC layer's id space, so enqueuing its response would
deliver a frame nobody is waiting for. Reading it from the `fetch` keeps the refresh invisible
above the transport and leaves `#handleIncoming`'s single-return contract intact. Its request id
is an internal string (`mokei-internal:tools/list:<n>`), which cannot collide with the numeric id
space precisely because it is never enqueued.

**The gate is narrow by the header prefix, not by intent.** `-32020` is also the SDK inbound
classifier's code for a standard-header cross-check disagreement (`Mcp-Method`, `Mcp-Name`,
`MCP-Protocol-Version` against the body), which no refresh can affect. The prefix check is
case-insensitive: it is an HTTP field name, and a peer reporting `mcp-param-tenant` names the same
header. `data.mismatch` is not spec-mandated, so an absent or differently-shaped `data` fails the
gate and the error surfaces unchanged. The prefix does *not* isolate the stale-schema case: SDK
2.0.0's `paramHeaderMismatchRejection` emits the same shape for three cells —
`param-header-missing`, `param-header-invalid-encoding`, `param-header-mismatch` — and only the
first is a stale schema. The other two reach the refresh and are contained one step later by the
`sameParamHeaders` short-circuit, at the accepted price of one `tools/list` each.

**A failed refresh never replaces the peer's error.** Refresh failed, tool absent from the fresh
list, fresh annotations cannot encode these arguments, or the recomputed header set is identical —
every one of those surfaces the original `-32020`. Each refusal is deliberate: the caller gets the
server's own diagnosis rather than a second round trip and a synthesized error.

**The refresh's protocol version comes from the message, not from `#protocolVersion`.** Reading
the field directly makes the retry inert on the one revision it targets: `#protocolVersion` is set
only from an `initialize` result or the `protocolVersionHeader` constructor seed, and `2026-07-28`
has `requiresHandshake: false`, sends no `initialize`, and nothing in the repo passes the seed —
so the field is structurally always `null` there. `#retryAfterSchemaRefresh` passes
`#declaredVersion(message) ?? #protocolVersion`, the same derivation `#sendMessage` uses.

**The `_meta` envelope is copied from the originating request verbatim, not built.**
`2026-07-28`'s `requestMeta` requires `META_CLIENT_CAPABILITIES` as well as
`META_PROTOCOL_VERSION`, and the transport has no `ClientRequestContext` to synthesize
capabilities from — only the client layer's `decorateRequest` knows them. A conformant peer
answers a version-only envelope with `400` / `-32602`, so the refresh fails and the retry never
fires. Copying the whole envelope rather than enumerating this revision's required keys is the
deliberate half: an enumeration silently drops whatever it was not taught about, so the refresh
would break again the next time the envelope gains a required field. The protocol version is
stamped on top as a floor, guarded so a null or unknown revision cannot index into `PROTOCOLS`.

**Headers for both paths come from one `#baseHeaders(headerVersion, sessionVersion)`,** so a later
envelope change cannot reach the ordinary send and miss the refresh. The two version parameters
stay distinct deliberately — `#sendMessage` derives session suppression from the *declared*
revision alone while its version header falls back to `#protocolVersion`, and collapsing them
would change behaviour. `Accept` lists both `application/json` and `text/event-stream`: the
specification requires a Streamable HTTP POST to advertise both, and the SDK server answers `406`
otherwise. What keeps the refresh from consuming an SSE body is the response `Content-Type` check,
not `Accept`.

**The `$ref` type check defers rather than runs.** 2020-12 allows keywords beside `$ref`, so an
annotated node may be a bare wrapper (`{ $ref, 'x-mcp-header' }`) with no type of its own to
judge. Running the eligibility check unconditionally there rejects the ordinary annotated-wrapper
shape outright; skipping it accepts the annotation on no evidence. So the check runs whenever the
node declares a `type` and otherwise *records* the deferral in `pending: Map<path, headerName>`,
joining `seen: Set<lowerName>` and `claimed: Map<path, name>`. The first later node at that path
declaring a `type` settles it — array element schemas excluded, since their type describes an
element rather than the annotated argument — and any path still pending when the walk ends has no
provable type anywhere, so the same
`must annotate boolean/integer/string` error is pushed for it. Unprovable is not eligible. Without
that last rule a `$ref` target that is an object, an array, or typeless would validate and the
tool would be offered with an annotation this client cannot honour — strictly worse than
excluding it, since the call then fails at a conformant peer with a `-32020` the caller cannot act
on.

The path/name split also fixes the original misattribution: same path and same name is one
declaration seen twice (accepted, since a `$ref` target is walked at the referencing property's
own path); same path and different names is `Conflicting`; different paths sharing a name stays
`Duplicate`.

## Three design defects found in flight

All three were in the refresh's POST envelope, and all three are worth recording because of *what
caught them*.

1. **Reading `#protocolVersion` directly** — structurally always `null` on `2026-07-28`, so the
   retry would have been inert against every real peer. Invisible to all seven new unit tests.
2. **`Accept: application/json` alone** — violates Streamable HTTP; the SDK server answers `406`.
3. **A version-only `_meta`** — missing the required `META_CLIENT_CAPABILITIES`; a conformant peer
   answers `400` / `-32602`.

The third was invisible to both mocked-`fetch` suites, because a mock validates no envelope, and
surfaced only when the real-peer acceptance test failed. That is the general lesson: a mocked
transport cannot falsify a claim about what a conformant peer accepts, and every one of these
three defects was a claim of exactly that kind.

## Status

`pnpm build`, `pnpm test` and `rtk proxy pnpm run lint` all clean. 99/99 unit in
`@mokei/http-client` (68 transport, 35 `x-mcp-header`), 14/14 in the SDK-server interop suite;
integration overall 49 passed / 22 skipped, skips confined to suites gated on a local model
backend.

The whole-branch review found no Critical issue and confirmed the retry correctly ordered against
the 404/session-expiry, envelope-error, SSE, JSON, 202 and timeout paths; `retried` bounds
recursion at one; `wasCancelled` is read before `#releaseController` drops the entry it lives on.

It also caught a regression this branch introduced and an earlier triage had wrongly dismissed as
pre-existing: an intermediate guard let five input classes that previously reported `valid: false`
report `valid: true`, including the ordinary single-hop `{ $ref, 'x-mcp-header' }` with an object-,
array- or typeless target — and `valid` is the filter deciding whether a tool is dropped with a
warning or offered with an annotation mokei cannot honour. The deferral design above is the fix,
verified by differential probe against the pre-branch implementation over 28 schemas: no false
accept among the five loosened classes, no false reject among twenty legitimate shapes (`$ref` to
string/integer/boolean, nullable unions, `$ref` chains, `anyOf` targets, nested paths).

Deferred minors, all triaged as ship-as-is: a narrow dispose-vs-retry race (a `dispose()` landing
just before the retried send); `#baseHeaders(version, version)` on the refresh diverging from the
send's session derivation only when a message declares no revision *and* a sessionless revision was
seeded via `protocolVersionHeader` *and* a session id exists, degrading to a failed refresh; and
class-body fragmentation in `transport.ts`. One was routed onward — see below.

## What this proves, and what it does not

**Proves.** `HEADER_MISMATCH` now has a reachable *consumer*: a client path that recognises a
peer's `-32020`, refreshes, and recovers, exercised against a real SDK peer rather than a stub.
`Mcp-Method` is asserted on the outgoing request for three methods rather than inferred from the
peer accepting the call.

**Does not prove.** mokei still never **emits** `-32020` — its HTTP server reads no `Mcp-Param-*`
headers at all (backlog §3.2.1), so nothing in mokei can reject a request for a header/body
disagreement. That closes only half of backlog §3.3.1. The retry is `2026-07-28`-only in practice
and untested against a peer that changes a schema *and* moves the protocol version. Nothing
exercises the three `paramHeaderMismatchRejection` cells separately — the two non-stale ones are
covered by the `sameParamHeaders` short-circuit rather than distinguished at the gate.

## Follow-on

One item routed to `backlog/2026-06-20-mcp-draft-remaining.md` §3.4: a firing retry can hold the
transport's serial outgoing sink for three round trips (original + refresh + retry), each bounded
only by its own full `#timeout` budget rather than sharing one — up to ~90s at the default. Argues
for a tighter refresh-specific timeout.
