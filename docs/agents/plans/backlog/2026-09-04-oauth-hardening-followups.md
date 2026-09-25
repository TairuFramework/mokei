# OAuth: remaining follow-ups

**Origin:** deferred, non-blocking items from the OAuth 2.1 HTTP-transport work
(`docs/agents/plans/completed/2026-09-04-http-auth-oauth.complete.md`). Neither is a security
bypass; each needs its own design. The four small hardening items (clear the store on
`invalid_grant`, operational JWKS errors as HTTP 500, draining non-2xx bodies, loopback parity)
shipped on 2026-09-25.

## Items

- **Pass verified `AuthInfo` to MCP handlers.** `createBearerAuthGate` returns `authInfo` after
  verification, but `serveHTTP` destructures only `response` and calls
  `handler.handleRequest(ctx.req.raw)` without it. Neither `HTTPHandler` nor
  `ContextServer`'s handler request carries verified identity. Design a per-request context
  channel that preserves the gate's scope and makes subject/scopes available to tool and resource
  handlers without treating client-supplied fields as authenticated data.

- **Dynamic Client Registration (RFC 7591) and Client ID Metadata Documents (SEP-991).** The client
  supports a pre-registered `client_id` only; servers that require DCR or CIMD are unsupported.
  Revisit if a target server requires them. Also out of scope from the original design: the client
  JWT-bearer authorization grant (machine auth) and the full DID machine-to-machine design beyond
  the shipped server DID verifier.
