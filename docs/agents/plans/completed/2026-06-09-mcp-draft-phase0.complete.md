# MCP draft — Phase 0 groundwork + upstream checks — Completed

**Status:** complete
**Completed:** 2026-06-09
**Branch:** feat/mcp-spec-update → PR #23
**Origin specs/plans (ephemeral, removed):** mcp-draft-migration-design,
mcp-draft-upstream-findings, mcp-draft-phase0 (all 2026-06-08/09).
**Ongoing milestone:** `milestones/2026-06-08-mcp-draft-migration.md` (breaking cut + deferred groundwork).

## Goal

Map the gap between mokei's `2025-11-25` MCP baseline and the unreleased draft, then land
all **non-breaking groundwork** on `2025-11-25` while deferring the breaking hard-cut until
the draft finalizes. This effort was plan/spike + Phase 0 execution only — no breaking
changes implemented.

## Key design decisions

- **Hard-cut strategy.** The draft removes the `initialize` handshake, protocol-level
  sessions, and server-initiated requests; there is no clean way to speak both `2025-11-25`
  and the draft on one connection. The breaking phase is therefore a hard-cut to draft-only,
  deferred — not a dual-version compatibility layer.
- **Two-axis classification.** Every change was sorted breaking vs non-breaking *and* core
  MUST vs optional, so groundwork that shrinks the breaking phase could land immediately
  while `2025-11-25` peers ignore the additive fields/headers.
- **G7 lives in the transport layer.** `x-mcp-header` → `Mcp-Param-*` injection is built in
  `@mokei/http-client`: `HTTPTransport` correlates responses to requests (`#pendingMethods`)
  to cache `tools/list` `inputSchema`s, then injects encoded headers on `tools/call`. The
  codec (`src/x-mcp-header.ts`) is a pure, separately-tested module. Schema walking covers
  object `properties` depth only (a documented, tracked limitation).
- **U1 recommendation.** For stateless + MRTR, reimplement correlation in `context-rpc`
  above the existing `@enkaku/transport` duplex (stream-resolving `#sentRequests` +
  a continuation-token store decoupled from it) rather than forking the transport.

## What was built (Phase 0, shipped on 2025-11-25)

- **G1** `CacheableResult` (`ttlMs`/`cacheScope`) on list/read result schemas; server emits
  configured cache hints.
- **G2** `Mcp-Method` + `Mcp-Name` headers on Streamable HTTP POST.
- **G3** verified mokei core raises no `-32002` (resource-not-found); added a regression guard.
- **G4** `extensions` capability field on client + server capabilities.
- **G6** deterministic `tools/list` / `prompts/list` ordering.
- **G7** client `x-mcp-header` support (SEP-2243 parts 1–4): codec + transport schema cache,
  `Mcp-Param-*` injection, tool-list validation/filtering. Uses `@mokei/logger` for warnings.

## Upstream (Enkaku) findings

- **U1** transport/RPC-core decision documented (recommendation above); the long pole that
  blocks the breaking phase (B4 + B7).
- **U2** `@enkaku/schema@0.16.0` is draft-07 (single module-level AJV) → **G8 deferred**;
  upstream ask filed (switch to `Ajv2020` / configurable draft).
- **U3** `@enkaku/otel@0.16.0` covers `traceparent` only, no `tracestate`/`baggage`, and is
  not yet a dependency → **G5 deferred**; upstream ask filed (add codecs).

## Follow-on (extracted to backlog)

- `backlog/2026-06-09-mcp-draft-deferred-groundwork.md` — G5, G8 (blocked upstream), G7
  follow-ups (part 5 retry, deeper schema walk).
- `backlog/2026-06-09-mcp-draft-breaking-cut.md` — B1–B7 hard-cut, blocked on draft release
  + U1.

## Verification

Full repo suite + biome lint green; per-task and whole-branch code review (incl. a
dedicated G7 review whose Important findings — pending-map leak, nullable-type exclusion,
walk-depth scope — were fixed or documented before merge).
