# MCP draft — breaking cut (B1–B7, hard-cut to draft-only)

**Status:** backlog (blocked — draft unreleased + U1 unresolved)
**Origin:** `milestones/2026-06-08-mcp-draft-migration.md` — Phase 1.

## Gap

The draft removes the foundations mokei is built on: the `initialize` handshake,
protocol-level sessions, and server-initiated requests. There is no clean way to speak
both `2025-11-25` and the draft on one connection, so this is a **hard-cut to draft-only**.
Deferred until the draft finalizes (item shapes — method names, `_meta` keys, results —
may still change) and until upstream U1 lands.

## Scope (ordered by dependency)

1. **B5** remove `ping` — smallest; decouples the RPC core early.
2. **B2** remove `initialize`/`initialized`; stateless `_meta` (version/identity/caps per
   request); version-mismatch error (SEP-2575). Foundational.
3. **B3** add `server/discover` RPC (MUST) — advertises versions/caps/identity (SEP-2575).
4. **B1** remove protocol sessions + `Mcp-Session-Id` (SEP-2567); cross-call state →
   server-minted handles as tool args.
5. **B6** remove `logging/setLevel` + roots list-changed; per-request `_meta` log level.
6. **B7** MRTR — `inputRequests`/`inputResponses` replace server-initiated requests
   (SEP-2322). Deepest change; dismantles bidirectional `request()`/`#sentRequests` in
   `context-rpc`. Depends on U1 + B2.
7. **B4** `subscriptions/listen` replaces GET endpoint + `resources/subscribe` (SEP-2575).
   Rewrite HTTP server/client streaming. Depends on U1; parallel with B7.
8. **D1–D3** apply deprecation handling (Roots/Sampling/Logging; HTTP+SSE transport;
   `includeContext`) as the above land.

## Blockers

- **U1 (long pole):** decide the `@enkaku/transport` / `context-rpc` correlation model for
  stateless + MRTR. Spike recommendation: reimplement correlation in `context-rpc` above
  the existing duplex (stream-resolving `#sentRequests`, decoupled continuation-token
  store), leaving `@enkaku/transport` untouched. **Blocks B4 + B7.** Start in parallel with
  any remaining groundwork.
- Draft must finalize before implementing — re-validate every item against the final spec.

## Notes

- Pairs with `2026-06-09-mcp-draft-deferred-groundwork.md` (the non-breaking remainder).
- Re-read the milestone's "Open questions" before starting B4/B7.
