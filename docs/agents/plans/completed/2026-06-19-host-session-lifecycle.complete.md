# Host + session lifecycle robustness

**Status:** complete
**Origin:** 2026-06-12 full audit (security, stability, usability, MCP-spec).

## Gap

Medium-severity lifecycle gaps below the crash/hang class (which is in
`next/2026-06-12-hang-crash-core.md`): children not reliably reaped, abort races that
orphan processes or let concurrent chats slip guards, unbounded notification buffering,
and a handful of state races between async setup and removal.

## Scope

### host

1. **SIGTERM escalation** — `packages/host/src/host.ts:96-99`: `dispose` sends
   `childProcess.kill()` fire-and-forget; a child ignoring SIGTERM survives as an
   orphan and `remove()` reports success before exit. Await exit with a deadline, then
   SIGKILL.
2. **Daemon server floating writes + child-exit cleanup** —
   `packages/host/src/server.ts:42,73-110`: `writer.write(msg)` un-awaited (a
   disconnected monitor turns event fan-out into unhandled rejections); a child that
   exits on its own never leaves `activeContexts`, emits no `context:stop`, and proxy
   clients hang. Catch write failures and unsubscribe; listen for child `exit`.
3. **setup/remove race** — `packages/host/src/host.ts:386-396`:
   `this._contexts[key].tools = contextTools` throws TypeError if the context was
   removed while `listTools` was in flight. Re-check existence after the await.
4. **Local tool cancellation is a no-op once started** —
   `packages/host/src/host.ts:446-471`: `cancelled` flag only checked before `execute`
   begins; tools get no abort signal. Plumb an AbortSignal into `LocalToolExecute`.
5. **Monitor pipe failure + dispose on locked streams** —
   `packages/host-monitor/src/index.ts:50-61`: `decoupled` has no rejection handler
   until `dispose` awaits it (daemon disconnect = unhandled rejection crash); `dispose`
   calls `.close()` on writables locked by active `pipeTo`s (throws). Attach a catch at
   creation; cancel pipes via AbortSignal.

### session

6. **addContext abort race orphans the child** —
   `packages/session/src/session.ts:174-181`: on abort, `remove(params.key)` is
   fire-and-forget while `#setupContext` is still running; if abort lands before
   `addLocalContext` registers (host.ts:324), the spawn completes later and leaks a
   live child the caller believes cancelled. Await/catch the removal and re-check after
   `#setupContext` settles.
7. **`#activeChatRequest` clobber** — `packages/session/src/session.ts:310-344`: an
   aborted chat's `finally` nulls the shared field after the replacing chat registered
   itself, so a third `chat()` passes the guard and runs concurrently. Only null if the
   field still references this call's request.
8. **Notifications stream buffers unboundedly** —
   `packages/context-client/src/client.ts:127-138,210`: every server notification is
   enqueued; nothing in host/session/CLI consumes `client.notifications`. A chatty
   server grows the queue for the context's lifetime. Drop when no reader, or bound it.
9. **`anySignal` listener leak** — `packages/session/src/agent-session.ts:678-690`:
   listeners never removed from caller-owned signals; long-lived signals across many
   `stream()` calls accumulate. Use `AbortSignal.any` or remove on settle. Same pattern
   in `llama-provider/src/provider.ts:274-276`.
10. **Abandoned event generator leaks provider stream** —
    `packages/session/src/agent-session.ts:142-520`: `finally` clears the turn timer
    but never calls `chatTurn.return()`; a consumer that `break`s leaves the provider
    HTTP stream open (CLI always drains; affects programmatic users).

### misc hardening

11. **Tool/prompt lookup resolves inherited props** —
    `packages/context-server/src/server.ts:250,263`: `#toolHandlers[name]` with
    `name = 'constructor'` passes the null-check and invokes `Object`'s constructor
    (malformed result, not RCE). Use `Map`/`Object.create(null)`/`Object.hasOwn`.
12. **Floating cancel notify** — `packages/context-rpc/src/rpc.ts:214`:
    `this.notify('cancelled', …)` unhandled if the write fails. Add `.catch`.

## Notes

- Item 12 may already land with the rpc work in `next/2026-06-12-hang-crash-core.md` —
  check before starting.
- Verified solid: agent-loop guards, tool-approval flow, received-request cancellation,
  CLI turn state (`useAgentTurn` single-turn enforcement, `finally` cleanup).

---

## Shipped — 2026-06-19 (`fix/session-lifecycle`)

All 11 live audit items landed (14 fix commits, `2d7e838`..`de83061`). **Item 12 was
already fixed** by the provider-robustness rpc work — verified before starting, so it
was out of scope. Executed via subagent-driven TDD: each item got a failing test, a
minimal fix, a per-task spec+quality review, and a fix loop where the review found gaps.

### host (Group 1)

1. **SIGTERM→SIGKILL escalation** (`2d7e838`) — `spawnHostedContext` dispose now awaits
   the real `exit`, sends SIGTERM, and escalates to SIGKILL after a `killTimeout` grace
   (default 5000ms, added to `SpawnHostedContextParams`). No-op if the child already
   exited.
2. **Daemon child-exit cleanup + guarded writes** (`3e08c74`) — a self-exiting spawned
   child now shares one `stopContext` teardown (guarded by a `stopped` flag) via both
   `childProcess.once('exit')` and the abort path: dispatches `context:stop`, prunes
   `activeContexts` + `children`. Event writes use a local `AbortController` that aborts
   the subscription on `writer.write` failure (no unhandled rejection).
3. **setup/remove race** (`3c1674d`) — `setup` throws `Context ${key} was removed during
   setup` instead of a TypeError. Guards both the `listTools` rejection window (the
   killed transport rejects the call) and the post-await `enableTools` window.
4. **Local tool AbortSignal** (`cada883`, completed `de83061`) — `LocalToolExecute`
   gains an optional `signal?: AbortSignal`; `callLocalTool(...).cancel()` aborts the
   signal handed to `execute`. The whole-branch review caught that `toolToLocalTool`
   (MCP-converted tools) still dropped the signal — `de83061` forwards it end-to-end.

### host-monitor (Group 1)

5. **Abort-driven pipe teardown** (`4fdbf03`, fix `1eeb896`) — new
   `wireMonitorStreams` seam: socket↔bridge piped with an `AbortController` signal,
   never `.close()` on a writable locked by an active `pipeTo`. The review fix made the
   exported `done` promise itself non-rejecting (in-place `.catch`, not a discarded
   derived promise) so a daemon disconnect can never surface as an unhandled rejection.

### session (Group 2)

6. **addContext abort orphan** (`d8b13f7`, fix `a9ebcb3`) — the brief's double-`remove`
   deadlocked (only `remove` unblocks the in-flight `listTools`), so the fix is an
   event-driven race: on abort, if the key is not yet registered, wait for either
   `context:added` (filtered to the key) or `setupPromise` settling, then `remove`. The
   review fix added an `AbortController` `signal` to the `once` so the listener is
   cleaned up regardless of which race branch wins.
7. **`#activeChatRequest` clobber guard** (`a692c82`) — `chat` captures its request in a
   local and only nulls `#activeChatRequest` in `finally` when it still references that
   request, so a replacing chat keeps ownership and a third concurrent `chat()` is still
   rejected.
8. **Bounded + drop-when-no-reader notifications** (`f1830c6`) — replaced the eager
   `createReadable` with a custom pull-based `ReadableStream` (`highWaterMark: 0`):
   notifications are dropped until a reader attaches, then at most
   `NOTIFICATION_BUFFER_CAP` (256) are buffered, dropping oldest on overflow.
9. **`anySignal` listener leak** (`8468ff7`) — delegates to `AbortSignal.any` (exported
   for testing). `llama-provider` already used `AbortSignal.any`, so no change there.
10. **Abandoned agent generator** (`b2516c8`) — the agent generator's outer `finally`
    now `.return()`s the in-flight `chatTurn`. Because enkaku `fromStream` only
    `releaseLock`s (never `cancel`s), `streamChatTurn` was rewritten to a manual reader
    loop that `reader.cancel()`s in its `finally`, so abandoning the stream actually
    closes the provider connection. (`streamChatTurn` is consumed only by the agent
    loop, not `chat()` — verified isolated.)

### misc hardening (Group 3)

11. **Inherited-prop lookup** (`f5cda27`) — both `#callTool` and `#getPrompt` guard with
    `Object.hasOwn`, so `constructor`/`__proto__`/`toString` names return a clean
    `INVALID_PARAMS` "not found" RPC error instead of a malformed result.

### Regression caught mid-branch

`784ee05` — Task 4's new `execute(args, signal)` arg broke the session package's
`local-tools.test.ts` exact-match assertion (`toHaveBeenCalledWith({input:'hello'})`);
Task 4's per-task review only ran the host suite, missing it. Assertion tightened to
expect the `AbortSignal` arg. (Lesson: cross-package test gaps — the full `pnpm test`
is the catch-all.)

### Gates

- `pnpm build`: 18/18 clean.
- `pnpm test`: full workspace green (host 64, session 61, cli 102, …), exit 0.
- `rtk proxy pnpm run lint`: clean, 285 files.
- Whole-branch review (opus): **Ready to merge — no Critical, no Important.** Verified
  the one worrying cross-cutting path (the brief's claimed `streamChatTurn`/`chat`
  sharing) does not exist, the addContext event-race is rejection-safe, and no fix
  introduces a new unhandled-rejection or listener-leak surface.

Plan: `docs/superpowers/plans/2026-06-18-host-session-lifecycle.md`.
Spec: `docs/superpowers/specs/2026-06-18-host-session-lifecycle-design.md`.

### Follow-ups (minor, non-blocking)

- Daemon `events` handler resolves its Promise only on `ctx.signal` abort, not on the
  local `sub` abort from a write failure — benign (a broken monitor aborts `ctx.signal`
  shortly after), worth tidying.
- A few timing-based tests (Task 1 200ms settle; Task 6 100ms settle; Task 8 50ms
  no-delivery probe) are wall-clock dependent; revisit with `vi.waitFor`/fake timers
  only if CI flake appears.
