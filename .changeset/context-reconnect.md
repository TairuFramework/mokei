---
"@mokei/context-client": patch
"@mokei/context-rpc": patch
"@mokei/http-client": patch
"@mokei/host": patch
"@mokei/host-node": patch
"@mokei/session": patch
"@mokei/session-node": patch
"mokei": patch
---

Reconnect lost contexts. `reconnect: true | ReconnectOptions` on `addLocalContext`, `addHTTPContext`, `addDirectContext` and the session equivalents rebuilds a context after a transport loss, with backoff, a call gate (`ContextUnavailableError`, whose `cause` is the terminal `ReconnectExhaustedError` or `AuthRequiredError`), `context:reconnecting`, `context:reconnected`, `context:failed`, `context:removed` and `resource:subscription-lost` events, and restoration of resource subscriptions. Stdio contexts accept `respawn` to change spawn params per loss. `HTTPTransport` emits connection events and `dispose({ terminateSession })`, an interrupted task rejects with `TaskInterruptedError`, and the CLI chat shows reconnect notices. Reconnect is off by default; HTTP and direct contexts now emit `context:added`.
