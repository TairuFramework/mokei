# OAuth Client Credentials

**Status:** complete (2026-11-25)

Item 2 of the MCP extensions backlog. Adds `io.modelcontextprotocol/oauth-client-credentials`, so headless clients (CLI, flow daemon, CI, services) can get tokens with no user involved, using the RFC 6749 §4.4 client credentials grant. Builds on the extension registry from `2026-11-25-extension-plumbing.complete.md`.

## Scope

- Client authentication is `private_key_jwt` only (RFC 7523). `client_secret_basic` is deferred, see the backlog.
- The assertion primitives went upstream into `@kokuin/oauth` and shipped in 0.7.6 and 0.7.7:
  - `createClientAssertion`
  - `createWebCryptoAssertionSigner`
  - `requestClientCredentialsToken` and `RequestClientCredentialsTokenParams`

  mokei requires `@kokuin/oauth` `^0.7.7`.

## Key decisions

- **Registry entry and flags.**
  - The registry entry has no `revision`, works on both protocol revisions, and adds no methods. Its settings are `{}`.
  - `ContextClient` declares it with `oauthClientCredentials: true`, and `ContextServer` advertises it with the same flag.
- **Assertion.**
  - `iss` and `sub` are the client ID.
  - `aud` is the pinned issuer, as a single string.
  - `exp` is `iat` + 60 by default, and every attempt gets a fresh random `jti`.
  - `typ` defaults to `client-authentication+jwt`.
  - Only EdDSA and ES256 are allowed (ES256 as raw `r||s`), checked at runtime in kokuin. Kokuin also checks the lifetime and only reads `globalThis.crypto` lazily, at call time, never at import.
- **Pinned issuer.**
  - The configured `issuer` must appear in the protected resource's `authorization_servers`, and no other issuer is ever tried.
  - The token endpoint comes only from the pinned issuer's metadata.
  - Every stored or joined token record is checked against the pin before use.
- **Shared discovery, used by both PKCE and client credentials**, in the full MCP order:
  - Protected-resource metadata: the path-specific URL, then the root. A challenge `resource_metadata` URL, when present, is the only candidate.
  - Authorization-server metadata: OAuth path insertion, then OIDC path insertion, then OIDC path appending. A root issuer tries OAuth, then OIDC.
  - Only a 404, 405 or 410 moves on to the next candidate. Every other failure is terminal.
  - The issuer and resource must match exactly the values requested, never ones learned from the fetched document.
  - PKCE still tries today's first URL first, and keeps its `authorization_endpoint` and S256 checks. Client credentials only needs a secure `token_endpoint`.
- **Metadata compatibility**, client-credentials path only:
  - An absent field passes.
  - A present field must be a string array containing the value, either `client_credentials`, `private_key_jwt` or the signer's `alg`. Each failure has its own error.
  - JSON `null` counts as malformed.
- **Token isolation.**
  - Client-credentials records use their own store-key namespace: `['client_credentials', issuer, resource, clientID, sortedScopes]`.
  - Legacy three-element PKCE keys are unchanged, and the PKCE middleware can never attach a service token.
  - An explicit `resource` is used verbatim. It must be absolute `https` or loopback `http`, with no fragment. The default is the canonical resource.
- **Shared code (user directive).**
  - The PKCE and client-credentials middlewares share one store-scoped single-flight primitive, with an `accept` predicate; client credentials passes the issuer pin as `accept`.
  - They also share the secure-URL rule, the abort helpers and the transport helpers. PKCE behaviour is unchanged.
  - A joiner can abort early, without cancelling the flight it joined.
- **Wiring.**
  - `createHTTPClient` and host `addHTTPContext` both take `clientCredentials`, through a shared `resolveClientCredentials`.
  - Combining `clientCredentials` with `fetchMiddleware` throws.
  - The host builds the middleware once per context, so reconnects reuse the same token. `Session.addHTTPContext` forwards it.
  - The caller's `runtime` is the default source of assertion randomness.
- **CLI.**
  - `mokei auth list` has a `GRANT` column.
  - `mokei auth logout` deletes client-credentials records by their exact resource, locally only, without remote revocation. Legacy records still match on the canonical resource.
