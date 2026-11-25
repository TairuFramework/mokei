# OAuth Client Credentials design

Item 2 of `docs/agents/plans/backlog/2026-11-25-mcp-extensions.md`. Builds on the extension
registry from `docs/superpowers/specs/2026-11-25-extension-plumbing-design.md`.

## Intent

Let mokei connect to OAuth-protected MCP servers with no person present (CLI, flow daemon, CI),
using the `io.modelcontextprotocol/oauth-client-credentials` extension
(https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials): the OAuth 2.0 client
credentials grant (RFC 6749 §4.4) with a signed JWT client assertion (RFC 7523).

## Goals

- `@kokuin/oauth` gains the client credentials grant with `private_key_jwt` client authentication
  (decided: built upstream, in a kokuin branch we implement ourselves, then adopted by mokei).
- `@mokei/http-client` gains a headless OAuth middleware that obtains, stores and re-obtains
  client-credentials tokens, pinned to one authorisation-server issuer.
- The extension is a registry entry; mokei clients using client credentials declare it, and
  `@mokei/http-server` can advertise it.

## Non-goals

- `client_secret_basic` / `client_secret_post` (decided: JWT only for now).
- RSA (`RS256`) keys and PEM import (decided: kokuin's `EdDSA` and `ES256` only for now).
- Server-side changes to token validation: client-credentials tokens are ordinary bearer tokens,
  already validated through `@teikyo/oauth`.
- Dynamic client registration; the client is pre-registered with the authorisation server.

## Anti-goals

- Sending a client assertion to any authorisation server other than the pinned issuer.
- Any behaviour change to the existing interactive PKCE middleware.

## Approaches

1. **Upstream in `@kokuin/oauth` (picked).** It already owns code exchange, refresh and
   revocation; the new grant sits beside them and other kokuin consumers get it. Costs a kokuin
   release before mokei's middleware lands.
2. Directly in mokei `http-client`. No wait, but duplicates token-endpoint handling and leaves
   kokuin without the grant. Rejected.
3. Mokei now, move upstream later. Rejected: pays the migration for a short head start.

## Design

### `@kokuin/oauth` (kokuin branch, implemented by us)

- `createClientAssertion(params): Promise<string>` — compact JWS with header
  `{ alg, typ: 'JWT', kid? }` and claims `iss = sub = clientID`, `aud = issuer` (the
  authorisation server's `issuer` metadata value, as the only value; RFC 10070 disallows the
  token endpoint URL), `iat`, `exp` (default lifetime 60 s, configurable), random `jti`.
- Signing goes through a minimal signer interface owned by `@kokuin/oauth`, so the package takes
  no dependency on `@kokuin/token` (whose `SigningIdentity` forces `iss` to a DID):
  `ClientAssertionSigner = { alg: 'EdDSA' | 'ES256'; kid?: string; sign(data: Uint8Array): Promise<Uint8Array> }`.
  Callers adapt a keystore key or a raw private key.
- `requestClientCredentialsToken(params): Promise<TokenResponse>` — POSTs
  `grant_type=client_credentials`, `client_id`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`,
  `client_assertion`, optional `scope`, plus `extraParams` (e.g. `resource`, RFC 8707) that never
  override grant fields. Same `RequestOptions`, error mapping (`OAuthTokenError`) and response
  validation as `exchangeCode`.
- Tests with the package's fake runtime; a kokuin changeset (patch).

### Registry entry (`@mokei/context-protocol`)

`OAUTH_CLIENT_CREDENTIALS`: id `io.modelcontextprotocol/oauth-client-credentials`, no
`revision`, `protocolVersions` both `2025-11-25` and `2026-07-28`, empty method sets. Added to
`EXTENSIONS`.

### Client (`@mokei/http-client`)

- `createClientCredentialsMiddleware(config): FetchMiddleware`, sibling of
  `createOAuthMiddleware`. Config: `clientID`, `issuer` (required pin), `signer`
  (`ClientAssertionSigner`), `scopes?`, `resource?`, `store?`, `clockSkewSeconds?`, `now?`,
  `assertionLifetimeSeconds?`, `runtime?`.
- Flow: attach a stored token; pre-emptively re-run the grant when near expiry (there is no
  refresh token). On `401`: protected-resource discovery, require the pinned `issuer` to be among
  the listed authorisation servers (else fail with an error naming both), fetch its metadata,
  require metadata `issuer` to equal the pin, check `grant_types_supported` /
  `token_endpoint_auth_methods_supported` when present, request a token, store it, retry once.
- Reuses the existing token store, `tokenStoreKey`, single-flight and discovery code; shared
  pieces of `middleware.ts` are extracted rather than copied.
- Declaration: when the HTTP client is built with client-credentials auth, the `ContextClient`
  declares `OAUTH_CLIENT_CREDENTIALS` (on `initialize` for `2025-11-25`, per-request `_meta` for
  `2026-07-28`). The public switch is a client-credentials option on `createHTTPClient`; the
  `ContextClient` param that carries it is left to the builder (registry-only: no free-form
  `extensions`).

### Server (`@mokei/http-server`)

An opt-in flag that advertises `OAUTH_CLIENT_CREDENTIALS` (in `server/discover` and the
`2025-11-25` `initialize` result). The public `ContextServer` param that carries it is left to
the builder, as for the client.

### Settled details (builder check; marked "my call" where not decided by the user)

- **Audience.** The extension page requires `aud` to be the authorisation server's `issuer` as
  the only value, citing RFC 10070. `createClientAssertion` takes an explicit `audience` (kokuin
  stays generic); mokei always passes the pinned issuer. (my call)
- **Signer adapter.** Besides the interface, `@kokuin/oauth` ships
  `createWebCryptoAssertionSigner({ alg, privateKey: CryptoKey, kid? })`, runtime-neutral and
  dependency-free. WebCrypto ECDSA already yields raw `r||s`, which is the JOSE format the
  `sign()` contract requires for `ES256`. Programmatic API only: no CLI or config-file wiring in
  this item. (my call)
- **Resource.** With no `resource` configured, the middleware sends the canonical MCP URL as the
  RFC 8707 `resource`, exactly as the PKCE middleware does; same `tokenStoreKey`. (my call)
- **Stored-token trust.** A stored record is used only if its `issuer` equals the pin and it was
  issued by the client-credentials grant (a `grant: 'client_credentials'` marker on the record).
  Otherwise it is ignored and a fresh grant runs through discovery, overwriting it. Pre-emptive
  re-grants reuse the stored `tokenEndpoint` only under that same check, since it came from the
  pinned issuer's metadata. (my call)
- **Failures.** Retry once: a second `401` after a fresh grant is returned. Token-endpoint errors
  surface the same way the PKCE middleware surfaces them. No step-up: `403` passes through. When
  `scopes` is unset, challenge scopes from `WWW-Authenticate` are requested, as in PKCE. (my call)
- **Shared code.** Moving `withSingleFlight`, `storeFlights`, `nearExpiry` and discovery helpers
  out of `middleware.ts` into a shared module is in scope, on condition that the existing
  middleware tests pass unchanged. (my call)
- **Declaration seam.** The client-credentials option is a transport-side option of
  `createHTTPClient`, which builds the middleware and also turns on the declaration. For hand-built
  `HTTPTransport` + `ContextClient`, a public `ContextClient` boolean param turns the declaration
  on; documented next to the middleware. (my call)
- **Advertised settings.** `{}` in `server/discover` and the `2025-11-25` `initialize` result
  only. (my call)

### Codex review changes

Supersede the "Settled details" above where they conflict.

- **Token isolation.** Client-credentials tokens never share a store key with PKCE. They live
  under their own key namespace built from grant, pinned issuer, resource, client ID and scopes;
  single-flight is keyed by that identity too, and every record returned (from a joined flight
  or an atomic `update`) is re-validated against the pin. PKCE keys and `parseTokenStoreKey`
  handling of existing three-element keys stay as they are. This replaces the
  `grant: 'client_credentials'` marker idea, which did not stop the PKCE middleware from
  attaching a service token.
- **Metadata validation split.** Fetching metadata and checking `issuer` equality are shared;
  grant-specific requirements are not. The PKCE path keeps its `authorization_endpoint` and
  `S256` checks. The client-credentials path requires a secure `token_endpoint` only, and must
  accept metadata without an authorisation endpoint or PKCE support.
- **Discovery fallbacks.** The client-credentials path follows the MCP authorization discovery
  order, including the root protected-resource metadata fallback and both OAuth and OpenID
  Connect authorisation-server metadata, requiring the exact pinned issuer in every accepted
  response and never falling back to another issuer. The PKCE path is unchanged here (anti-goal);
  its missing fallbacks go to the backlog as a separate item.
- **Resource identity.** An explicitly configured `resource` is used verbatim (validated as an
  absolute `https` URL — loopback `http` allowed as elsewhere — with no fragment), not passed
  through `canonicalResource`. Only the default is derived from the MCP URL with
  `canonicalResource`. The same resolved value is used for discovery comparison, the token
  request and the store key.
- **Metadata compatibility.** Before signing: if `grant_types_supported`,
  `token_endpoint_auth_methods_supported` or `token_endpoint_auth_signing_alg_values_supported`
  is present and lacks `client_credentials`, `private_key_jwt` or the signer's `alg`
  respectively, fail with a distinct error for each. When a field is absent, proceed: the client
  is preregistered, and the authorisation server's own error is surfaced (my call; RFC 8414's
  defaults would reject most real servers, which omit these fields).
- **Host seam.** The declaration switch is threaded through the host's `HTTPContextParams`,
  `createHostedContext` and reconnect builds, not only `createHTTPClient` and `ContextClient`,
  with a host-level declaration test on both revisions.
- **Assertion type.** The assertion header defaults to `typ: 'client-authentication+jwt'`
  (RFC 10070 recommendation), overridable for compatibility.
- **Replay.** Tests prove a fresh assertion and `jti` on every grant attempt.
- **Shared code (narrowed).** Bounded HTTP, store primitives and metadata fetching are shared;
  recovery-flight state is per grant.

### Order

One mokei PR (decided): this item ships on the same branch as item 1, and the branch merges only
after the kokuin release is published (by the user) and adopted in mokei's catalog. Order of work:
kokuin branch first; mokei parts that do not need kokuin (registry entry, server advertising,
client declaration) next; the middleware developed against the local kokuin build (a temporary
link never committed), then switched to the published version before merge.

## Testing

- kokuin: assertion header/claims (`aud` is the issuer, not the token endpoint), signature
  verifies for `EdDSA` and `ES256`, token request form fields, `extraParams` cannot override
  grant fields, error mapping.
- mokei: middleware against a fake authorisation server — first `401` → discovery → token →
  retry; pinned-issuer mismatch refuses before any token request; re-grant near expiry; store
  sharing and single-flight; declaration present on both revisions; server advertising on and
  off.

## Left to the builder

- Exact helper names and the internal split of `middleware.ts`.
- How the client/server feature params are named (`ClientParams` / `ServerParams`).
- Default assertion lifetime within 60–300 s.
