# Host + session lifecycle robustness — design

**Date:** 2026-06-18
**Status:** approved, ready for implementation plan
**Origin:** `docs/agents/plans/backlog/2026-06-12-host-session-lifecycle.md` (2026-06-12 full audit)

## Summary

Close medium-severity lifecycle gaps below the crash/hang class (already shipped):
children not reliably reaped, abort races that orphan processes or let concurrent
chats slip guards, unbounded notification buffering, listener and stream leaks, and a
prototype-pollution-adjacent lookup. One robustness pass: one spec, one branch, one
implementation plan, 11 items in 4 thematic groups.

Item 12 from the backlog (floating cancel notify, `context-rpc/src/rpc.ts`) is **already
fixed** — both `this.notify('cancelled', …)` calls (lines 261, 271) carry `.catch(() => {})`,
landed with the hang-crash-core work. No action; recorded here for traceability.

## Decisions (from brainstorming)

- **Scope:** all live items in a single spec, grouped by theme.
- **Notifications policy (item 8):** bounded ring buffer (cap 256, drop oldest) **and**
  drop-when-no-reader — do not enqueue unless a reader is active; once reading, cap the queue.
- **Test rigor:** TDD all items (failing test first), using fakes for race/timing items.

## Conventions

Follow `docs/agents/conventions.md`: `type` not `interface`, `Array<T>` not `T[]`, no
`any`, `ID`/`HTTP` casing, `pnpm` only, never edit generated `lib/`. TDD via
`superpowers:test-driven-development`. Lint via `rtk proxy pnpm run lint`. Cross-package
vitest resolves built `lib/` — rebuild a dependency before testing a dependent.

## Group 1 — Host / monitor teardown (items 1–5)

### 1. SIGTERM → SIGKILL escalation
**Where:** `packages/host/src/host.ts:140-143` (`spawnHostedContext` dispose).
**Problem:** dispose calls `childProcess.kill()` fire-and-forget; a child ignoring SIGTERM
survives as an orphan and `remove()` reports success before the child exits.
**Fix:** dispose sends SIGTERM, awaits the child `exit` event with a deadline (5s default),
then escalates to `SIGKILL`. `remove()` resolves only after the child has actually exited.
**Test:** fake `ChildProcess` that ignores SIGTERM → assert SIGKILL fired after the deadline
and dispose awaited real exit; well-behaved child → exits on SIGTERM, no SIGKILL.

### 2. Daemon floating writes + child-exit cleanup
**Where:** `packages/host/src/server.ts:58` (un-awaited `writer.write`), `74-129` (spawn handler).
**Problem:** `writer.write(msg)` is un-awaited — a disconnected monitor turns event fan-out
into unhandled rejections. A child that exits on its own never leaves `activeContexts` /
`children`, emits no `context:stop`, and proxy clients hang.
**Fix:** wrap each `writer.write` in try/catch; on failure, abort that `events` subscription
(remove the listeners bound to `ctx.signal`). Add a child `exit` listener that deletes the
entry from `activeContexts` + `children` and dispatches `context:stop` (same cleanup the
abort path runs).
**Test:** child self-exits → `context:stop` emitted, both maps pruned; write to a
disconnected monitor → no unhandled rejection, subscription torn down.

### 3. setup/remove race
**Where:** `packages/host/src/host.ts:483` (`setup`).
**Problem:** `this._contexts[key].tools = contextTools` throws TypeError if the context was
removed while `listTools` was in flight.
**Fix:** re-check `this._contexts[key] != null` after the `listTools` await; if the context is
gone, throw a clear `Context ${key} was removed during setup` instead of assigning into the
deleted entry.
**Test:** remove a context during an in-flight `listTools` → `setup` rejects with the
removed-during-setup error, no TypeError.

### 4. Local tool AbortSignal
**Where:** `packages/host/src/local-tools.ts:8` (`LocalToolExecute`), `host.ts:539-561`
(`callLocalTool`).
**Problem:** `cancelled` flag is only checked before `execute` begins; a running local tool
gets no abort signal, so `cancel()` after start is a no-op.
**Fix:** `LocalToolExecute` gains an optional second parameter `signal?: AbortSignal`
(additive, non-breaking — existing zero/one-arg functions still satisfy the type).
`callLocalTool` creates an `AbortController`, passes `signal` into `execute`, and `cancel()`
aborts it (keep the pre-execute guard too).
**Test:** long-running local tool reading `signal` + `cancel()` mid-run → execute observes
abort; tool ignoring `signal` still works (back-compat).

### 5. Monitor pipe failure + dispose on locked streams
**Where:** `packages/host-monitor/src/index.ts:73-84`.
**Problem:** `decoupled` (the two `pipeTo`s) has no rejection handler until `dispose` awaits
it — a daemon disconnect surfaces as an unhandled-rejection crash. `dispose` calls `.close()`
on writables currently locked by active `pipeTo`s, which throws.
**Fix:** attach a `.catch` to `decoupled` at creation so a daemon disconnect is handled, not
fatal. Drive teardown via an `AbortController` passed to `pipeTo(..., { signal })` instead of
`.close()` on locked writables.
**Test:** simulate daemon disconnect (error the socket stream) → no unhandled rejection;
`dispose()` while pipes active → resolves without throwing.

## Group 2 — Session / client abort & state (items 6–10)

### 6. addContext abort orphans the child
**Where:** `packages/session/src/session.ts:174-181` (`addContext`).
**Problem:** on abort, `this.#contextHost.remove(params.key)` is fire-and-forget while
`#setupContext` is still running; if abort lands before `addLocalContext` registers the
context (`host.ts:324`), the spawn completes later and leaks a live child the caller believes
cancelled.
**Fix:** `await` and `.catch` the `remove`; after `#setupContext` settles under abort,
re-check whether the context registered late and remove it if so.
**Test:** abort before `addLocalContext` registers → no leaked child (host has no context for
the key after settle).

### 7. `#activeChatRequest` clobber
**Where:** `packages/session/src/session.ts:342-344` (`chat` `finally`).
**Problem:** an aborted chat's `finally` nulls the shared `#activeChatRequest` after the
replacing chat already registered itself, so a third `chat()` passes the guard and runs
concurrently.
**Fix:** in `finally`, null `#activeChatRequest` only if it still `===` this call's request.
**Test:** chat A aborted by chat B (`abortActiveRequest`), then chat C with no flag → C
rejects with "already active" (guard holds).

### 8. Notifications stream buffers unboundedly
**Where:** `packages/context-client/src/client.ts:155-168` (stream setup), `274-279`
(`_handleNotification`).
**Problem:** every server notification is enqueued; nothing in host/session/CLI consumes
`client.notifications`, so a chatty server grows the queue for the context's lifetime.
**Fix:** **drop-when-no-reader** — do not enqueue unless a reader is active; **bounded ring
buffer** — once reading, cap the buffered count at 256 and drop the oldest on overflow.
Track reader presence (e.g. via the readable's pull/cancel lifecycle or an explicit
subscriber count).
**Test:** 1000 notifications with no reader → buffered count stays 0 / flat memory; reader
attaches then 1000 arrive → reader receives a bounded set (≤256), oldest dropped.

### 9. `anySignal` listener leak
**Where:** `packages/session/src/agent-session.ts:678-690` (`anySignal`); same pattern in
`packages/llama-provider/src/provider.ts:274-276`.
**Problem:** listeners are added to caller-owned signals and never removed; long-lived signals
across many `stream()` calls accumulate listeners.
**Fix:** use `AbortSignal.any(signals)` where available, or remove the added listeners when
the combined signal settles.
**Test:** N sequential `stream()` calls sharing one long-lived signal → listener count on
that signal returns to baseline after each call settles.

### 10. Abandoned event generator leaks provider stream
**Where:** `packages/session/src/agent-session.ts` turn loop `finally` (the `chatTurn`
generator; backlog cites 142-520).
**Problem:** `finally` clears the turn timer but never calls `chatTurn.return()`; a consumer
that `break`s the agent event loop leaves the provider HTTP stream open. CLI always drains so
it is unaffected; programmatic consumers leak.
**Fix:** call `chatTurn.return()` (and any nested generators) in `finally` so an early
`break` propagates cancellation to the provider stream.
**Test:** consume the agent generator, `break` mid-stream → the underlying provider stream's
cancel/return is invoked (spy on a fake provider stream).

## Group 3 — Misc hardening (item 11)

### 11. Tool/prompt lookup resolves inherited props
**Where:** `packages/context-server/src/server.ts:258` (`#toolHandlers[name]`), `290`
(`#promptHandlers[name]`). Both are plain `Record<string, …>` objects.
**Problem:** a `tools/call` with `name = 'constructor'` (or `__proto__`, `toString`) passes
the null-check and invokes an inherited prototype member — a malformed result, not RCE.
**Fix:** guard lookups with `Object.hasOwn(map, name)` (or switch the handler maps to `Map` /
`Object.create(null)`).
**Test:** `tools/call` / `prompts/get` with `constructor`, `__proto__`, `toString` → clean
"not found" RPC error, no inherited member invoked.

## Testing & verification strategy

- **TDD per item:** write the failing test first, then the fix (`superpowers:test-driven-development`).
- **Fakes for races/leaks:**
  - mock `ChildProcess` as an `EventEmitter` with a `kill` spy (items 1, 2);
  - `DirectTransports` for client/server pairs (items 3, 8, 11);
  - hand-driven `AbortController` for abort timing (items 4, 5, 6, 7, 9, 10).
- **Observable proxies for leaks:** assert listener count returns to baseline (9), queue
  length stays bounded (8), kill-signal sequence (1), stream cancel/return invoked (10).
- **Gate before done:** `pnpm build`, `pnpm test`, `rtk proxy pnpm run lint` all green.
  Rebuild a dependency's `lib/` before running a dependent package's vitest.

## Risk / blast radius

- **Item 4:** public type change to `LocalToolExecute` — additive optional param, non-breaking.
- **Item 8:** behavior change for any future `client.notifications` reader (none exist today) —
  documented; pre-reader notifications are intentionally dropped.
- **Items 1, 5, 6:** teardown/abort timing changes — bounded by deadlines and covered by tests.
- **Packages touched:** `host`, `host-monitor`, `session`, `context-client`,
  `context-server`, `llama-provider` (6).

## Out of scope

- Crash/hang class (shipped — see `completed/2026-06-15-hang-crash-core.partial.md`).
- HTTP transport resilience (separate backlog item).
- Item 12 (already fixed).
