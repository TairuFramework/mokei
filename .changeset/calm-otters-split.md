---
"@mokei/host": minor
"@mokei/host-node": minor
"@mokei/session": minor
"@mokei/session-node": minor
---

BREAKING: stdio `Session.addContext` and the `NodeContextHost`-typed `contextHost` moved to `NodeSession` in the new `@mokei/session-node` package. Import `NodeSession` for spawned MCP servers. `@mokei/session` now uses portable `ContextHost` and is React Native / Metro-safe; `AgentSession` accepts either session class.

Stdio setup and abort cleanup now preserve a pre-existing or replacement context with the same key: `NodeContextHost.addLocalContext` rejects a concurrent spawn under a key already being spawned, and `ContextHost.setup` fails if the context under its key was replaced while it ran.
