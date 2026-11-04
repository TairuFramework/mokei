# OAuth: verified identity for MCP handlers

**Origin:** deferred from the OAuth 2.1 HTTP-transport work
(`docs/agents/plans/completed/2026-09-04-http-auth-oauth.complete.md`). Not a security bypass;
needs its own design. DCR, CIMD and the JWT-bearer grant were dropped on 2026-11-04 (see
`completed/2026-11-04-backlog-trim.complete.md`).

`createBearerAuthGate` returns `authInfo` after verification, but `serveHTTP` destructures only
`response` and calls `handler.handleRequest(ctx.req.raw)` without it. Neither `HTTPHandler` nor
`ContextServer`'s handler request carries verified identity. Design a per-request context channel
that preserves the gate's scope and makes subject/scopes available to tool and resource handlers
without treating client-supplied fields as authenticated data.
