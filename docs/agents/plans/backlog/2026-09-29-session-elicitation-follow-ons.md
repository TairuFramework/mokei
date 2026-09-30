# Session elicitation follow-ons

**Status:** open · follow-on of [session elicitation](../completed/2026-09-29-session-elicitation.complete.md)
**Packages:** `@mokei/host`, `@mokei/session`

## Items

- **Host-level sampling and roots.** Same host-construction capability and override model as elicitation.
- **Server-side URL-mode completion.** `ContextServer` cannot send `notifications/elicitation/complete` through its
  typed `notify`. Add it for `2025-11-25` connections only, since `2026-07-28` forbids the notification.

## Done in the [quick follow-ons](../completed/2026-09-30-quick-follow-ons.complete.md) PR

- **URL-mode completion.** `@mokei/context-client` emits `elicitationComplete`, the host forwards it as
  `elicitation:complete` with the context key, and `AgentSession` publishes an `elicitation-complete` event to
  `onEvent` and `events` (not run streams, since it may arrive after the run ended).
- **Run-event observer isolation.** Every run event goes through one publish path that ignores `onEvent` exceptions
  and rejected `events` listeners.
- **Per-call tool cancellation.** `cancelToolCall(toolCallID?)` cancels the call with that ID, or every call in flight
  when omitted. A finishing call no longer clears another run's controller.
