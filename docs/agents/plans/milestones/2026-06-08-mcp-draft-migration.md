# Milestone: MCP draft spec migration

**Status:** in progress — Phase 0 groundwork shipped; breaking cut deferred.
**Opened:** 2026-06-08
**Branch / PR:** `feat/mcp-spec-update` → PR #23
**Baseline:** `2025-11-25` (`LATEST_PROTOCOL_VERSION`)
**Target:** [MCP draft](https://modelcontextprotocol.io/specification/draft/changelog) (post-`2025-11-25`, unreleased)

## Goal

Migrate mokei from the `2025-11-25` MCP baseline to the next draft revision. The draft
removes the `initialize` handshake, protocol-level sessions, and server-initiated requests
— no clean way to speak both versions on one connection — so the breaking work is a
**hard-cut to draft-only**, deferred until the draft finalizes. Until then, all
non-breaking groundwork lands on `2025-11-25` without disruption.

## Phase 0 — Groundwork (SHIPPED on 2025-11-25)

Additive, backward-compatible; `2025-11-25` peers ignore the extras. Landed on
`feat/mcp-spec-update`:

| # | Change | Status |
|---|---|---|
| G1 | `CacheableResult` (`ttlMs` + `cacheScope`) on list/read results; server emits configured cache hints (SEP-2549) | done |
| G2 | `Mcp-Method` + `Mcp-Name` headers on Streamable HTTP POST (SEP-2243) | done |
| G3 | Resource-not-found `-32002` → `-32602`; verified mokei core raises no `-32002`, regression guard added | done |
| G4 | `extensions` capability field on client + server capabilities | done |
| G6 | Deterministic `tools/list` / `prompts/list` ordering (sorted by name) | done |
| G7 | Client `x-mcp-header` → `Mcp-Param-*` injection + codec + tool-list validation/filter (SEP-2243), parts 1–4 | done |

## Deferred groundwork (blocked / follow-up)

- **G5** — OTel `_meta` trace context (`traceparent`/`tracestate`/`baggage`, SEP-414).
  Blocked: `@enkaku/otel@0.16.0` covers `traceparent` only and is not yet a dependency.
  Upstream ask filed in the enkaku repo. → backlog `2026-06-09-mcp-draft-deferred-groundwork.md`.
- **G8** — loosen `inputSchema`/`outputSchema` to JSON Schema 2020-12 + `$ref` (SEP-2106).
  Blocked: `@enkaku/schema@0.16.0` is draft-07 (single module-level AJV). Upstream ask
  filed (switch to `Ajv2020`). → same backlog item.
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
  Recommendation (from spike): reimplement correlation in `context-rpc` above the existing
  `@enkaku/transport` duplex — generalize `#sentRequests` to resolve a *stream* of
  correlated frames, add a continuation-token store decoupled from `#sentRequests` for
  MRTR, keep `@enkaku/transport` untouched. Should begin in parallel with Phase 0.
- **U2 → G8** — `@enkaku/schema` draft-07 → needs `Ajv2020` / configurable draft. Ask filed.
- **U3 → G5** — `@enkaku/otel` lacks `tracestate`/`baggage` codecs. Ask filed.

## Open questions (later phases)

- MRTR continuation state: STDIO vs HTTP, and interaction with `notifications/cancelled`.
- `server/discover` on STDIO: back-compat probe semantics vs version mismatch.
- Server-minted handles (replacing sessions): convention for passing as tool args across `ContextHost`.

## Source

Origin spike docs (superpowers, ephemeral — archived on `/complete`): the gap-analysis
spec, Phase 0 plan, and upstream-findings authored 2026-06-08/09. This milestone is the
durable record.
