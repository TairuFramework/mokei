# Quick follow-ons — complete

**Status:** complete
**Date:** 2026-09-30
**Branch:** `fix/decision-flow-quick-follow-ons`
**Origin:** small items from [decision-flow server follow-ons](../backlog/2026-09-29-decision-flow-server-follow-ons.md)
and [session elicitation follow-ons](../backlog/2026-09-29-session-elicitation-follow-ons.md). No spec or plan:
each item was small enough to implement directly from its backlog entry.

## Goal

Close the follow-ons from recent work that needed no design round, in one PR.

## Key design decisions

- **Uncompilable tool schemas are check issues.** A node whose catalogue tool input schema fails to compile gets
  `tool_invalid_schema` at `['nodes', id, 'tool']`, and its constant-argument check is skipped, so no spurious
  `tool_invalid_args` follows.
- **URL-mode completion is observer-only in `AgentSession`.** `notifications/elicitation/complete` flows
  `ContextClient` (`elicitationComplete`) to `ContextHost` (`elicitation:complete`, with the context key) to
  `AgentSession` (`elicitation-complete`). The agent event reaches `onEvent` and `events` but not run streams, since
  the notification may arrive after the run that prompted it ended. The listener is removed on dispose.
- **One observer publish path.** Every `AgentSession` event goes through the same publish step that ignores
  `onEvent` exceptions and rejected `events` listeners; observers cannot change a run's outcome.
- **Per-call cancellation.** `cancelToolCall(toolCallID?)` tracks one controller per call in flight. With an ID it
  cancels that call; without one it cancels every call in flight. A finishing call removes only its own controller,
  so concurrent runs no longer interfere. The no-argument form keeps the CLI's behaviour for a single run.

## What was built

- `@mokei/decision-flow-server`: `tool_invalid_schema` issue, with the two constant-argument checks merged.
- `@mokei/context-client`, `@mokei/host`, `@mokei/session`: URL-mode completion forwarding, observer isolation and
  per-call cancellation, with tests and README updates. The CLI turn reducer ignores the new event.
- Patch changesets for each.

## Follow-ons

Recorded in the origin backlog files. New: `ContextServer` cannot send `notifications/elicitation/complete` through
its typed `notify`; add it for `2025-11-25` connections only. Still blocked: the hard-coded decision-flow server
version and the tracer version (no JSON import attributes in the build, no portable version constant).
