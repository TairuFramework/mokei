# Session elicitation follow-ons

**Status:** open · follow-on of [session elicitation](../completed/2026-09-29-session-elicitation.complete.md)
**Packages:** `@mokei/host`, `@mokei/session`

## Items

- **URL-mode completion.** `2025-11-25` URL-mode requests reach the handler, but server
  `notifications/elicitation/complete` is not forwarded, so a UI cannot close a URL prompt when the server completes
  it. Forward it through the host and as an agent event.
- **Run-event observer isolation.** The general run-event path in `AgentSession` drops the `events.emit` promise and
  lets `onEvent` exceptions escape into the run. The elicitation events already isolate observer failures; apply the
  same treatment to every run event.
- **Per-run tool cancellation.** `cancelToolCall()` uses one agent-wide controller, so with two concurrent runs it
  cancels whichever tool call started last. Scope it per run or per tool call.
- **Host-level sampling and roots.** Same host-construction capability and override model as elicitation.
