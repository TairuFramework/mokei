# Hang/crash core — completed (partial)

**Status:** partial — 8 of 9 audit items shipped; item 6 (stdio framing limits)
extracted to `next/2026-06-12-stdio-framing-limits.md`.
**Date completed:** 2026-06-15
**Branch:** `plans/2026-06-12-audit-clusters` (commits `a9baed3..507a7c0`, +
follow-up tracking `e4ef573`).
**Source:** plan `superpowers/plans/2026-06-12-hang-crash-core.md`, design
`superpowers/specs/2026-06-12-hang-crash-core-design.md`, audit cluster
`next/2026-06-12-hang-crash-core.md`.

## Goal

Stop a misbehaving child MCP server (crash, non-zero exit, silent on
`initialize`, stray stdout) from crashing the host process or permanently
hanging callers, and stop the CLI from crash-dumping on those failures.

## Key design decisions (preserved from spec)

- **One PR, three layers** — fix at RPC core, client, and host rather than
  patching symptoms in the CLI.
- **Typed transport death** — a single `TransportClosedError` rejects every
  pending request when the transport dies or is disposed; `RequestTimeoutError`
  for timeouts. Both exported from `@mokei/context-rpc`.
- **Timeouts** — default `initialize` timeout (30s) in the client; opt-in
  per-request timeout in RPC core (off by default, no behavior change for
  existing callers).
- **Full host lifecycle events** — `ContextHost` emits
  `context:added`/`removed`/`failed`; a context whose child exits abnormally is
  reaped. (Downstream lifecycle items — SIGTERM escalation, session races,
  notification buffering — deliberately left to
  `backlog/2026-06-12-host-session-lifecycle.md`.)
- **Spawn never rethrows into an unowned promise** — the child-exit promise is
  consumed, so a crash can't surface as an unhandled rejection.
- **CLI** — consume rejected promises through existing error UX
  (model-list retry + in-chat notice, guarded Footer submit, `context:failed`
  surfacing) plus a top-level safety net (commander catch + `unhandledRejection`
  handler + launcher exit code).

## What was built

- **`@mokei/context-rpc`** — caught read loop rejecting pending requests on
  transport death/dispose; settled-request map hygiene (delete before
  resolve/reject); opt-in `request(..., { timeout })`; `TransportClosedError` +
  `RequestTimeoutError` exported. New `test/` suite.
- **`@mokei/context-client`** — hardened `initialize()`: timeout, read-until-
  matching-id (drops stray pre-init messages), throws on error responses;
  `closed` event on transport end; `request` override forwards `{ timeout }`.
- **`@mokei/host`** — `spawn` no longer rethrows (`isSubprocessExit` predicate);
  `ContextHost` lifecycle events + abnormal-exit reaping; `remove` TOCTOU fix
  (delete before dispose).
- **`mokei` CLI** — model-list retry + error notice, Footer-submit guard,
  `context:failed` notices, top-level error handling in `index.ts`/`bin`,
  launcher sets `process.exitCode = 1`.

## Verification

Full `pnpm build`, full test suite, and `rtk proxy pnpm run lint` all green.
PTY QA over the real binary passed all three crash scenarios (unreachable
provider on first message, `/context add` with a failing command,
`mokei inspect nonexistent-command`): friendly messages, correct exit codes,
no stack dumps, TUI survives.

## Remaining work (extracted)

- **Item 6 — stdio framing limits** → `next/2026-06-12-stdio-framing-limits.md`.
  Was deferred upstream-first; now unblocked by enkaku 0.17.0, which shipped the
  framing options **flat** on `NodeStreamsTransportParams` (correcting the
  design's nested-`streamOptions` assumption). Needs catalog bump 0.16→0.17 plus
  wiring `maxBufferSize`/`maxMessageSize`/`onInvalidJSON` into the host transport.
