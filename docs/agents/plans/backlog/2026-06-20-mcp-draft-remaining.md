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
  non-colliding code then. Self-contained in `@mokei/http-client`.

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

Scope, ordered by dependency:

1. **B5** remove `ping` — smallest; decouples the RPC core early.
2. **B2** remove `initialize`/`initialized`; stateless `_meta` (version/identity/caps per
   request); version-mismatch error (SEP-2575). Foundational.
3. **B3** add `server/discover` RPC (MUST) — advertises versions/caps/identity (SEP-2575).
4. **B1** remove protocol sessions + `Mcp-Session-Id` (SEP-2567); cross-call state →
   server-minted handles as tool args.
5. **B6** remove `logging/setLevel` + roots list-changed; per-request `_meta` log level.
6. **B7** MRTR — `inputRequests`/`inputResponses` replace server-initiated requests
   (SEP-2322). Deepest; dismantles bidirectional `request()`/`#sentRequests` in
   `context-rpc`. Depends on U1 + B2.
7. **B4** `subscriptions/listen` replaces GET endpoint + `resources/subscribe` (SEP-2575).
   Rewrite HTTP server/client streaming. Depends on U1; parallel with B7.
8. **D1–D3** apply deprecation handling (Roots/Sampling/Logging; HTTP+SSE transport;
   `includeContext`) as the above land.

### B7 stream-arm follow-ons (do when wiring MRTR into the dormant streaming seam)

The U1 streaming arm + continuation store are built and unit-tested but have **no wire
trigger yet**; B4/B7 wire into the `_registerStreamExchange` seam they create
(`context-rpc` `exchange.ts` / `continuation.ts`).

- Thread a settle **reason** through `onSettle` (currently arg-less) so continuation
  teardown can distinguish result / error / cancel / transport-close.
- Decide the malformed-frame / malformed-response policy on the stream arm (the `once` arm
  relies on `routeResponse` shape; a stream `result`/`error` frame has no equivalent guard).
- Add stream `cancel` / `endAll` `onSettle` tests (only the terminal-frame settle path is
  covered today).
- Add an `ErrorResponse` narrowing guard for the `as ErrorResponse` cast in `routeResponse`.
- Consider a `#settle(exchange)` helper in `ExchangeRegistry` to dedup the repeated
  delete + resolve/reject + `onSettle?.()` blocks.

## Notes

- Re-read the milestone's "Open questions" (MRTR continuation state, `server/discover` STDIO
  probe semantics, server-minted handles) before starting B4/B7.
- Re-validate every B-item against the final spec before implementing draft payloads.
