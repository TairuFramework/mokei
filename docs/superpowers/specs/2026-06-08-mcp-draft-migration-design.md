# MCP Draft Spec Migration — Gap Analysis & Migration Plan

**Date:** 2026-06-08
**Status:** Planning / spike (no production implementation)
**Baseline:** `2025-11-25` (current `LATEST_PROTOCOL_VERSION`)
**Target:** [MCP draft](https://modelcontextprotocol.io/specification/draft/changelog) (post-`2025-11-25`, unreleased)

## 1. Purpose & Scope

This document maps the gap between mokei's current MCP implementation (`2025-11-25`)
and the next draft revision, so we can plan the migration before the draft stabilizes.

It is a **planning artifact only** — no code changes are made as part of this spec.

Goals:

1. Identify every necessary change, mapped to mokei code.
2. Separate **breaking** changes (hard-cut) from **non-breaking groundwork** that can land now
   while keeping `2025-11-25` support.
3. Distinguish **core spec requirements** (MUST, needed for conformance) from
   **optional nice-to-haves** (SHOULD / MAY).
4. Surface **upstream (Enkaku) limitations** that must be resolved before the breaking phase.
5. Suggest an **ordering** for the work.

### Migration strategy: hard-cut

The draft removes the foundations mokei is built on (the `initialize` handshake, protocol-level
sessions, server-initiated requests). There is no clean way to speak both `2025-11-25` and the
draft on the same connection. The plan therefore assumes a **hard-cut** to draft-only for the
breaking work — but defers that cut until the draft is finalized. In the meantime, all
non-breaking groundwork lands on `2025-11-25` without disruption.

### Draft instability caveat

The draft is a moving target. Item details (method names, `_meta` keys, result shapes) may change
before release. Treat the breaking-phase plan as directional; re-validate against the final spec
before implementing.

## 2. Current Implementation Baseline

Anchors for the mechanisms the draft changes (see git history for full detail):

| Mechanism | Location |
|---|---|
| `initialize` request/response | `context-client/src/client.ts:154-176`, `context-server/src/server.ts:197-204` |
| `notifications/initialized` | `context-client/src/client.ts:171`, `context-server/src/server.ts:183-187` |
| Protocol version constant | `context-protocol/src/rpc.ts:3` |
| Capabilities schemas | `context-protocol/src/initialize.ts:15-112` |
| HTTP session (`Mcp-Session-Id`) | `http-server/src/session.ts`, `http-server/src/handler.ts:251-311`, `http-client/src/transport.ts:111-114` |
| GET endpoint / SSE stream + replay | `http-server/src/handler.ts:314-369`, `http-server/src/sse-writer.ts`, `http-client/src/transport.ts:180-220` |
| `resources/subscribe` / `unsubscribe` | schemas in `context-protocol/src/resource.ts:248-308` (server handlers not implemented) |
| `ping` | hardcoded in `context-rpc/src/rpc.ts:150-152`; schema `context-protocol/src/rpc.ts:250-267` |
| `logging/setLevel` + `notifications/message` | `context-protocol/src/logging.ts`, `context-server/src/server.ts:170-178,205-207` |
| Server-initiated requests (`roots/list`, `sampling/createMessage`, `elicitation/create`) | `context-protocol/src/{root,sampling,elicitation}.ts`, `context-server/src/server.ts:157-167` |
| Bidirectional RPC core | `context-rpc/src/rpc.ts` (symmetric duplex over `@enkaku/transport`) |
| `tools/list` / `prompts/list` / `resources/list` shapes | `context-protocol/src/{tool,prompt,resource}.ts` |
| Host orchestration / lifecycle | `host/src/host.ts:282-396` |

**Key structural fact:** `context-rpc` does *not* use the full Enkaku RPC framework
(`@enkaku/protocol`/`client`/`server`). It hand-rolls JSON-RPC over `@enkaku/transport`, a
**symmetric bidirectional duplex** stream — either side may issue requests and notifications, with
sent-request correlation via `#sentRequests`. This bidirectional model is exactly what the draft's
stateless + MRTR design dismantles.

**Not implemented in mokei (relevant for N/A items):**

- No `tasks/*` methods.
- No OAuth / authorization framework. `http-client/src/auth.ts` does static header injection only
  (bearer / basic / custom header).

## 3. Change Inventory

Legend:

- **Breaking?** — 🔴 breaking (hard-cut) · 🟢 non-breaking groundwork (land now) · 📋 deprecation (no code now) · ⚪ N/A (feature absent in mokei)
- **Requirement** — **MUST** (core spec conformance) · **OPT** (optional / SHOULD / MAY nice-to-have)

### 3.1 Breaking — core requirements (hard-cut phase)

| # | Change | mokei impact | Requirement |
|---|---|---|---|
| B1 | Remove protocol-level sessions and `Mcp-Session-Id` (SEP-2567) | Delete `http-server/src/session.ts` + `SessionManager`; remove session creation in `handler.ts`; remove client session capture in `transport.ts`. List endpoints no longer vary per-connection. Cross-call state → server-minted handles as ordinary tool args. | MUST |
| B2 | Remove `initialize`/`notifications/initialized`; make stateless. Every request carries `io.modelcontextprotocol/protocolVersion`, `clientInfo`, `clientCapabilities` in `_meta`. Version mismatch → `UnsupportedProtocolVersionError` (SEP-2575) | Rip out the handshake in client + server; rework `initialize.ts`; inject identity/version/caps into every outgoing request's `_meta`; add per-request version validation. Rework `host` setup which today relies on `client.initialize()`. Foundational. | MUST |
| B3 | Add `server/discover` RPC — servers MUST implement; advertises supported protocol versions, capabilities, identity (SEP-2575) | New server-side method + client-side caller. Replaces `initialize`'s negotiation role. Clients MAY call before other requests, or use as STDIO back-compat probe. **Necessary new addition.** | MUST |
| B4 | Replace GET endpoint + `resources/subscribe`/`unsubscribe` with `subscriptions/listen` — one long-lived POST-response stream; client opts into types (`toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions`); server tags with `io.modelcontextprotocol/subscriptionId` (SEP-2575) | Rewrite `http-server` GET handler + `sse-writer` into the `subscriptions/listen` model; rewrite client GET-stream logic in `transport.ts`. Request-scoped notifications (`progress`, `message`) stay on the originating request's response stream — **not** the listen stream. | MUST |
| B5 | Remove `ping` | Drop hardcoded handler at `context-rpc/src/rpc.ts:150-152` and schema. Trivial. | MUST |
| B6 | Remove `logging/setLevel` and `notifications/roots/list_changed`; log level set per-request via `io.modelcontextprotocol/logLevel` in `_meta`; server MUST NOT emit `notifications/message` for requests lacking this field | Remove `logging/setLevel` handling + `#clientLoggingLevel` state in `server.ts`; gate `notifications/message` on per-request `_meta` log level; remove roots list-changed notification. | MUST |
| B7 | **MRTR** (Multi Round-Trip Requests) replaces server-initiated requests. Servers return `inputRequests` (a result type) instead of calling `roots/list` / `sampling/createMessage` / `elicitation/create`; clients reply with `inputResponses` on the next request (SEP-2322) | **Deepest change.** Dismantles the bidirectional `request()` / `#sentRequests` model in `context-rpc`. Server can no longer initiate a request; instead returns `inputRequests` in a result and resumes when the client sends `inputResponses`. Requires new request-correlation / continuation state and reshaping `roots`/`sampling`/`elicitation` flows. | MUST |

### 3.2 Non-breaking groundwork — core requirements (land now on 2025-11-25)

These are MUST-for-conformance at the cut, but additive today: extra fields/headers that
`2025-11-25` peers ignore. Landing them early shrinks the breaking phase.

| # | Change | mokei impact | Requirement |
|---|---|---|---|
| G1 | `CacheableResult`: require `ttlMs` + `cacheScope` (`"public"`/`"private"`) on results of `tools/list`, `prompts/list`, `resources/list`, `resources/read`, `resources/templates/list` (SEP-2549) | Additive result fields. Add to result schemas + populate server-side. Clients ignore unknown fields on `2025-11-25`. | MUST |
| G2 | Require `Mcp-Method` and `Mcp-Name` headers on Streamable HTTP POST (SEP-2243) | Additive request headers in `http-client/src/transport.ts`. Harmless extras for current peers. (`x-mcp-header` custom-header support → OPT, see G7.) | MUST |
| G3 | Resource-not-found error code `-32002` → `-32602` (Invalid Params) | One-line constant change where resource-not-found is raised. Low-risk. Verified: mokei core raises no -32002; no code change. Regression guard added. Guidance: resource handlers should use -32602 for not-found. | MUST |

### 3.3 Non-breaking groundwork — optional nice-to-haves

| # | Change | mokei impact | Requirement |
|---|---|---|---|
| G4 | `extensions` field on `ClientCapabilities` + `ServerCapabilities` | Additive capability schema field; enables future extension support. | OPT |
| G5 | OpenTelemetry `_meta` trace-context keys (`traceparent`, `tracestate`, `baggage`) (SEP-414) | Wire `@enkaku/otel` (already provides traceparent format + context propagation) into outgoing `_meta`. Low effort, additive. See upstream U3. | OPT |
| G6 | `tools/list` SHOULD return tools in deterministic order (cache-hit friendliness) | Sort the server tools list before returning. | OPT |
| G7 | Custom headers from tool params via `x-mcp-header` (SEP-2243) | Additive header plumbing; pairs with G2. | OPT |
| G8 | Loosen `inputSchema`/`outputSchema` to any JSON Schema 2020-12 keywords; `structuredContent` any JSON value; add `$ref` resolution + composition-keyword resource bounds (SEP-2106) | Relax validation in `context-protocol` schemas. A relaxation (accept more, reject less) → non-breaking. Depends on `@enkaku/schema` 2020-12 + `$ref` support, see upstream U2. DEFERRED — blocked by U2 (enkaku/schema is draft-07). Implement after upstream switches to Ajv2020. | OPT |

### 3.4 Deprecations — no code change now

Track but don't build new functionality on these; plan removal in/after the cut.

| # | Deprecation | mokei note |
|---|---|---|
| D1 | Roots, Sampling, Logging deprecated (SEP-2577) | mokei implements all three (server-initiated). Migrations: tool params / resource URIs instead of Roots; direct LLM provider APIs instead of Sampling; stderr / OTel instead of Logging. Interacts with B6/B7. |
| D2 | HTTP+SSE transport reclassified Deprecated (SEP-2596) | mokei already uses Streamable HTTP — no SSE-transport code to retire. |
| D3 | `includeContext` values `"thisServer"`/`"allServers"` Deprecated (SEP-2596) | Audit `sampling` usage; omit or use `"none"`. |

### 3.5 Not applicable (feature absent in mokei)

| # | Change | Why N/A |
|---|---|---|
| N1 | Tasks moved to `io.modelcontextprotocol/tasks` extension; `tasks/get` polling, `tasks/update`, removal of `tasks/result`/`tasks/list` (SEP-2663) | mokei implements no `tasks/*` methods. Out of scope unless tasks adopted later (then implement as the extension). |
| N2 | OAuth: `iss` validation (RFC 9207, SEP-2468); DCR `application_type` (SEP-837); credential-issuer binding (SEP-2352); DCR deprecated in favor of Client ID Metadata Documents (PR #2858) | mokei has no OAuth / authorization framework; `auth.ts` is static header injection. Out of scope unless an MCP OAuth client is added. |
| N3 | `schema.json` number-type generator fix (PR #2710); SEP workflow / feature-lifecycle governance | Upstream spec-repo hygiene; no mokei code impact. Lifecycle policy informs how we stage D1–D3. |

## 4. Upstream (Enkaku) Limitations to Resolve

These must be answered/addressed before (or during) the breaking phase.

| # | Concern | Detail | Needed |
|---|---|---|---|
| U1 | Transport model vs stateless + MRTR | `@enkaku/transport` exposes a **symmetric duplex** `TransportType<In, Out>`; `context-rpc` assumes either side can initiate requests. Draft removes the persistent server→client channel (except `subscriptions/listen`) and replaces server-initiated requests with MRTR continuation. The current duplex contract maps awkwardly to: (a) request-scoped response streams, (b) a single opt-in subscription stream, (c) MRTR continuation state. | Decide whether `@enkaku/transport` gets a new contract / a new transport shape, or whether `context-rpc` reimplements correlation above it. **Blocks B4 + B7.** |
| U2 | `@enkaku/schema` JSON Schema 2020-12 + `$ref` | G8 requires accepting arbitrary 2020-12 keywords, `$ref` resolution, and composition-keyword bounds. `@enkaku/schema` is AJV-backed (2020-12 capable) but config/`$ref` resolution must be confirmed. | Confirm AJV config supports full 2020-12 + `$ref`; adjust if not. **Gates G8.** |
| U3 | `@enkaku/otel` `_meta` key mapping | G5 wants `traceparent`/`tracestate`/`baggage` in `_meta`. `@enkaku/otel` provides `formatTraceparent`/context propagation but uses its own token header fields (`tid`/`sid`). | Confirm/extend mapping to the draft's `_meta` key names. **Gates G5.** |

## 5. Suggested Ordering

No effort estimates — ordering and dependency only.

### Phase 0 — Groundwork (now, on 2025-11-25)

Independent, additive, shippable today. Suggested order within the phase:

1. **G3** resource error code — trivial, isolated.
2. **G6** deterministic `tools/list` order — isolated.
3. **G1** `CacheableResult` fields — schema + server populate.
4. **G2 + G7** required POST headers, then `x-mcp-header` plumbing.
5. **G4** `extensions` capability field.
6. **U2 → G8** confirm `@enkaku/schema` 2020-12/`$ref`, then loosen schemas.
7. **U3 → G5** confirm `@enkaku/otel` `_meta` mapping, then wire trace context.

### Pre-cut — Upstream resolution

8. **U1** resolve the Enkaku transport / RPC-core model for stateless + MRTR. **Blocks the breaking phase.** Should begin in parallel with Phase 0 since it is the long pole.

### Phase 1 — Breaking cut (draft-only, when draft finalized)

Ordered by dependency:

9. **B5** remove `ping` — smallest, decouples the RPC core early.
10. **B2** stateless `_meta` (version/identity/caps per request) + remove `initialize`/`initialized`. Foundational; everything below assumes it.
11. **B3** `server/discover` — depends on B2's capability/version model.
12. **B1** remove sessions / `Mcp-Session-Id` — depends on B2 (stateless requests no longer need session binding).
13. **B6** remove `logging/setLevel` + roots list-changed; per-request `_meta` log level — depends on B2's `_meta` plumbing.
14. **B7** MRTR — depends on **U1** and on B2; reshape roots/sampling/elicitation. Deepest; do after the `_meta` and discover groundwork is stable.
15. **B4** `subscriptions/listen` — depends on **U1**; rewrite of HTTP server/client streaming. Can proceed in parallel with B7 once U1 lands.
16. **D1–D3** apply deprecation handling consistent with the lifecycle policy as the above land.

## 6. Open Questions (for later phases, not this spike)

- MRTR continuation state: where does it live for STDIO vs HTTP, and how does it interact with cancellation (`notifications/cancelled`)?
- `server/discover` on STDIO: exact back-compat probe semantics vs version mismatch.
- Server-minted handles (replacing sessions): convention for passing them as tool args across mokei's `ContextHost`.
