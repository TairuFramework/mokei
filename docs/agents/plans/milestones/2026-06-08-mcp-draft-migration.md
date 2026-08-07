# Milestone: MCP draft spec migration

**Status:** in progress — both revisions ship; MRTR (B7) and `subscriptions/listen` (B4)
remain.
**Opened:** 2026-06-08
**Branch / PR:** `feat/mcp-spec-update` → PR #23
**Baseline:** `2025-11-25` (`LATEST_PROTOCOL_VERSION`)
**Target:** MCP `2026-07-28` — released on schedule, no longer a draft. mokei serves and speaks
both revisions, selected per context.

## Goal

Add the next MCP draft revision **alongside** the `2025-11-25` baseline. The draft removes
the `initialize` handshake, protocol-level sessions, and server-initiated requests, so the
two cannot share one connection — but mokei is a library, so rather than a hard-cut it
supports **both versions, selected per context at setup** (opt-in coexistence). Existing
consumers are not broken. Until then, all non-breaking groundwork lands on `2025-11-25`
without disruption.

**Architecture decision (2026-06-20):** opt-in coexistence over hard-cut; U1 correlation
model resolved — see the **Architecture decision** section below (this milestone is the
authoritative record). The "hard-cut" framing in Phase 1 is superseded — the B-items become
additive draft wiring behind a per-context version selector, not removals.

## Status update — the revision shipped (2026-08-04)

The additive wiring is in and released work now spans both revisions. What landed, in order:

- **Stateless core** (PR #40, `completed/2026-08-02-mcp-2026-07-28-stateless-core.complete.md`):
  B5, B2, B3, B1 and the `logLevel` half of B6, on both transports. Version selection is real —
  `PROTOCOL_VERSIONS`, `PROTOCOLS`, per-context `protocolVersion` and the `'auto'` probe.
- **Defect wave** (PR #41, `completed/2026-08-03-mcp-2026-07-28-defect-wave.complete.md`): the
  correctness follow-ons, including bounded concurrent dispatch and non-vacuous result unions on
  both revisions.
- **Interop peer matrix** (PR #42, `completed/2026-08-04-interop-peer-matrix.complete.md`): all
  four client/server × stdio/HTTP quadrants against SDK `2.0.0`, on both revisions.

What remains: B7 (MRTR) and the roots half of B6, B4 (`subscriptions/listen`), D1–D3, and G7
part 5's retry loop. Each is tracked in `backlog/2026-06-20-mcp-draft-remaining.md`; B7 and the
G7 part 5 / `Mcp-Method` pair are promoted to `next/`.

The open question about `server/discover` STDIO probe semantics is answered: the client probes
with `server/discover`, and any failure falls back to the `2025-11-25` handshake, with a `-32022`
response's `data.supported` used to negotiate the newest shared revision.

## Status update — SDK v2 evaluation findings (2026-07-02)

The official TypeScript SDK v2 (evaluated at `2.0.0-beta.2`, stable `2.0.0` since) implements the
`2026-07-28` revision and was evaluated against mokei (decision: keep custom core — see
`backlog/2026-07-02-mcp-sdk-v2-adoption.md`). Findings that bear on this milestone:

- **The draft has a name and a date.** `2026-07-28`, RC stage, spec release expected
  July 28, 2026, with SDK v2 stable shipping alongside. "Blocked on draft finalization"
  is now a ~4-week window, not open-ended.
- **B-item shapes are now pinnable against a reference implementation.** SDK v2's
  `core-internal` ships wire codecs for both revisions (`wire/rev2025-11-25/`,
  `wire/rev2026-07-28/`), the modern-era negotiation (`server/discover`, no `initialize`,
  per-request `_meta` envelopes — confirms B2/B3 direction), and the MRTR machinery
  (`InputRequiredResult`, `withInputRequired`, plus a legacy shim — B7). Re-validate
  B-item payloads against SDK source + final spec before wiring.
- **Version probe design confirmed.** SDK v2 client uses
  `versionNegotiation: { mode: 'auto' }` (probe `server/discover`, fall back to
  `initialize`) or `{ pin: '2026-07-28' }` — same explicit-else-probe shape as this
  milestone's version-selection design.
- **Modern-era cancellation** is per-request stream close / `requestSignal`, not
  `notifications/cancelled` — direct input to the "MRTR continuation lifetime vs
  cancellation" open question.
- **Tasks removed from the spec** (SEP-2663) — mokei never implemented them; the SDK
  keeps the 2025-11-25 task vocabulary as deprecated interop-only types. Nothing to do.
- **Roots / sampling / logging deprecated** (SEP-2577) — annotation-only, ≥12-month
  window. Confirms D1–D3 pacing; also a session-layer concern (sampling is load-bearing
  there) tracked in the adoption backlog item.
- **Interop test peer available.** SDK v2 can serve as the "live draft peer" that G7
  part 5 and B-wiring validation have been waiting on.

## Architecture decision — opt-in coexistence + U1 correlation (2026-06-20)

> ADR. Decided (architecture); the version-agnostic core is shipped (see
> `completed/2026-06-20-pendingexchange-refactor.complete.md`), draft-specific wiring gated
> on draft finalization.

### Decision

1. **Opt-in version *coexistence*, not a hard-cut.** mokei keeps speaking `2025-11-25` and
   adds the draft as a second supported version, selected **per context at setup**. Existing
   consumers are not broken.
2. **U1 correlation model:** generalize the single-deferred `#sentRequests` in
   `@mokei/context-rpc` into a **pending-exchange** abstraction supporting both *resolve-once*
   (today's request/response) and *streaming* (draft tool calls with interleaved input
   sub-requests), plus a **continuation-token store** decoupled from `#sentRequests` for MRTR
   input correlation. `@enkaku/transport` stays untouched.

Rationale for coexistence: mokei is a **library**. The hard-cut was chosen only to avoid
dual-path maintenance, not because coexistence is infeasible. mokei already has the version
scaffolding (`SUPPORTED_PROTOCOL_VERSIONS`, `isSupportedVersion`, protocolVersion
negotiation). Coexistence costs ~one extra wiring branch; dropping `2025-11-25` later becomes
a config/branch deletion, **not** a rewrite. Coexistence-first strictly dominates.

### The U1 problem (what the draft changes)

- **B7 / MRTR (SEP-2322):** removes server-initiated top-level requests. A `tools/call` that
  needs model input mid-execution emits **`inputRequests`** inside its own response lifecycle;
  the client answers with **`inputResponses`** correlated to the outer tool-call id + an input
  id. Sampling/elicitation become **input sub-exchanges nested in a tool-call stream**, not
  independent reverse-direction calls. So `tools/call` goes from 1-request → 1-response to
  **1-request → (progress\* · inputRequest\* · result)**, and `inputResponse` frames are a
  *second* client→server correlation keyed by a continuation token, not the outer id's
  resolve-once slot — the piece today's core has no equivalent for.
- **B2:** no `initialize`; per-request `_meta` carries version/identity/caps.
- **B3:** `server/discover` advertises versions/caps/identity. **B1:** no protocol sessions;
  cross-call state → server-minted handles. **B4:** `subscriptions/listen` replaces the GET
  stream + `resources/subscribe`.

### Correlation abstraction (version-agnostic core — SHIPPED)

`#sentRequests[id]: RequestController` → a tagged **PendingExchange**: `once`
(`Deferred & AbortController`, legacy + draft non-streaming) | `stream` (a sink taking
interleaved frames: `onProgress` / `onInputRequest` / terminal `onResult`|`onError`). A
separate **continuation-token store** routes `inputResponse`/`inputRequest` by token,
independent of any `#sentRequests` slot, torn down when the outer exchange settles/aborts.
`_handleMessage`'s response branch routes by id: `once` settles-and-deletes (unchanged); a
`stream` feeds the sink and deletes only on a terminal frame.

**Public handler surface stays stable across versions.** `onSampling` / `onElicitation` keep
their signatures; only the *wiring* differs — in `2025-11-25` driven by an inbound
server→client request, in draft by an `inputRequest` nested in a tool-call stream. The version
flag on the RPC core selects the wiring. This is the core coexistence win: one handler, both
protocols.

### Version selection (no `initialize` in draft)

`SUPPORTED_PROTOCOL_VERSIONS` becomes `['2025-11-25', '<draft-id>']`. Selected at
`addLocalContext` / `addHTTPContext`: **explicit** `protocolVersion` option (fast path,
recommended for known peers) → else **probe** `server/discover` (draft answers
versions/caps; a `2025-11-25` server returns method-not-found / an `initialize`-shaped world →
fall back to the handshake). STDIO probe ordering + HTTP `MCP-Protocol-Version` header
interaction must be pinned against the final spec (open question).

### Buildable now vs blocked on the spec

**Shipped (spec-independent, behavior-preserving):** the `PendingExchange` refactor with the
`once` arm wired + the `stream` arm / `#continuations` store built and unit-tested with
synthetic frames (no draft method names). Landed via PR #32.

**Blocked on draft finalization (exact shapes still move):** concrete
`inputRequest`/`inputResponse` schemas + method names (B7); `server/discover` result schema +
probe semantics (B3); `subscriptions/listen` framing (B4); per-request `_meta`
version/identity/caps + version-mismatch error (B2, SEP-2575). *Update 2026-07-02:* all of
these now have a reference implementation in SDK v2's `wire/rev2026-07-28/` codecs — shapes
can be pinned early; finalization expected July 28, 2026 (see the status-update section).

### Risks

- **Dual-path test matrix** — every transport/handler path doubles. Mitigate: single public
  handler surface; branch only at the wiring seam; table-test both versions against one handler.
- **Probe ambiguity on STDIO** — `server/discover` to a legacy server has no standard
  negative; until pinned, prefer explicit `protocolVersion`, treat probe as best-effort.
- **MRTR continuation lifetime** vs `notifications/cancelled` + tool-call timeout — store torn
  down on outer settle/abort (the shipped `onSettle → clearForExchange` hook).
- **Streaming back-pressure** STDIO vs HTTP — the sink must not unbounded-buffer (mirror the
  notification drop-when-no-reader policy).

## Phase 0 — Groundwork (SHIPPED on 2025-11-25)

Additive, backward-compatible; `2025-11-25` peers ignore the extras. Landed on
`feat/mcp-spec-update`:

| # | Change | Status |
|---|---|---|
| G1 | `CacheableResult` (`ttlMs` + `cacheScope`) on list/read results; server emits configured cache hints (SEP-2549) | done |
| G2 | `Mcp-Method` + `Mcp-Name` headers on Streamable HTTP POST (SEP-2243) | done |
| G3 | Resource-not-found `-32002` → `-32602`; verified mokei core raises no `-32002`, regression guard added | done |
| G4 | `extensions` capability field on client + server capabilities | done |
| G5 | Outbound W3C trace context in request `_meta` — `ContextClient.request()` injects `traceparent`/`tracestate` from the active OTel span (SEP-414) | done |
| G6 | Deterministic `tools/list` / `prompts/list` ordering (sorted by name) | done |
| G7 | Client `x-mcp-header` → `Mcp-Param-*` injection + codec + tool-list validation/filter (SEP-2243), parts 1–4 | done |
| G8 | Infer JSON Schema draft from `$schema` dialect; validate tool/prompt schemas declaring 2020-12 against `Ajv2020` (SEP-2106) | done |

## Deferred groundwork (follow-up)

- **G5 baggage** — **SHIPPED** (`feat/mcp-draft-g5-baggage`, 2026-06-19): `currentTraceMeta()`
  emits the SEP-414 `baggage` `_meta` key via `getActiveBaggage()` + `formatBaggage()`
  (`@enkaku/otel@0.17.0`). → backlog `2026-06-20-mcp-draft-remaining.md`.
- **G8 strict-mode** — **SHIPPED** (2026-06-20): `strict: false` threaded into tool/prompt
  validators in `context-server/src/definitions.ts` (`@enkaku/schema@0.17.0`). → same
  backlog item.
- **G7 walk depth** — **SHIPPED** (2026-06-20): `collectHeaderAnnotations` traverses local
  `$ref` + `allOf`/`anyOf`/`oneOf`; errors on `x-mcp-header` in array `items`/`prefixItems`.
  → same backlog item.
- **G5 inbound** — **SHIPPED** (2026-06-20): `context-server` activates the request's W3C
  trace context + baggage for the handler — new `context-server/src/trace.ts`
  (`withRequestMeta`), `_handleRequest` wraps dispatch once (`@enkaku/otel@0.17.1`
  `extractW3CTraceContext` + `withActiveBaggage`, enkaku #42). → same backlog item.
- **G7 part 5** — **SHIPPED** (2026-08-07): stale-schema → `-32020` HeaderMismatch → `tools/list`
  refresh + retry, in `http-client`'s transport below the RPC layer. The refresh reuses the
  originating request's own `_meta` envelope — `2026-07-28` requires `clientCapabilities` there,
  which only the client layer knows — and the retry is bounded at one, skipped when the refreshed
  annotations produce the header set the peer just rejected. Proven end-to-end against the SDK v2
  server by flipping `headerEcho`'s schema mid-connection. `Mcp-Method` is now asserted directly
  in the same suite. The earlier `-32001` collision note was wrong: the code is `-32020`, which
  mokei reserves as `HEADER_MISMATCH`. →
  `docs/agents/plans/completed/2026-08-07-mcp-header-story-bc.complete.md`.

## Phase 1 — Additive `2026-07-28` wiring

Originally scoped as a hard cut; superseded by the coexistence decision above, so these are
additive behind the version selector rather than removals. Ordered by dependency.

| # | Change | Status |
|---|---|---|
| B5 | Remove `ping` | done (PR #40) |
| B2 | Remove `initialize`/`initialized`; stateless `_meta` (version/identity/caps per request); version-mismatch error (SEP-2575) | done (PR #40) |
| B3 | Add `server/discover` RPC (MUST) — advertises versions/caps/identity (SEP-2575) | done (PR #40) |
| B1 | Remove protocol sessions + `Mcp-Session-Id` (SEP-2567) | done (PR #40) |
| B6 | Remove `logging/setLevel` + roots list-changed; per-request `_meta` log level | `logLevel` done (PR #40); roots half belongs with B7 |
| B7 | **MRTR** replaces server-initiated requests — `inputRequests`/`inputResponses` (SEP-2322) | open — `next/2026-08-04-mcp-mrtr.md` |
| B4 | `subscriptions/listen` replaces GET endpoint + `resources/subscribe` (SEP-2575) | open — backlog piece E |
| D1–D3 | Apply deprecation handling (Roots/Sampling/Logging; HTTP+SSE transport; `includeContext`) | open — backlog piece F |

## Upstream (Enkaku) dependencies

- **U1** — transport / RPC-core model for stateless + MRTR. **Long pole; blocks B4 + B7.**
  **Resolved + core shipped (2026-06-20)** — design in the Architecture decision section
  above; the behavior-preserving `PendingExchange` (resolve-once | streaming) + continuation
  store landed via `completed/2026-06-20-pendingexchange-refactor.complete.md` (PR #32).
  `@enkaku/transport` untouched — fully local `context-rpc` work, not an enkaku dependency.
  Draft wiring plugs into the `_registerStreamExchange` seam once the spec finalizes.
- **U2 → G8** — `@enkaku/schema` draft-07 → needs `Ajv2020` / configurable draft.
  **Resolved** in `@enkaku/schema@0.16.1` (`createValidator(schema, { draft: '2020-12' })`,
  new `ValidatorOptions` export). G8 unblocked.
- **U3 → G5** — `@enkaku/otel` lacks `tracestate`/`baggage` codecs.
  **Resolved** in `@enkaku/otel@0.16.1` (`format`/`parseTracestate`, `format`/`parseBaggage`).
  G5 unblocked.
- **U4 → G5 inbound** — `@enkaku/otel` needed a W3C `traceparent` → OTel `Context` builder
  (`extractTraceContext` reads `tid`/`sid`, not W3C) + baggage activation.
  **Resolved** in `@enkaku/otel@0.17.1` (`extractW3CTraceContext` + `withActiveBaggage`,
  enkaku #42). G5 inbound shipped.
  `context-server` wiring lands once it releases.

## Open questions (later phases)

- MRTR continuation state: STDIO vs HTTP, and interaction with `notifications/cancelled`.
- Server-minted handles (replacing sessions): convention for passing as tool args across `ContextHost`.

Answered: `server/discover` STDIO probe semantics — see the 2026-08-04 status update.

## Source

Origin spike docs (superpowers, ephemeral — archived on `/complete`): the gap-analysis
spec, Phase 0 plan, and upstream-findings authored 2026-06-08/09. This milestone is the
durable record.
