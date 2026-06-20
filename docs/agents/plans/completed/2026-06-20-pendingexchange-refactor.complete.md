# PendingExchange correlation refactor (`@mokei/context-rpc`) — complete

**Status:** complete
**Date:** 2026-06-20
**Branch / PR:** `refactor/context-rpc-pending-exchange` → [PR #32](https://github.com/TairuFramework/mokei/pull/32) (bundled with G5 baggage + the U1/coexistence ADR)
**Relates to:** `milestones/2026-06-08-mcp-draft-migration.md` (Architecture decision / ADR) · `backlog/2026-06-09-mcp-draft-breaking-cut.md` (B7 plugs into this seam)

## Goal

Generalize `@mokei/context-rpc`'s single-deferred request correlation (`#sentRequests`)
into a reusable abstraction that supports both **resolve-once** (today's request/response)
and **streaming** exchanges, plus a **continuation-token store** for input sub-requests
correlated independently of the outer request id. This is the version-agnostic correlation
core (U1) the future MCP-draft tool-call path (MRTR / SEP-2322) plugs into.

## What was built

- **`exchange.ts`** — `ExchangeRegistry` owns the `id → PendingExchange` map and routing.
  `OnceExchange` arm is a 1:1 move of the prior `#sentRequests` logic; `StreamExchange` arm
  accepts interleaved frames (`progress` / `input-request` / terminal `result` | `error`)
  and settles on a terminal one. Methods: `registerOnce`, `registerStream`, `has`,
  `routeResponse`, `routeStreamFrame`, `cancel`, `endAll`.
- **`continuation.ts`** — `ContinuationStore` correlates input sub-requests by opaque
  `string` token, decoupled from the request-id slot. `register` / `route` (settle + delete)
  / `clearForExchange` / `clearAll`.
- **`rpc.ts`** — `#sentRequests` replaced by `#exchanges` + `#continuations`. New shared
  private `#startExchange(id, controller, method, params)` carries the abort-listener +
  write + return-handle logic for both `request()` and the internal stream seam. New
  package-internal `_registerStreamExchange()` (test-only; no wire trigger) following the
  `_read`/`_write`/`_handleMessage` convention.

## Key design decisions (rationale preserved from spec)

- **Behavior-preserving on `2025-11-25`.** The `once` arm is a 1:1 move; the streaming arm +
  continuation store are built and unit-tested with synthetic frames but have **no wire path
  producing stream frames yet**. The existing `context-rpc` / `context-client` /
  `context-server` / `host` suites are the behavior-preservation gate.
- **No public API change.** `request()`, `requestValue()`, `SentRequest`, `notify()`, and all
  `index.ts` exports are identical. `ExchangeRegistry` / `ContinuationStore` are NOT exported.
- **No `controller.abort()` on internal settle paths.** The signal stays internal (not
  exposed via `SentRequest`); it is aborted only by the consumer-facing `cancel`. Adding
  `abort()` in `cancel`/`endAll` would change behavior — deliberately not done (Task-2 review
  finding adjudicated as non-issue, confirmed by two independent whole-branch reviews).
- **Two zero-dependency units, registry decoupled from store.** Neither imports the other;
  the `onInputRequest` callback supplied at `registerStream` performs continuation
  registration, and `onSettle` triggers `clearForExchange` so no continuation outlives its parent.
- **No draft payloads.** Token is opaque `string`; `StreamFrame` is a mokei-internal shape,
  not a draft wire type — if the draft reshapes MRTR only the (internal) frame adapter changes.

## Status / verification

Shipped via 3 subagent-driven TDD tasks (`9f96935`, `a3481be`, `bb78c55`), two clean opus
whole-branch reviews. Green: context-rpc 20/20, context-client 29, context-server 35,
host 64; typecheck + lint clean. Follow-on work for the dormant streaming arm is logged
under B7 in `backlog/2026-06-09-mcp-draft-breaking-cut.md`.
