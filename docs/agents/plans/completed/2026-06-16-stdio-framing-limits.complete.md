# Stdio framing limits — completed

**Date:** 2026-06-16
**Status:** complete
**Branch:** `fix/stdio-framing`
**Spec:** `docs/superpowers/specs/2026-06-15-stdio-framing-limits-design.md` (removed on completion)
**Supersedes:** `docs/agents/plans/archive/2026-06-12-stdio-framing-limits.md` (hang/crash-core audit, deferred item 6)

## Goal

Bound a child MCP server's stdout framing so a misbehaving server can't exhaust
host memory or silently hang the transport. Thread `@enkaku/stream` framing
limits into the host's per-context `NodeStreamsTransport`, and reap any context
whose stdout stream faults instead of letting later frames vanish.

## What was built

- **enkaku 0.17 bump.** Every `@enkaku/*` catalog entry → `^0.17.0` for the flat
  framing API (`maxBufferSize` / `maxMessageSize` / `onInvalidJSON` on
  `NodeStreamsTransportParams`). Required one consumer fix: `serve()` in
  `packages/host/src/server.ts` now passes `requireAuth: false` (0.17's
  `ServerAccessOptions` union forces an explicit choice; the host socket is local
  trusted IPC).
- **Framing wiring** (`packages/host/src/host.ts`). `spawnHostedContext` builds
  the transport with `maxBufferSize` (default 8 MiB), pass-through
  `maxMessageSize`, and an `onInvalidJSON` that turns any unparseable line into a
  stream error. A single seam — the transport's `readFailed` event — forwards
  every fatal framing fault to a new `onStreamError` callback. No child kill at
  this layer; the host's reap disposes the transport, which kills the child.
- **Host reap + dedup** (`ContextHost.addLocalContext`). `onStreamError` emits
  `context:failed` and reaps the context. Optional `maxBufferSize` /
  `maxMessageSize` overrides exposed on `AddLocalContextParams`.
- **Tests** (`packages/host/test/`). Real-subprocess framing tests: flood past
  `maxBufferSize`, stray non-JSON line, large valid passthrough (real
  `serveProcess` echo-server fixture), exactly-once dedup, plus an idle-flood
  backpressure test (see correction below). All host tests green (51).

## Key design decisions (preserved from spec)

- **Strict invalid-JSON policy.** Any unparseable stdout line is fatal: error the
  stream → reap the context, surfaced via `context:failed`. A server that can't
  speak clean JSONL is broken.
- **One knob, generous default.** `maxBufferSize` 8 MiB; `maxMessageSize`
  undefined (= buffer cap). Overrides optional on both spawn and add params.
- **Single teardown path.** `onInvalidJSON` only calls `controller.error(...)`;
  buffer-overflow already errors the stream. Both converge on `readFailed` → one
  reap handler.
- **Two dedup guards** keep `context:failed` to exactly one emit: skip a
  `readFailed` that lands after the entry is already gone (teardown noise), and a
  `framingError` flag so the kill-triggered `onExit` doesn't double-emit. Relies
  on `remove()` being delete-before-dispose (prior hardening commit `57d104b`).

## Correction discovered during implementation

The spec's "Read-loop timing" premise — that the client read loop is **lazy**
and starts only on the first request — is **wrong**. `ContextClient` starts its
read loop eagerly in the constructor. The premise's *conclusions* still hold, but
for a different reason, established empirically during code review:

- The read loop does **not** drain the child's stdout on its own. With no
  consumer (no `setup`/`callTool` driving requests), the child's output is held
  by **OS pipe backpressure** — bounded by the kernel pipe buffer, not host
  memory. An idle, unused server therefore cannot overflow the framer or exhaust
  the host, and correctly produces no fault.
- A genuine framing fault only surfaces while the host is **actively reading**,
  at which point the context entry is still registered — so `context:failed`
  fires correctly. A code-review concern that a flooding-then-exiting child could
  be reaped without a fault was investigated and disproven: that path has no
  fault to swallow (the flood is backpressured/unread). The misleading "teardown
  noise" guard comment was rewritten to document the real mechanism, and a
  regression test locks in idle-flood backpressure behavior.

## Out of scope

- HTTP contexts (`HTTPTransport`) and direct/in-process contexts (`DirectTransports`)
  — no stdout framer.
- Per-message (`maxMessageSize`) dedicated test — intentional YAGNI; overflow is
  covered by `maxBufferSize`.

## Follow-on

- CLI / `Session` don't yet surface `maxBufferSize` / `maxMessageSize` overrides
  to end users (every context uses the 8 MiB default). Low priority — see
  `docs/agents/plans/backlog/`.
