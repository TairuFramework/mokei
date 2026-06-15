# Host + session lifecycle robustness

**Status:** backlog
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
