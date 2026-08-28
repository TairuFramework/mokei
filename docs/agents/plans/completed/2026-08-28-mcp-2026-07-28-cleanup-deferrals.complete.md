# MCP `2026-07-28` cleanup deferrals — SSE backpressure + per-revision server unions

**Status:** complete
**Completed:** 2026-08-28
**Branch:** `mcp-cleanup-deferrals`

Clears the two actionable items deferred out of the `2026-07-28` deprecations cleanup (see
`2026-08-28-mcp-2026-07-28-deprecations-cleanup.complete.md`): the SSE reader-backpressure fix
(§1) and the per-revision `ServerRequest`/`ServerNotification` split (§2). The three remaining
deferrals were decided against rather than scheduled — §3 host-level `'auto'` cache is YAGNI, and
§4 is two deliberate design notes — and stay recorded in
`docs/agents/plans/backlog/2026-08-28-mcp-2026-07-28-cleanup-deferrals.md`.

## What was built

- **§1 — SSE reader-backpressure, `@mokei/http-server`.** `createSSEStream` previously hand-built
  a `ReadableStream`+`WritableStream` pair whose `write()` enqueued synchronously and never
  consulted `desiredSize`, so a slow network reader grew the readable queue without bound (and the
  256-frame subscription bound only caught fast *producers*). It is now a demand-aware stream: the
  writable sink parks while the readable holds `highWaterMark` un-consumed frames
  (`SSE_STREAM_HIGH_WATER_MARK = 16` default) and resumes on the reader's `pull`, so a slow reader
  bounds the buffer instead. The `{ readable, writable }` shape is unchanged for the four consumers
  (session GET/POST streams, stateless exchanges, subscriptions); a third `release()` hook is added
  for teardown.

  **Resumption path (hardened over four review rounds).** A resuming GET replays its buffered
  snapshot; getting that right against backpressure took several iterations, converging on:
  size the stream to `max(SSE_STREAM_HIGH_WATER_MARK, replayEvents.length + 1)` so the awaited
  priming + replay never park (no deadlock for any configured `replayBufferSize`); publish
  `session.getStream` **synchronously before any `await`** so a superseding GET closes it (no
  orphaned stream) and live traffic routes to it (not dropped); gate live writes
  (`SSEWriter.deferLiveWritesUntil`) behind the replay so they land after the snapshot, never
  interleaved (interleaving would corrupt the resumption cursor); and record a live event to the
  replay index **before** the gate, so a gated write dropped by a mid-replay supersession stays
  recoverable on reconnect. Overlapping-GET resumption is abnormal and delivered best-effort, which
  is all SSE resumability promises.

  **Teardown.** A write parked on backpressure blocks `writer.close()` (writable close serializes
  behind it) and only a reader pull / `readable.cancel()` would otherwise wake it. `release()`
  sets the pair closed and wakes the parked write so `SSEWriter.close()` never wedges; the readable
  `close()` sink tolerates a prior `release()`/error via try/catch.

- **§2 — per-revision `ServerRequest`/`ServerNotification` split, `@mokei/context-protocol`.** The
  client side was already fully per-revision and `2026-07-28` owned its server-side unions;
  `2025-11-25` still borrowed the cross-revision `serverMessage` from `server.ts` — the last
  unsplit seam. `2025-11-25.ts` now defines its own `serverRequest` (ping, `sampling/createMessage`,
  `roots/list`, `elicitation/create`), `serverNotification` (the eight it may send, including
  `notifications/elicitation/complete`, which `2026-07-28` cannot), `serverResult`,
  `serverResponse`, and `serverMessage`; `PROTOCOL.serverMessage` points at the local union. The
  shared `server.ts` unions stay as the package's unqualified cross-revision convenience (still
  consumed by subscriptions runtime and tests), with a comment marking them as such and the stale
  `context-client/src/client.ts` validator comment corrected.

## Key design decisions

- **Not a `TransformStream`.** A `TransformStream` was tried first and rejected: cancelling its
  readable (a client disconnect) errors the joined writable, so every retained SSE writer's next
  `write()` *rejects* — erroring the server's outbound transport and skipping stream teardown. The
  hand-built pair keeps the `closed`-guarded no-op-after-cancel contract the consumers rely on.
- **Shared cross-revision server unions kept, not retired.** Fully removing `server.ts`'s unions
  would ripple across subscriptions runtime and many tests for no correctness gain; the per-revision
  split is what §2 required, and the shared unions remain a documented convenience.

## Review

Independent Codex adversarial review across four rounds surfaced six issues, each fixed with a
regression test: the original deadlock and transport-poisoning; a cursor-corrupting live/replay
interleave and a parked-write teardown leak; a live-message drop during replay and a concurrent-GET
orphan race; and a gated-write loss on GET supersession. `@mokei/http-server` 91 tests and
`@mokei/context-protocol` 151 tests pass; types and Biome clean.
