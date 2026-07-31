# MCP draft — remaining work

**Status:** backlog
**Origin:** `milestones/2026-06-08-mcp-draft-migration.md`. Consolidates the two prior
backlog files (deferred groundwork + breaking cut) down to live, unshipped work only.
Shipped groundwork (G1–G8, G5 outbound/baggage/inbound, G7 walk depth) is recorded in
`completed/2026-06-20-mcp-deferred-groundwork.complete.md` and the milestone — not repeated
here.

## 1. Deferred groundwork — last item

- **G7 part 5** — stale-schema fallback: on a `-32001` HeaderMismatch, refresh via
  `tools/list` and retry the `tools/call`. **Deferred:** no server emits HeaderMismatch
  today (no live draft server), and `-32001` already means `SESSION_EXPIRED_CODE` in mokei
  (`http-client/src/errors.ts`). Revisit only against a live draft peer; pick a
  non-colliding code then. Self-contained in `@mokei/http-client`. *Update 2026-07-02:*
  SDK v2 beta can now serve as the live draft peer (see
  `2026-07-02-mcp-sdk-v2-adoption.md`, interop tests item). *Update 2026-07-27:* the peer
  harness is in place (`integration-tests/support/interop/`, SDK `2.0.0-beta.5`), covering
  the `2025-11-25` era in all four client/server × stdio/HTTP combinations; the draft-era
  half lands with the B-wiring.

### Non-blocking polish (from final review — optional, not gating)

- Cache collected `x-mcp-header` annotations alongside the schema in `#toolSchemas`
  (`http-client/src/transport.ts`) to skip the per-`tools/call` walk recompute.
- Clarify the `collectHeaderAnnotations` error message for the `$ref`-wrapper-plus-target
  duplicate edge (currently reports "Duplicate", which misattributes the cause).
- Two `useLiteralKeys` Biome *infos* in `http-client/src/x-mcp-header.ts` (`node['…']` →
  `node.…`); lint gate passes (info-level), tidy if touching the file.

## 2. Additive draft wiring (B1–B7, opt-in coexistence)

**Blocked on draft finalization only** (external). U1 resolved + core shipped (PR #32) —
no mokei-side blocker. Not a hard-cut: mokei keeps `2025-11-25` and adds the draft as a
second version selected per context (see the milestone's Architecture decision). The
B-items are additive wiring behind a version selector, not removals. Implementing draft
payloads before the spec freezes risks rework.

*Update 2026-07-02:* the draft is now the **`2026-07-28` revision at RC stage** —
finalization expected July 28, 2026, with SDK v2 stable alongside. SDK v2 beta ships wire
codecs for the revision (`wire/rev2026-07-28/`), so B-item shapes can be pinned against a
reference implementation ahead of the freeze. Details in the milestone's status-update
section and `2026-07-02-mcp-sdk-v2-adoption.md`.

Scope, ordered by dependency:

1. **B5** remove `ping` — smallest; decouples the RPC core early. **Shipped for stdio,
   plan 1 (`feat/mcp-2026-07-28-core`):** `ContextRPC` no longer auto-answers `ping`; each
   protocol record's method table decides, and `2026-07-28` has no `ping`.
2. **B2** remove `initialize`/`initialized`; stateless `_meta` (version/identity/caps per
   request); version-mismatch error (SEP-2575). Foundational. **Shipped for stdio, plan 1:**
   `2026-07-28` has `requiresHandshake: false`; every request carries protocol version and
   client capabilities in `_meta` instead.
3. ~~**B3** add `server/discover` RPC (MUST) — advertises versions/caps/identity
   (SEP-2575).~~ **Shipped for stdio, plan 1.** Correction: the spec makes `server/discover`
   mandatory for the *server* to implement, not mandatory for a *client* to call — a client
   may still reach a `2026-07-28` server via the version it already knows. mokei's client
   uses it only to probe under `protocolVersion: 'auto'`.
4. **B1** remove protocol sessions + `Mcp-Session-Id` (SEP-2567); cross-call state →
   server-minted handles as tool args. **stdio never had a session concept, so nothing to
   remove there; the HTTP half (dropping `Mcp-Session-Id`) and the transport wiring land in
   plan 2.**
5. **B6** remove `logging/setLevel` + roots list-changed; per-request `_meta` log level.
   **Shipped for stdio, plan 1:** `2026-07-28`'s client method table has no
   `logging/setLevel`; log level travels in request `_meta` instead and log emission is
   scoped to the handling request.
6. **B7** MRTR — `inputRequests`/`inputResponses` replace server-initiated requests
   (SEP-2322). Deepest; dismantles bidirectional `request()`/`#sentRequests` in
   `context-rpc`. Depends on U1 + B2. **Not shipped:** plan 1 refuses
   `sampling/createMessage`, `elicitation/create` and `roots/list` at client/server setup on
   `2026-07-28` (`MRTRNotSupportedError`) rather than implementing MRTR itself.
7. **B4** `subscriptions/listen` replaces GET endpoint + `resources/subscribe` (SEP-2575).
   Rewrite HTTP server/client streaming. Depends on U1; parallel with B7.
   **Legacy-side `resources/subscribe` (folded from the retired `2026-07-02-mcp-feature-gaps.md`,
   gap 3):** the `2025-11-25` protocol types exist (`subscribeRequest` / `unsubscribeRequest` /
   `resourceUpdatedNotification` in `context-protocol/src/resource.ts`) but there are no client
   methods, no server dispatch, and no `resources.subscribe` capability declaration. Since mokei
   keeps `2025-11-25` per the coexistence decision, a legacy peer may still expect this surface.
   Implement it as the legacy-side branch of B4 only if a real peer needs it. (The
   `UnsubscribeRequest` alias typo that item flagged is already fixed, `d82dc9c`.)
8. **D1–D3** apply deprecation handling (Roots/Sampling/Logging; HTTP+SSE transport;
   `includeContext`) as the above land.

### B7 stream-arm follow-ons — **done 2026-07-27**

The U1 streaming arm + continuation store are built and unit-tested but have **no wire
trigger yet**; B4/B7 wire into the `_registerStreamExchange` seam they create
(`context-rpc` `exchange.ts` / `continuation.ts`). All five hardening items listed here
shipped ahead of that wiring, so the seam is ready to consume:

- `onSettle` now receives a `SettleReason` (`'result' | 'error' | 'cancel' | 'closed'`), so
  continuation teardown can tell a terminal frame from a local cancel or a transport close.
  `ContextRPC` folds it into the `clearForExchange` reason message.
- Malformed-response policy: `routeResponse` settles an exchange carrying neither a usable
  `result` nor a well-formed `error` as an internal `RPCError('Malformed response')` instead
  of deleting it while leaving the promise pending forever (the old `once`-arm leak). An
  `error` stream frame carrying a non-`Error` value is coerced; a frame of an unknown type is
  dropped **without** settling — only `result` and `error` frames are terminal.
- `isErrorResponse` in `error.ts` replaces the `as ErrorResponse` cast, so an `error: null` or
  a `code`/`message`-less error object is no longer read as an error response.
- Stream `cancel` / `endAll` / error-response / malformed-response `onSettle` paths are
  covered, plus settle-once-only under trailing frames.
- `ExchangeRegistry.#settle(id, exchange, reason, outcome)` dedups the delete +
  resolve/reject + `onSettle` blocks across all four settle sites.

Open when the wiring lands: nothing on the registry itself — the remaining decisions
(continuation state across reconnects, server-minted handles) live in the milestone's open
questions.

## Notes

- Re-read the milestone's "Open questions" (MRTR continuation state, `server/discover` STDIO
  probe semantics, server-minted handles) before starting B4/B7.
- Re-validate every B-item against the final spec before implementing draft payloads.
