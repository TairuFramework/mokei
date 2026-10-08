---
'@mokei/http-server': minor
---

Remove the server OAuth exports in favour of `@teikyo/oauth`, make `serveHTTP` asynchronous and
return `503` for verifier outages. `serveHTTP` now returns a `@sozai/http-server` `HTTPServer`
(read the bound address from `server.url`), and the protected resource metadata URL is derived
from `auth.resource`, so `auth.resourceMetadataURL` is gone. Add `mcpPlugin` and
`HTTPHandler.shutdown()` for graceful subscription shutdown; once it begins, new sessions
and listens get `503` with `Retry-After: 1`.

Sozai adds `/health/live` and `/health/ready`, `X-Request-Id` and secure response headers, default
JSON 404/500 bodies, and disposal that can wait up to `graceMs` for in-flight requests. Teikyo adds
startup validation (`auth.resource` must be an absolute http(s) URL without query or fragment,
`authorizationServers` must be non-empty) and `error_description` in `invalid_token` challenges.
