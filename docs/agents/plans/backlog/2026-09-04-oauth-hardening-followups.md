# OAuth: minor hardening and consistency follow-ups

**Origin:** deferred, non-blocking items from the OAuth 2.1 HTTP-transport work
(`docs/agents/plans/completed/2026-09-04-http-auth-oauth.complete.md`). Each is small and
independent; none is a security bypass.

## Items

- **Clear the token store on a definitive `invalid_grant`.** On a 401 the client attempts refresh
  before interactive re-authorization; when the refresh fails with a definitive OAuth
  `invalid_grant` (revoked/expired refresh token), the stale record is left in the store and only
  overwritten after the next authorize. Clear the record on definitive OAuth failures (keep it for
  transient/network failures). Needs the token-endpoint error code surfaced from the exchange path.

- **`stdio` `addContext` duplicate-key cleanup twin.** `Session.addHTTPContext` was fixed so a
  duplicate-key rejection never removes the pre-existing context and a failed `setup()` removes only
  the context that call registered (identity-guarded). The older stdio `Session.addContext` /
  `#setupContext` still carries the original pattern (an unconditional `remove(key)` on any abort
  rejection, and no cleanup on a no-signal setup failure). Apply the same identity-aware cleanup
  there for consistency.

- **Size-cap error classification vs the verifier contract.** The JWKS verifier's fetch size-cap and
  HTTP-status failures are thrown as `TokenVerificationError('invalid_token', …)`, which the
  documented `OAuthTokenVerifier` contract classifies as *credential* failures (→ 401), though a
  metadata/JWKS fetch failure is arguably *operational* (→ 500). This matches the pre-existing
  pattern on that fetch path. Decide the intended classification and align the code and the contract
  doc.

- **Drain non-2xx OAuth response bodies before throwing.** On a non-ok metadata/token/JWKS response
  the body is not cancelled before the error is thrown (only the 401 recovery path and the
  size-cap-overflow path cancel). Cancel the body on the non-ok branch too, to release sockets
  promptly under load.

- **Loopback-host predicate and well-known-URL builder parity.** The `isLoopbackHost` predicate in
  `@mokei/http-server`'s JWKS verifier recognizes only `localhost` / `127.0.0.1` / `::1`, while the
  `@mokei/http-client` copies also match `[::1]` and `*.localhost`. And the AS well-known URL builder
  strips a trailing slash from the issuer path while the protected-resource-metadata builder does
  not. Converge the predicates and the two builders.

- **Dynamic Client Registration (RFC 7591) and Client ID Metadata Documents (SEP-991).** The client
  supports a pre-registered `client_id` only; servers that require DCR or CIMD are unsupported.
  Revisit if a target server requires them. Also out of scope from the original design: the client
  JWT-bearer authorization grant (machine auth) and the full DID machine-to-machine design beyond
  the shipped server DID verifier.
