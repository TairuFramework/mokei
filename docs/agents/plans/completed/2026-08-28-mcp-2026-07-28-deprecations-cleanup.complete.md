# MCP `2026-07-28` — deprecations + cleanup (piece F)

**Status:** complete
**Completed:** 2026-08-28
**Branch:** `feat/mcp-2026-07-28-deprecations-cleanup`

Closes the last non-optional `2026-07-28` migration work (piece F of the migration milestone).
Five independent chores plus bookkeeping: deprecation documentation (D1–D3), two low-risk
protocol/transport tidy-ups, a disposing-server inbound gate, and a `client.ts` extraction. No
behaviour change except items C and B1 (and a subsequent robustness fix surfaced in review); B2
changes a runtime record shape but no runtime behaviour.

## What was built

- **A — D1–D3 deprecation documentation (docs/comments only).** Roots / sampling / logging
  (SEP-2577), the legacy transport surface, and `includeContext` are documented as deprecated on
  `2026-07-28` while remaining fully supported on the still-live `2025-11-25` revision. Comments in
  `sampling.ts`, `logging.ts`, and the relocated `CreateMessageHandler`/`ListRootsHandler` types;
  an authoritative "Deprecated on `2026-07-28`" section in the migration milestone; short notes in
  the http-server / http-client READMEs.
- **B1 — bounded schema-refresh timeout.** `HTTPTransport`'s internal stale-schema `tools/list`
  refresh now has its own budget, `DEFAULT_HTTP_REFRESH_TIMEOUT = 10_000` (overridable via a new
  `refreshTimeout?` transport param), independent of the request `timeout`, so a firing stale-schema
  retry can no longer chain three full request budgets (~90s at the default). Both are exported from
  the `@mokei/http-client` root.
- **B2 — derivable protocol booleans replaced by helpers.** `requiresHandshake` and
  `requiresPerRequestLogLevel` were removed from the `ProtocolDefinition` records and both revision
  literals, replaced by `isHandshakeRequired(protocol)` (`clientMethods.has('initialize')`) and
  `isPerRequestLogLevel(protocol)` (`!clientMethods.has('logging/setLevel')`) in
  `@mokei/context-protocol`, re-exported from its root. All read sites across cli, context-client,
  context-server, http-client, and http-server were migrated with polarity preserved.
- **C — disposing-server inbound gate.** A server that has begun `dispose()` now rejects a
  newly-dispatched inbound request with a distinct error instead of starting new work; notifications
  and in-flight/held responses still flush during the ≤5s window. The gate lives in the request
  branch of `ContextRPC._handleMessage`, guarded by a `#disposing` flag set synchronously at the top
  of `#dispose()` before the flush await.
- **B3 — `client.ts` shrink (1989 → 1640 lines).** Stage 1 extracted the seven error classes into
  `errors.ts` and the pure type aliases + `splitListOptions` into `types.ts`. Stage 2 extracted a
  `SetupReader` unit that drives the `initialize` / `server/discover` handshake behind a narrow
  five-method I/O adapter. The public export surface is unchanged throughout.
- **Bookkeeping.** Retired the piece-F backlog file, folded its still-open items into a deferrals
  backlog (see `2026-08-28-mcp-2026-07-28-cleanup-deferrals.md`), and marked the migration
  milestone's Phase 1 table (D1–D3, and the already-shipped B4 subscriptions) as complete.

## Key design decisions

- **D1–D3 is documentation-only, with no `@deprecated` tags on shared surfaces.** The affected
  types (roots/sampling handlers, logging types, `includeContext`) are served and fully supported on
  the live `2025-11-25` revision, so a compiler-level `@deprecated` tag would wrongly warn current
  consumers. The signal is plain comments plus milestone/README prose instead.
- **D2 is scoped to the legacy `2025-11-25` session GET/SSE stream only.** On `2026-07-28`
  notifications travel on the POST response (stateless); that current Streamable HTTP transport is
  **not** deprecated. Only the legacy session GET stream is the deprecated transport surface.
- **B2 shipped as a patch despite being a runtime record-shape change.** These fields have no known
  external consumers (pre-1.0, internal-only), so the maintainer chose a clean break at patch rather
  than a minor bump; the changeset documents the removal and the replacement helpers.
- **`isPerRequestLogLevel` derives per-request log level from the *absence* of `logging/setLevel`.**
  Sound for both current revisions; the helper's JSDoc records the invariant a future revision must
  satisfy (omitting `logging/setLevel` must mean per-request level, not "logging unsupported").
- **`SERVER_SHUTTING_DOWN = -32000` is a mokei extension, not an MCP-reserved code.** The reserved
  band is `-32020..-32099`, so `-32000` is free; it lets a peer distinguish "retry elsewhere, the
  server is shutting down" from a generic internal error. Documented as such at its definition in
  `@mokei/context-protocol`.
- **The `SetupReader` seam keeps buffer ownership in `ContextClient`.** The `#setupBuffer` /
  `#pendingSetupRead` unmatched-frame buffer never leaves `ContextClient`; `SetupReader` sees only
  the adapter closures. The extraction was gated on this: forcing setup logic behind callbacks that
  relocated the buffer would have been rejected as a leaky seam. The adapter's frame read uses a
  predicate-scan primitive (`takeBuffered(matches)`), not a naive FIFO — a FIFO would infinite-loop
  on a stray buffered frame; a regression test guards this.
- **Disposal awaits in-flight response writes before disposing the transport.** Surfaced by an
  independent (Codex) review of item C: the shutdown-rejection write was not tracked by the pre-close
  flush, so transport teardown could race it and the peer could see EOF instead of the `-32000`
  reply. `ContextRPC` now tracks in-flight writes in a `#pendingWrites` set and awaits them (bounded
  by the existing held-response flush deadline) both inside the flush and as a backstop immediately
  before `#transport.dispose()`. A delayed-write boundary test guards it.

## Verification

Full workspace green at completion: `pnpm build` (21/21), `rtk proxy pnpm run lint` (401 files
clean), and the full test suite — including the new coverage: protocol-helper derivation tests,
the `refreshTimeout` fake-timer test, the `SERVER_SHUTTING_DOWN` disposing-gate test, the
shutdown-write-race boundary test, export-surface guards for both http-client and context-client,
and the `SetupReader` predicate-scan suite (with the stray-buffered-frame case).

## Follow-on

Deferred items are tracked in `docs/agents/plans/backlog/2026-08-28-mcp-2026-07-28-cleanup-deferrals.md`:
the SSE reader-backpressure fix, the full per-revision `ServerRequest`/`ServerNotification` split,
the speculative host-level `auto`-resolution cache, and the two design notes (`-32020` has no
emitter; the CLI `-p` overload). Four cosmetic minor findings (a logging-note placement, a docblock
phrasing, a split import, plus the SetupReader doc-comment refs — the last already fixed) were
triaged as acceptable-to-defer by the whole-branch review.
