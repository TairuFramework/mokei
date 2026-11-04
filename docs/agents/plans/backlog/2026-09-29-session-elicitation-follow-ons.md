# Session elicitation follow-ons

**Status:** open · follow-on of [session elicitation](../completed/2026-09-29-session-elicitation.complete.md)
**Packages:** `@mokei/host`, `@mokei/session`, `@mokei/context-server`

- **Host-level sampling and roots.** Same host-construction capability and override model as elicitation.
- **Server-side URL-mode completion.** `ContextServer` cannot send `notifications/elicitation/complete` through its
  typed `notify`. Add it for `2025-11-25` connections only, since `2026-07-28` forbids the notification. The server
  resolves the revision per request and keeps no per-connection revision today, so this needs a way to scope the
  notification to `2025-11-25` connections first.
