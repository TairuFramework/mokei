# Milestone: MCP draft spec migration

**Status:** in progress — Phase 0 groundwork shipped; breaking cut deferred.
**Opened:** 2026-06-08
**Branch / PR:** `feat/mcp-spec-update` → PR #23
**Baseline:** `2025-11-25` (`LATEST_PROTOCOL_VERSION`)
**Target:** [MCP draft](https://modelcontextprotocol.io/specification/draft/changelog) (post-`2025-11-25`, unreleased)

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
version/identity/caps + version-mismatch error (B2, SEP-2575).

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

- **G5 baggage** — no `baggage` key emitted yet: `@enkaku/otel@0.16.1` ships
  `formatBaggage`/`parseBaggage` codecs but no active-baggage accessor, so there is nothing
  to format from. Needs an upstream `getActiveBaggage` (new Enkaku ask) or a direct
  `@opentelemetry/api` read. → backlog `2026-06-09-mcp-draft-deferred-groundwork.md`.
- **G5 inbound** — server-side extraction (parse `_meta.traceparent` → `withActiveContext`)
  not wired; outbound propagation only. → same backlog item.
- **G7 follow-ups** — part 5 (stale-schema → `-32001` HeaderMismatch → `tools/list`
  refresh + retry) deferred; schema walk currently covers object `properties` depth only
  (array `items` / `$ref` / `allOf`|`anyOf`|`oneOf` not traversed). → same backlog item.

## Phase 1 — Breaking cut (draft-only, when draft finalized)

Hard-cut; ordered by dependency. Blocked on the draft finalizing **and** on U1.

| # | Change | Notes |
|---|---|---|
| B5 | Remove `ping` | Smallest; decouples RPC core early. |
| B2 | Remove `initialize`/`initialized`; stateless `_meta` (version/identity/caps per request); version-mismatch error (SEP-2575) | Foundational; everything below assumes it. |
| B3 | Add `server/discover` RPC (MUST) — advertises versions/caps/identity (SEP-2575) | Replaces `initialize` negotiation. Depends on B2. |
| B1 | Remove protocol sessions + `Mcp-Session-Id` (SEP-2567) | Depends on B2; cross-call state → server-minted handles as tool args. |
| B6 | Remove `logging/setLevel` + roots list-changed; per-request `_meta` log level | Depends on B2 `_meta`. |
| B7 | **MRTR** replaces server-initiated requests — `inputRequests`/`inputResponses` (SEP-2322) | Deepest. Dismantles bidirectional `request()`/`#sentRequests` in `context-rpc`. Depends on U1 + B2. |
| B4 | `subscriptions/listen` replaces GET endpoint + `resources/subscribe` (SEP-2575) | Rewrite HTTP server/client streaming. Depends on U1; parallel with B7. |
| D1–D3 | Apply deprecation handling (Roots/Sampling/Logging; HTTP+SSE transport; `includeContext`) | As the above land. |

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

## Open questions (later phases)

- MRTR continuation state: STDIO vs HTTP, and interaction with `notifications/cancelled`.
- `server/discover` on STDIO: back-compat probe semantics vs version mismatch.
- Server-minted handles (replacing sessions): convention for passing as tool args across `ContextHost`.

## Source

Origin spike docs (superpowers, ephemeral — archived on `/complete`): the gap-analysis
spec, Phase 0 plan, and upstream-findings authored 2026-06-08/09. This milestone is the
durable record.
