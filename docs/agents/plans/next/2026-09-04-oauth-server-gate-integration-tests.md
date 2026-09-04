# OAuth: end-to-end server-gate integration tests (real verifiers behind a real serveHTTP)

**Origin:** follow-up from the OAuth 2.1 HTTP-transport work
(`docs/agents/plans/completed/2026-09-04-http-auth-oauth.complete.md`).

## Gap

Both server verifiers are unit-covered, and there is a genuine client↔server e2e test exercising
the OAuth middleware against a real `serveHTTP` gate. But the two shipped verifiers are not each
driven end-to-end behind a real `serveHTTP` bearer gate with a real signed token:

- **JWKS verifier**: mint an RS256 (and ES256) access token from a test key, serve its JWKS from a
  local fake authorization server, gate a real `serveHTTP` MCP route with `createJWKSVerifier`, and
  assert a valid token passes, a wrong-audience/expired/bad-signature token gets 401, and an
  insufficient-scope token gets 403.
- **DID verifier**: sign a token with a `@kokuin/token` identity, gate with `createDIDVerifier`, and
  assert the same matrix (valid passes, tampered/expired/wrong-audience rejected).

## Value

Locks the wiring between `createBearerAuthGate`, `serveHTTP`'s gated MCP route + ungated RFC 9728
metadata route, and each verifier — the seams most likely to regress silently, since unit tests
exercise the verifiers in isolation from the HTTP gate.

## Acceptance

For each verifier, a real `serveHTTP` server with the bearer gate accepts a valid signed token and
returns the correct 401/403 for the invalid cases, with the protected-resource metadata endpoint
reachable unauthenticated.
