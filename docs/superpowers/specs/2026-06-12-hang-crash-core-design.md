# Hang/crash core — design

**Source plan:** `docs/agents/plans/next/2026-06-12-hang-crash-core.md`
**Date:** 2026-06-12
**Decisions:** one PR; init-timeout default + opt-in request timeout; full host
lifecycle events; stdio framing limits deferred to enkaku upstream (ask filed).

## Problem

A child MCP server that crashes, exits non-zero, never answers `initialize`, or
writes stray output to stdout either kills the host process (unhandled rejection)
or parks callers forever. CLI symptoms: `/context add bad-server` freezes chat,
`mokei inspect <bad-command>` crash-dumps, first chat message with an unreachable
provider endpoint hard-crashes the TUI.

## 1. context-rpc core (`packages/context-rpc/src/rpc.ts`, `error.ts`)

- **New error type** `TransportClosedError extends Error` (exported from
  `error.ts`, carries optional `cause`). Used for every pending-request rejection
  caused by transport death or dispose.
- **Read loop**: replace the recursive fire-and-forget `handleNext()` (lines
  83-98) with a caught while-loop:
  - `_read()` rejection or `done` → `#endPendingRequests(reason)`: reject every
    `#sentRequests` controller with `TransportClosedError`, clear the map, then
    call the protected hook `_onTransportClosed(reason?: Error)` (no-op in the
    base class; subclasses surface it).
  - Response writes (`this._write(response)`) awaited inside try/catch; a failed
    response write is caught and logged-not-thrown — transport death surfaces via
    the next read.
- **`#sentRequests` hygiene**: delete the entry in both resolve and reject
  branches (lines 136-147). The abort listener's existing `!= null` guard then
  makes `cancel()` after completion a no-op (no bogus `notifications/cancelled`).
  Add `.catch(() => {})` on the `this.notify('cancelled', …)` call (line 214).
- **Opt-in request timeout**: `request(method, params, options?: { timeout?:
  number })`. When set, `AbortSignal.timeout(ms)` triggers the existing abort
  path, rejecting with a typed `RequestTimeoutError` (exported from `error.ts`,
  alongside `TransportClosedError`). No default at the RPC layer — the
  agent loop owns default turn/tool timeouts; a default here would double-timeout
  long tool calls.
- **Dispose**: dispose runs `#endPendingRequests(new TransportClosedError(
  'Transport disposed'))` before `transport.dispose()`.

## 2. context-client initialize (`packages/context-client/src/client.ts`)

- `ClientParams.initializeTimeout?: number`, **default 30_000 ms**. The init
  read phase races `AbortSignal.timeout`; on expiry throw
  `Error('Server did not respond to initialize request within <ms>ms')`. The
  transport is left for its owner (host/session) to dispose — matches current
  ownership (`createHostedContext` disposer owns the transport).
- **Read until matching id** (today line 186 hard-fails on any first frame that
  isn't the init response). Loop `_read()`; drop non-matching pre-init messages
  (spec says the server shouldn't send them; tolerating beats hard-failing).
- **Error responses handled** (today line 194 casts `undefined` to
  `InitializeResult`): `'error' in response` → throw
  `RPCError.fromResponse(response)`.
- `ClientEvents` gains `closed: { error?: Error }`, emitted from the
  `_onTransportClosed` override.
- Out of scope (conformance backlog): protocolVersion check of the result.

## 3. host lifecycle (`packages/host/src/spawn.ts`, `host.ts`)

- **spawn.ts**: delete the rethrowing `subprocess.catch` (lines 38-42) entirely.
  `SpawnedContext` already exposes `subprocess`; settle handling moves to the
  caller. `isSubprocessExit` stays (used by the new settle handler).
- **ContextHost events**: `#events: EventEmitter<HostEvents>` (`@enkaku/event`),
  public `events` getter:

  ```ts
  type HostEvents = {
    'context:added': { key: string }
    'context:removed': { key: string }
    'context:failed': { key: string; error: Error }
  }
  ```

- **Settle wiring** (in `addLocalContext`, where the key is known): attach one
  handler to `subprocess` settle —
  - resolved (clean exit) or rejected with `isSubprocessExit` (our own
    dispose-kill) → quiet; still `remove(key)` if the context is registered, so
    state stays consistent when a server exits cleanly on its own.
  - rejected otherwise (non-zero exit, ENOENT, OOM-kill) → emit
    `context:failed { key, error }`, then `remove(key)` (tolerant if already
    removed). `remove` disposes the transport → read loop ends → pending
    requests reject with `TransportClosedError`.
  - The settle handler catches everything: no path leaves an unhandled
    rejection.
- `add*Context`/`remove` emit `context:added`/`context:removed`.

## 4. session

No re-emit layer: consumers subscribe via the existing `session.contextHost`
getter (`session.contextHost.events`). Add only if a UI-agnostic re-emit need
appears later.

## 5. CLI (`packages/cli`)

- **loadModels retry + catch** (`ChatApp.tsx:48-57`): clear
  `modelsPromiseRef.current` on rejection (so a later attempt retries instead of
  replaying the cached rejection); both `await loadModels()` call sites in
  `useSlashCommands.ts` (message path line ~55, `/model` line ~128) get
  try/catch → `pushEntry` error notice ("failed to list models: <message> —
  check endpoint/API key, then retry").
- **Footer submit**: `ChatApp` wraps the handler passed to `Footer` so the
  async `useSlashCommands` callback is always `.catch`-ed → `pushEntry` error
  notice. `FooterProps.onSubmit` stays `(value: string) => void`.
- **Context-failed notices**: `ChatApp` `useEffect` subscribes to
  `session.contextHost.events` for `context:failed` / `context:removed` →
  `pushEntry` notice ("context <key> failed: <message>" / "context <key>
  removed"). Unsubscribe via AbortSignal on unmount. Suppress the `removed`
  notice when it follows a user-initiated `/context remove` (already has its own
  notice) — gate on key being in the confirm flow, or accept the duplicate
  notice for v1 (implementer's call; duplicate is acceptable).
- **Top-level catch** (`index.ts run()`): wrap `program.parseAsync` — on error
  print `✘ <error.message>` to stderr, full stack only when `MOKEI_DEBUG=1` (or
  `--debug` if trivially threadable through commander), `process.exitCode = 1`.
  Add a `process.on('unhandledRejection')` last-resort handler with the same
  formatting in `bin/run.js` (belt for anything missed).
- **Launcher exit** (`ChatLauncher.tsx:50-56`): error branch sets
  `process.exitCode = 1` and calls `exit()` from an effect after rendering the
  error (ink persists output after unmount).

## 6. enkaku ask (stdio framing limits — deferred)

`NodeStreamsTransport` hardcodes `fromJSONLines()` with no options;
`FromJSONLinesOptions` (`maxBufferSize`, `maxMessageSize`, `onInvalidJSON`)
exists in `@enkaku/stream` but isn't threaded through. Upstream-first decision:

- Write an ask doc in the `../enkaku` checkout (house convention — docs, not
  GitHub issues): add `streamOptions?: FromJSONLinesOptions` to
  `NodeStreamsTransportParams`, threaded into `createTransportStream`.
- Mokei wiring in `spawnHostedContext` is deferred until that lands; the plan
  file keeps item 6 as a follow-up with a pointer to the ask.

## 7. Testing

Vitest; in-process `DirectTransports` pattern (see `context-client/test/lib.test.ts`).

- **context-rpc** (new `test/` dir): loop-end rejects pending with
  `TransportClosedError`; entries deleted on response; `cancel()` after
  completion sends no `notifications/cancelled` (assert via transport spy);
  opt-in timeout rejects and sends cancel; dispose rejects pending.
- **context-client**: init timeout fires (transport that never responds); init
  error response throws `RPCError`; notification before init response is
  tolerated; `closed` event emitted on transport end.
- **host**: spawn `node -e 'process.exit(1)'` → no unhandled rejection (guard
  via `process.on('unhandledRejection')` spy in the test), `context:failed`
  emitted, context removed; clean dispose stays quiet (no `context:failed`).
- **CLI**: unit-test the loadModels retry path; manual PTY QA pass over the real
  binary (rebuild dist first) for the three crash scenarios: unreachable
  provider endpoint on first message, `/context add` with a failing command,
  `mokei inspect nonexistent-command`.

## Out of scope

SIGTERM→SIGKILL escalation, session races, notification buffering
(`backlog/2026-06-12-host-session-lifecycle.md` — note there that
`context:removed`/`context:failed` events land here); protocolVersion check
(`backlog/2026-06-12-mcp-2025-11-25-conformance.md`); item 6 wiring (enkaku).
