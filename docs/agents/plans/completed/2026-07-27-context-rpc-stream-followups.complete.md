# Stream-arm hardening (`@mokei/context-rpc`) — complete

**Status:** complete
**Date:** 2026-07-27
**Branch / PR:** `feat/context-rpc-stream-followups` (uncommitted at time of writing)
**Relates to:** `completed/2026-06-20-pendingexchange-refactor.complete.md` (built the seam this hardens) · `backlog/2026-06-20-mcp-draft-remaining.md` (B7 section, now marked done) · `completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md` (U1 correlation model)

## Goal

Close the five follow-on items left open when the U1 `ExchangeRegistry` streaming arm landed,
so the dormant `_registerStreamExchange` seam is ready to consume when B4/B7 wire MRTR
(SEP-2322) onto it. Spec-independent work: no draft payload shapes are touched, so nothing
here is invalidated by the `2026-07-28` spec freeze.

## What was built

- **Settle reason.** `SettleReason = 'result' | 'error' | 'cancel' | 'closed'` is passed to
  `StreamHandlers.onSettle`, which was previously arg-less. `ContextRPC`'s wrapper forwards it
  and folds it into the `ContinuationStore.clearForExchange` reason message, so continuation
  teardown can distinguish a terminal frame from a local cancel or a transport close.
- **Malformed-response policy.** `routeResponse` previously deleted an exchange whose response
  carried neither `result` nor `error`, settling nothing — the promise stayed pending forever,
  on both arms. It now settles as an internal `RPCError('Malformed response')`.
- **`isErrorResponse` guard** (`error.ts`) replaces the `as ErrorResponse` cast, so `error: null`
  or an error object missing `code`/`message` is not read as an error response.
- **Stream-frame robustness.** An `error` frame carrying a non-`Error` value is coerced; a frame
  of an unknown `type` is dropped without settling.
- **`ExchangeRegistry.#settle(id, exchange, reason, outcome)`** dedups the repeated delete +
  resolve/reject + `onSettle` blocks across all four settle sites; `endAll` iterates an entries
  snapshot rather than clear-then-loop.
- **Tests** for stream `cancel` / `endAll` / error-response / malformed-response settle reasons,
  settle-once under trailing frames, unknown frame type, stream frame against a `once` exchange,
  and non-`Error` coercion.

## Key design decisions

- **Malformed means settle, not drop.** The alternative (keep ignoring an unroutable response)
  preserves a real leak: the caller's promise never settles and the timeout path is the only
  escape. Settling as an internal error surfaces a misbehaving peer at the call site instead.
  Both arms get the same treatment — the `once` arm had the identical hole.
- **Only `result` and `error` frames are terminal.** An unknown frame type is dropped and the
  exchange stays pending, so a future frame kind added by the draft degrades to "ignored" rather
  than "kills the exchange" on an older peer.
- **Reason as a string union, optional at the callback.** No structural change to
  `StreamHandlers`; the arg is additive, so existing arg-less handlers stay valid.
- **Guard lives in `error.ts`, next to `RPCError.fromResponse`.** Not added to `index.ts` —
  `ExchangeRegistry`, `ContinuationStore` and now `isErrorResponse` all stay package-internal,
  preserving the no-public-API-change property of the original refactor.
- **Behavior-preserving on `2025-11-25`.** The stream arm still has no wire trigger; the
  existing suites are the gate.

## Status / verification

Green: `context-rpc` 32/32 (was 20), full workspace `pnpm test` clean, `pnpm build` 19/19,
lint clean, SDK v2 interop suites 4/4. Assertions checked non-vacuous by mutating the `cancel`
settle reason and confirming the suite fails. The integration-tests package has 17 failures in
this environment from missing external deps (Ollama on `localhost:11434`, node-pty
`posix_spawnp failed` for the CLI PTY drivers) — unrelated to this change.

No ephemeral spec/plan existed for this work — it was scoped directly from the B7 follow-on
list in the backlog, which has been rewritten in place to record what shipped. No follow-on work remains on the registry itself — the open
questions for the MRTR wiring (continuation state across reconnects, server-minted handles)
live in the milestone.
