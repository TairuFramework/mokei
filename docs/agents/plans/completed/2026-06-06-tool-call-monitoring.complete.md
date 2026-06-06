# Tool-Call Monitoring (hang / error / timeout) — Completed

**Status:** complete
**Completed:** 2026-06-06
**Origin spec:** 2026-06-03-tool-call-monitoring-design.md (ephemeral, removed)
**Branch:** feat/cli-refactoring

## Goal

Make in-flight tool calls observable and controllable in the Ink chat UI: show
elapsed time, warn when a call may be stuck, enforce a per-tool timeout so one
hanging MCP tool no longer blocks the whole turn, let the user cancel the active
tool call (contextual Esc), and present errors as a single line with full detail
on demand (`/details`).

## Key design decisions

- **No new event type.** Per-tool timeout and user-cancel are surfaced through
  the existing `tool-call-error` event carrying typed errors
  (`ToolCallTimeoutError`, `ToolCallCancelledError`); the UI discriminates by
  `error.name`.
- **Fixed default, no new flag.** Per-tool timeout defaults to 120000 ms,
  configurable via `AgentSessionParams.toolTimeout`; no `--tool-timeout` flag.
- **Single active call, not a concurrent list (YAGNI).** Execution is
  sequential, so the live region tracks one active call + its start time;
  completed calls already live in the transcript.
- **Per-call `AbortController`** combined with the turn signal via the existing
  `anySignal` pattern; cancelling it aborts only the tool, so the turn survives
  and proceeds to the next tool/iteration. Discriminated in the catch by abort
  reason sentinels (`TIMEOUT_REASON` / `CANCEL_REASON`).
- **Elapsed always shown; warn at 10s.** `running Ns`, turning red past the
  `HANG_WARN_MS` threshold with an "esc to cancel" hint. A `useElapsed` hook
  drives the 1s tick since no agent events fire while a tool hangs.
- **Contextual Esc:** `calling-tool` → cancel the active tool; `streaming` →
  abort the turn.
- **Error detail via `/details`.** `<Static>` can't toggle, so transcript errors
  are single-line; full text is retained and reprinted by a new `/details`
  command.

## What was built

`@mokei/session`: `toolTimeout` param + default, the two typed error classes,
`cancelToolCall()`, per-call timeout/cancel wiring in `#executeToolCall`.
`packages/cli`: reducer `activeToolCall` tracking, `useElapsed` hook,
`useAgentTurn.cancelTool`, updated `ToolCallStatus` / `PendingTurn` /
`ToolResultCard` / `HelpCard`, the `/details` store, and contextual-Esc wiring in
`ChatApp`. Covered by session, reducer, hook, and component tests.

## Out of scope (YAGNI)

Concurrent tool-call tracking; `--tool-timeout` flag; new event types; per-call
retry; inline transcript expand; cancelling a specific queued tool.
