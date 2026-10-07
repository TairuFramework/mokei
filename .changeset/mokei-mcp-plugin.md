---
'@mokei/http-server': minor
---

Remove the server OAuth exports in favour of `@teikyo/oauth`, make `serveHTTP` asynchronous and
return `503` for verifier outages. Add `mcpPlugin` and `HTTPHandler.shutdown()` for graceful
subscription shutdown.
