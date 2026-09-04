# HTTP transport auth — OAuth + JWT

**Status:** next (promoted from backlog 2026-09-03)
**Origin:** SDK v2 evaluation, 2026-07-02 (the **SDK v2 — selective adoption** section of
`../completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md`, follow-up item 2,
promoted to a dedicated item). Supersedes the bare roadmap P3 line
"OAuth / auth helpers for remote MCP servers".

## Current state

- `@mokei/http-client` — static credentials only (`auth.ts`, `HTTPAuthOptions`: bearer,
  basic, or a custom header). No OAuth flow, no token refresh, no discovery.
- `@mokei/http-server` — no auth at all: no bearer verification, no protected-resource
  metadata. Origin validation is the only gate.

## Scope

### 1. Client side — OAuth flow for remote MCP servers (primary)

What the MCP spec's authorization model expects of clients: OAuth 2.1 + PKCE,
authorization-server discovery via protected-resource metadata, token refresh, 401 →
(re)authorize.

**Option A — wrap SDK v2 (fast path).** SDK v2's client OAuth is plain **fetch
middleware**, transport-independent: `withOAuth` (`Middleware = (next: FetchLike) =>
FetchLike`), PKCE via `pkce-challenge`, discovery, token storage hooks, plus **machine
auth** — JWT authorization grants (`discoverAndRequestJwtAuthGrant`,
`exchangeJwtAuthGrant`) and Client ID Metadata Documents (SEP-991, replacing Dynamic
Client Registration). Wraps `@mokei/http-client`'s fetch without touching the Enkaku
transport. Cost: `@modelcontextprotocol/client` dependency → transitive `zod ^4.2`,
`jose`.

**Option B — native on the Kigu stack.** Reimplement the flow with `@kokuin/token` for
JWT signing/verification (stack rule: `@kokuin/token` over `jose`/`jsonwebtoken`) + a
small PKCE/discovery layer. No SDK dep, consistent stack; meaningfully more work and
more spec surface to maintain (OAuth 2.1, RFC 9728 protected-resource metadata, SEP-991).

**Suggested order:** A first (validates UX + shapes against real servers), B later if the
dep weight bothers. Either way the seam is the same: a fetch-middleware hook on
`HTTPTransport` — add that hook first, it's option-agnostic.

### 2. Server side — protecting `@mokei/http-server` (secondary)

Resource-Server duties: `requireBearerAuth`-style token verification middleware +
protected-resource metadata endpoint (RFC 9728). SDK v2 ships this only in
`@modelcontextprotocol/express` (`requireBearerAuth`, `mcpAuthMetadataRouter`,
`OAuthTokenVerifier`) — Express-shaped, poor fit for mokei's hono-based handler. Likely
native: a hono middleware + `OAuthTokenVerifier`-equivalent interface, JWT verification
via `@kokuin/token`. Authorization-Server duties stay out of scope (SDK v2 itself
deprecated its AS stack; guidance is "use a dedicated IdP").

### 3. JWT beyond OAuth (stack alignment, consider)

`@kokuin/token` also gives DID-issued tokens + JWE — potential mokei-native
machine-to-machine auth between trusted peers (host ↔ daemon ↔ remote contexts) without
an OAuth server. Separate design question; capture only.

## Acceptance sketch

- `mokei chat` / `ContextHost.addHTTPContext` can connect to an OAuth-protected remote
  MCP server: discovery → PKCE authorize → token → authenticated session → refresh on
  expiry → re-auth on 401.
- `@mokei/http-server` option to require bearer tokens with a pluggable verifier +
  metadata endpoint.
- Interop-tested against SDK v2 peers (see adoption backlog item 1).

## Links

- `../completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md`, **SDK v2 — selective
  adoption** section — evaluation + SDK v2 package shape.
- SDK v2 docs: `docs/clients/oauth.md`, `docs/clients/machine-auth.md`,
  `docs/serving/authorization.md` at https://ts.sdk.modelcontextprotocol.io/v2/.
