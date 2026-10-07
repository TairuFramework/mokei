---
'@mokei/http-server': minor
---

Remove the server OAuth exports in favour of `@teikyo/oauth`, make `serveHTTP` asynchronous and
return `503` for verifier outages. `serveHTTP` now returns a `@sozai/http-server` `HTTPServer`
(read the bound address from `server.url`), and the protected resource metadata URL is derived
from `auth.resource`, so `auth.resourceMetadataURL` is gone. Add `mcpPlugin` and
`HTTPHandler.shutdown()` for graceful subscription shutdown.
