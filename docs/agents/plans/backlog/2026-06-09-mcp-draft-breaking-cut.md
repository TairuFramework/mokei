# MCP draft — additive draft wiring (B1–B7, opt-in coexistence)

**Status:** backlog (blocked on draft finalization only — U1 resolved)
**Origin:** `milestones/2026-06-08-mcp-draft-migration.md` — Phase 1.
**Superseded framing:** no longer a "hard-cut to draft-only." Per
`milestones/2026-06-20-u1-correlation-coexist-spike.md`, mokei supports `2025-11-25` and
the draft **side by side**, selected per context. The B-items become additive draft wiring
behind a version selector, not removals.

## Gap

The draft removes foundations the `2025-11-25` path uses (the `initialize` handshake,
protocol-level sessions, server-initiated requests) and cannot share a connection with it.
Coexistence handles this with a per-context version selector + a version-agnostic
correlation core (U1). The remaining blocker is that draft item shapes (method names,
`_meta` keys, results, `server/discover` / MRTR frame schemas) are **not yet finalized** —
implementing the draft payloads now risks rework. The behavior-preserving correlation
refactor (U1 core, no draft payloads) is buildable now; see the spike's "Buildable now"
section.

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

- **U1 — RESOLVED (2026-06-20).** Correlation model decided in
  `milestones/2026-06-20-u1-correlation-coexist-spike.md`: `PendingExchange`
  (resolve-once | streaming) + continuation-token store in `context-rpc`, `@enkaku/transport`
  untouched. The behavior-preserving refactor (U1 core) is buildable now on `2025-11-25`;
  the draft wiring for B4/B7 plugs into the seam it creates.
- **Draft finalization (only remaining blocker)** — re-validate every item against the
  final spec before implementing the draft payloads.

## Notes

- Pairs with `2026-06-09-mcp-draft-deferred-groundwork.md` (the non-breaking remainder).
- Re-read the milestone's "Open questions" before starting B4/B7.
