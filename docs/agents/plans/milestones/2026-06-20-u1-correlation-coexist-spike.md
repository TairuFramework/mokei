# Spike + ADR: U1 correlation model & opt-in version coexistence

**Status:** decided (architecture) — implementation gated on draft finalization for the
draft-specific wiring; the version-agnostic refactor is buildable now.
**Date:** 2026-06-20
**Relates to:** `milestones/2026-06-08-mcp-draft-migration.md`,
`backlog/2026-06-09-mcp-draft-breaking-cut.md`,
`backlog/2026-06-09-mcp-draft-deferred-groundwork.md`

## Decision

1. **Adopt opt-in version *coexistence*, not a hard-cut.** mokei keeps speaking
   `2025-11-25` and adds the draft as a second supported version, selected **per context
   at setup**. Existing consumers are not broken. The earlier hard-cut plan is superseded.
2. **U1 correlation model:** generalize the single-deferred `#sentRequests` in
   `@mokei/context-rpc` into a **pending-exchange** abstraction that supports both
   *resolve-once* (today's request/response) and *streaming* (draft tool calls with
   interleaved input sub-requests), plus a **continuation-token store** decoupled from
   `#sentRequests` for MRTR input correlation. `@enkaku/transport` stays untouched.

Rationale for coexistence over hard-cut: mokei is a **library**. The hard-cut was chosen
only to avoid dual-path maintenance, not because coexistence is infeasible. mokei already
has the version scaffolding (`SUPPORTED_PROTOCOL_VERSIONS`, `isSupportedVersion`,
protocolVersion negotiation). Designing U1 for coexistence costs ~one extra wiring branch;
if the project later decides to drop `2025-11-25`, the hard-cut becomes a config/branch
deletion, **not** a rewrite. Coexistence-first strictly dominates.

## Current model (baseline, `2025-11-25`)

`ContextRPC` (`packages/context-rpc/src/rpc.ts`) is a full-duplex JSON-RPC peer; both
`ContextClient` and `ContextServer` extend it. Correlation is one deferred per outbound id:

- `#sentRequests: Record<RequestID, RequestController>` — a `Deferred & AbortController`.
- `request()` writes `{id, method, params}`; the **first** matching `Response`
  (`method == null`, `id` matches) resolves/rejects exactly once and deletes the entry.
- Cancellation → `notifications/cancelled`; timeout → reject + cancel.
- **Server-initiated requests** ride the *same* path in reverse: the server calls
  `this.request('sampling/createMessage' | 'elicitation/create' | 'roots/list', …)`
  (`server.ts:176-184`), correlated by the duplex transport.

## What the draft changes (the U1 problem)

- **B7 / MRTR (SEP-2322):** removes server-initiated top-level requests. A `tools/call`
  (client→server) that needs model input mid-execution emits **`inputRequests`** inside
  its own response lifecycle; the client answers with **`inputResponses`** correlated to
  the outer tool-call id + an input id. So sampling/elicitation become **input
  sub-exchanges nested in a tool-call stream**, not independent reverse-direction calls.
- Consequence: `tools/call` is no longer 1-request → 1-response. It becomes
  **1-request → (progress* · inputRequest* · result)**, and `inputResponse` frames are a
  *second* client→server correlation keyed by a continuation token, not by the outer id's
  resolve-once slot.
- **B2:** no `initialize`; per-request `_meta` carries version/identity/caps.
- **B3:** `server/discover` advertises versions/caps/identity (replaces `initialize`).
- **B1:** no protocol sessions / `Mcp-Session-Id`; cross-call state → server-minted handles.
- **B4:** `subscriptions/listen` replaces the GET stream + `resources/subscribe`.

## Proposed correlation abstraction (version-agnostic core)

Replace `#sentRequests[id]: RequestController` with a tagged **PendingExchange**:

```
type PendingExchange<R> =
  | { kind: 'once';   controller: Deferred<R> & AbortController }      // legacy + draft non-streaming
  | { kind: 'stream'; sink: ExchangeSink<R> }                          // draft tool calls
```

- `ExchangeSink` accepts interleaved inbound frames for one outbound id: `onProgress`,
  `onInputRequest` (→ produces an `inputResponse` via the continuation store), and a
  terminal `onResult` / `onError` that settles the outer promise.
- **Continuation-token store**, separate from `#sentRequests`:
  `#continuations: Map<Token, ContinuationEntry>`. On the **answering** side an inbound
  `inputRequest` registers a handler-driven reply keyed by its token; the matching
  `inputResponse` is routed by token, independent of any `#sentRequests` slot. This is the
  piece today's core has no equivalent for.
- `_handleMessage`'s response branch (`method == null`) generalizes: route by id to the
  exchange; `once` settles-and-deletes (unchanged behavior); `stream` feeds the sink and
  only deletes on terminal. A new branch routes inbound `inputResponse`/`inputRequest`
  frames by continuation token.

**Public handler surface stays stable across versions.** `onSampling` / `onElicitation`
keep the same signature; only the *wiring* differs: in `2025-11-25` they are driven by an
inbound server→client **request**; in draft they are driven by an **inputRequest** nested
in a tool-call stream. The version flag on the RPC core selects the wiring. This is the
core coexistence win — consumers write one handler, both protocols work.

## Version selection (no `initialize` in draft)

- `SUPPORTED_PROTOCOL_VERSIONS` becomes `['2025-11-25', '<draft-id>']`.
- Selection at `addLocalContext` / `addHTTPContext`, in order:
  1. **Explicit:** a `protocolVersion` option skips negotiation (fast path; recommended for
     known peers).
  2. **Probe:** attempt `server/discover` (draft). A draft server answers with
     versions/caps; a `2025-11-25` server returns method-not-found / an `initialize`-shaped
     world → fall back to the `initialize` handshake. (Milestone open-question #2 — the
     STDIO probe ordering and the HTTP `MCP-Protocol-Version` header interaction must be
     pinned against the final spec.)
- The negotiated version is stored on the context and threaded into the RPC core's wiring
  selector.

## Buildable now vs. blocked on the spec

**Buildable now (spec-independent, behavior-preserving):**

- Refactor `#sentRequests` → the `PendingExchange` abstraction with **only** the `once`
  arm wired. Zero behavior change; the entire current `context-rpc` + client/server suite
  must stay green. This de-risks the deepest part of B7 ahead of the spec and is shippable
  on `2025-11-25` today.
- Introduce the (unused) `#continuations` store + `stream` arm types behind the
  abstraction, exercised only by unit tests with synthetic frames — no draft method names.
- Thread an internal `version` selector through the RPC core (default `2025-11-25`), with
  the draft branch stubbed. Wire the coexistence scaffolding without the draft payloads.

**Blocked on draft finalization (exact shapes still move):**

- Concrete `inputRequest` / `inputResponse` frame schemas + method names (B7).
- `server/discover` result schema + probe semantics (B3).
- `subscriptions/listen` framing (B4).
- Per-request `_meta` version/identity/caps + version-mismatch error (B2, SEP-2575).

## Impact on the breaking-cut plan

The B-items are no longer a "hard-cut"; they become **additive draft wiring** behind the
version selector. Re-frame:

- **B5** (remove `ping`): becomes "don't send `ping` on draft contexts" — conditional, not
  a removal.
- **B2/B1/B6**: draft contexts use per-request `_meta` + handles; legacy contexts unchanged.
- **B7/B4**: the streaming-exchange core (built now, version-agnostic) is the foundation;
  draft wiring plugs into it once shapes finalize.
- **D1–D3** deprecations apply only on draft contexts.

## Risks / open questions

- **Dual-path test matrix.** Every transport/handler path doubles. Mitigate: keep the
  public handler surface single; branch only at the wiring seam; table-test both versions
  against one handler.
- **Probe ambiguity on STDIO.** A `server/discover` to a legacy server has no standard
  negative; depends on the final spec's back-compat probe. Until pinned, prefer the
  explicit `protocolVersion` option and treat the probe as best-effort.
- **MRTR continuation lifetime** vs `notifications/cancelled` and tool-call timeout — the
  continuation store must be torn down when the outer exchange settles or aborts.
- **Streaming result back-pressure** on STDIO vs HTTP — the sink must not unbounded-buffer
  (mirror the existing notification drop-when-no-reader policy).

## Recommended next step

Land the **behavior-preserving `PendingExchange` refactor** on `2025-11-25` now (its own
branch, full suite green) — it is the highest-value de-risking move and is independent of
the draft release. Hold the draft-specific wiring until the spec finalizes, then plug it
into the seam this refactor creates.
