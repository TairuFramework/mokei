# HTTP transport auth — OAuth 2.1 + JWT (completed)

**Date:** 2026-09-04
**Status:** complete
**Branch:** `feat/http-auth-oauth`

## Goal

Add OAuth 2.1 authorization to mokei's MCP HTTP transport on both sides: a client-side OAuth
fetch flow so `mokei chat` / `ContextHost.addHTTPContext` can connect to OAuth-protected remote
MCP servers, and bearer-token verification for `@mokei/http-server`. Implemented natively on the
Kigu stack — no MCP SDK v2 dependency, no `jose`.

## What was built

- **Fetch-middleware seam** (`@mokei/http-client`): `FetchMiddleware = (next: FetchLike) => FetchLike`.
  `HTTPTransport` composes the middleware over `globalThis.fetch` once and routes all fetch sites
  (refresh, POST, GET stream, DELETE) through it. Static `auth` that sets `Authorization` and an
  OAuth middleware are mutually exclusive (constructor throws; a non-`Authorization` header auth may
  coexist).
- **Client OAuth** (`@mokei/http-client`): `createOAuthMiddleware(config)` — RFC 9728/8414
  discovery (fail-closed: PRM resource equality, AS issuer equality, HTTPS, S256 gating), PKCE
  S256, state validated before code exchange, canonical RFC 8707 resource used identically as the
  token-store key and the `resource` parameter across auth-URL/token/refresh, per-instance
  single-flight authorize/refresh, refresh-before-reauthorize on 401. Default token store is
  in-memory; pluggable `AuthorizationHandler` and `TokenStore`.
- **Node interactive pieces** (`@mokei/host-node`): loopback browser authorization handler
  (RFC 8252, binds `127.0.0.1:0` on a random path), atomic file token store (temp + rename, mode
  `0o600`, per-resolved-path serialization), and `createNodeOAuthMiddleware` composing the three.
- **Server bearer auth** (`@mokei/http-server`): pluggable `OAuthTokenVerifier` with two shipped
  verifiers — a JWKS verifier (Node WebCrypto, RS256/ES256 only, alg allowlist before key import,
  signature before claims) for external IdPs, and a DID verifier (`@kokuin/token`) for the
  stack-native case. `createBearerAuthGate` returns 401 (missing/invalid) vs 403
  (insufficient_scope) and fails closed (non-`TokenVerificationError` → 500). RFC 9728
  protected-resource metadata endpoint served ungated; the MCP route is gated with no fallthrough.
- **CLI** (`mokei chat`): a `/context add-http [--protocol <v>] <key> <url> [--oauth-client-id <id>]
  [--oauth-resource <res>] [--oauth-scope <s>]… [--oauth-tokens <path>]` slash command, backed by a
  new `Session.addHTTPContext`. OAuth options compose `createNodeOAuthMiddleware`; without them the
  context is a plain HTTP connection.

## Key design decisions (rationale preserved)

- **Client and server together** — end-to-end interop is testable in-process against ourselves.
- **Native client, not an SDK v2 wrapper** — stack consistency; avoids `@modelcontextprotocol/client`
  plus transitive `zod ^4.2` and `jose`. The authorization-code + PKCE flow signs nothing on the
  client, so it needs no JWT library.
- **Both JWKS and DID verifiers** — the mainstream case is an external IdP issuing RS256/ES256 JWTs
  (outside `@kokuin/token`'s DID-only model), verified via JWKS with zero new dependencies; the DID
  verifier covers stack-native machine-to-machine.
- **Pre-registered `client_id` only** — Dynamic Client Registration (RFC 7591) and Client ID
  Metadata Documents (SEP-991) are out of scope; servers that require them are unsupported this
  iteration (documented).
- **Pluggable handler + Node loopback default; pluggable store + in-memory default** — a library
  embedding mokei must not open a browser or write tokens to disk unless it opts in; the CLI wires
  the loopback handler and file store.
- **No new package** — client core in `@mokei/http-client`, Node-only pieces in `@mokei/host-node`,
  server auth in `@mokei/http-server`.
- **Identity-to-handler exposure deferred** — the server gate is gate-only; surfacing `AuthInfo` to
  MCP handlers would add an auth field to the server contract and bind a session to a single
  subject, so it was left for a later planning decision.

## Security hardening

The implementation was reviewed in five independent adversarial passes; 33 findings were
identified and all were fixed or deliberately deferred (see follow-ups). Notable properties now
enforced and tested: HTTPS required on token attachment, discovery, and JWKS fetches (loopback HTTP
allowed only when the resource itself is loopback); redirects rejected on every OAuth fetch
(`redirect: 'error'`); bounded timeouts and response-size caps before JSON parsing; JWKS
alg-confusion and refresh-amplification guards (bad-signature or alg-mismatch on a known `kid` never
forces a refetch; unknown-`kid` refreshes are rate-limited); malformed/non-object JWTs and crypto
failures map to `invalid_token` (401), not 500; `exp` treated as an exclusive upper bound (`<=`) and
`nbf` as an inclusive lower bound (`>`); the Windows browser opener uses `rundll32` FileProtocolHandler
(never `cmd.exe`, whose metacharacter re-parsing would break and could inject on OAuth URLs); token
responses are field-validated before persistence; the loopback server is closed on every settle path
including abort.

## Status notes

All 17 planned tasks were implemented and reviewed. Task execution was tracked in an SDD ledger
rather than by ticking the plan's checkboxes, so the plan file's checkboxes remained unchecked;
completion is evidenced by the merged commits and the passing suites (`@mokei/http-client`,
`@mokei/http-server`, `@mokei/host-node`, `@mokei/session`, `@mokei/cli` all green; full monorepo
build clean). Task 17 was reshaped mid-flight — the CLI had no existing HTTP-context call site, so a
reusable `createNodeOAuthMiddleware` helper shipped first and the full `mokei chat` command was added
afterward (the `/context add-http` command above).

## Follow-ups extracted

- `docs/agents/plans/next/2026-09-04-oauth-multi-context-token-coordination.md`
- `docs/agents/plans/next/2026-09-04-oauth-server-gate-integration-tests.md`
- `docs/agents/plans/backlog/2026-09-04-oauth-hardening-followups.md`
