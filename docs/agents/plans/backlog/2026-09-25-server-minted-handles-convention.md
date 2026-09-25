# Server-minted handles across host contexts

**Status:** backlog
**Origin:** the open question in
`completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md` and
`completed/2026-07-27-context-rpc-stream-followups.complete.md`.

`2026-07-28` removes protocol sessions. MRTR `requestState` is scoped to one retry flow, and
subscription handles identify active listens; neither establishes a convention for a server to
return an opaque handle in one tool result and receive it as a later tool argument through
`ContextHost`. The current host routes namespaced tool calls but has no handle policy.

Decide whether a library convention is needed, including handle scope, lifetime, routing and
failure behaviour when a context disconnects. Keep it at the application layer if real consumers
need no shared convention; document that decision before adding an API.
