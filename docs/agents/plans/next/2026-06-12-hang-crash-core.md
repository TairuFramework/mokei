# Hang/crash core — RPC, spawn, initialize, CLI symptom ends

**Status:** next (critical — one failure class crashes or permanently hangs host + CLI)
**Origin:** 2026-06-12 full audit (security, stability, usability, MCP-spec).

## Gap

A child MCP server that crashes, exits non-zero, never answers `initialize`, or writes
stray output to stdout either kills the host process (unhandled rejection) or parks
callers forever (no timeouts, read loop dies silently, pending requests never rejected).
The CLI surfaces this as the known hang/crash class: `/context add bad-server` freezes
chat; `mokei inspect <bad-command>` crash-dumps; first chat message with an unreachable
provider endpoint hard-crashes the TUI. Fix the library core first, then the CLI ends.

## Scope (ordered by dependency)

1. **spawn.ts rethrow crash** — `packages/host/src/spawn.ts:38-42`:
   `subprocess.catch((err) => { if (!isSubprocessExit(err)) { throw err } })` re-throws
   into a promise nobody holds; `isSubprocessExit` only covers SIGINT/SIGTERM, so any
   exit-code-1/segfault/OOM child is an unhandled rejection that terminates the host.
   Route the failure into the context lifecycle (emit/dispose/log) instead.
2. **RPC read loop error handling** — `packages/context-rpc/src/rpc.ts:83-98`:
   `handleNext()` is fire-and-forget with no catch; a transport/framing error is an
   unhandled rejection and silently kills the loop. `this._write(response)` (line 91)
   also un-awaited/un-caught. Wrap loop body, surface a transport-error event, and on
   loop end (done or error) reject all pending `#sentRequests`.
3. **`#sentRequests` leak + bogus cancels** — `packages/context-rpc/src/rpc.ts:136-147`:
   entries never deleted on response (unbounded growth; `cancel()` after completion
   sends a spurious `notifications/cancelled`). Delete in the resolve/reject branch.
4. **Request timeout + dispose rejection** — `packages/context-rpc/src/rpc.ts:51-64,201-228`:
   no per-request timeout, and `dispose` doesn't reject in-flight requests — a tool call
   to a dead server hangs callers forever. Reject all pending on dispose/loop-end; add an
   optional per-request timeout.
5. **Client initialize hardening** — `packages/context-client/src/client.ts:161-198`:
   `#initialize()` awaits one `_read()` with no timeout (server that never replies parks
   everything, since `_write` awaits `#initialized`); hard-fails if a notification
   arrives before the init response (line 186); an *error* response passes the `id`
   check and is cast to `InitializeResult` (line 194), silently swallowing the failure.
   Add init timeout, loop reads until the matching id, handle `error` responses.
6. **Stdio framing poisoning** — `packages/host/src/host.ts:93`: `NodeStreamsTransport`
   uses `fromJSONLines()` with no `maxBufferSize`/`maxMessageSize`/`onInvalidJSON`. A
   child printing non-JSON to stdout grows the buffer unboundedly; one stray line with
   an unbalanced `{`/`[` leaves `nestingDepth > 0` forever and all later frames hang
   silently. Pass the limits and an `onInvalidJSON` handler when constructing the
   transport in `spawnHostedContext`.
7. **CLI model-list crash path** — `packages/cli/src/chat/ChatApp.tsx:48-57` +
   `useSlashCommands.ts:55,128` + `components/Footer.tsx:36-39` (PTY-verified): first
   message with unreachable endpoint / bad key / Ollama down → raw ky stack dump, exit 1.
   `modelsPromiseRef` caches the rejected promise (no retry); `await loadModels()` has no
   try/catch; Footer fires `onSubmit(v)` without `.catch`. Catch in callers, push an
   error notice, clear the ref on rejection, `.catch` the Footer submit.
8. **CLI top-level error handling** — `packages/cli/src/index.ts` / `bin/run.js`: no
   top-level rejection handler, so library failures crash-dump (e.g. `mokei inspect
   nonexistent-command` prints the friendly error *then* a `SubprocessError` stack).
   Add a top-level catch printing `error.message` only (stack behind `--debug`).
   Largely mitigated by item 1, but the safety net should exist regardless.
9. **Launcher error exit** — `packages/cli/src/chat/ChatLauncher.tsx:50-56`: on
   `buildChat` rejection the error renders but the app never exits and `process.exitCode`
   stays 0. Call `exit()` and set `process.exitCode = 1`.

## Notes

- Verified solid in the audit (don't touch): agent-loop guards (max iterations, turn/
  tool timeouts, abort racing, hallucinated-tool rejection), tool-approval flow,
  received-request cancellation in `ContextRPC`, JSON-lines parser logic itself (item 6
  is a configuration gap, not a parsing bug).
- Medium/low lifecycle items (SIGTERM escalation, session races, notification buffer)
  are in `backlog/2026-06-12-host-session-lifecycle.md` — keep this file to the
  crash/hang class so it ships as one focused PR (or two: library 1–6, CLI 7–9).
