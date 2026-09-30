---
"@mokei/context-client": patch
"@mokei/host": patch
"@mokei/session": patch
---

URL-mode elicitation completion is forwarded: `ContextClient` emits `elicitationComplete`, `ContextHost` emits `elicitation:complete` with the context key, and `AgentSession` publishes an `elicitation-complete` event to `onEvent` and `events`. `AgentSession` now ignores exceptions from `onEvent` and rejected `events` listeners for every run event, not only elicitation events. `cancelToolCall` takes an optional tool call ID to cancel one call; without it, every call in flight is cancelled, instead of only the most recently started one.
