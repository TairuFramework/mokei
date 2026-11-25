# OAuth Client Credentials design

Item 2 of `docs/agents/plans/backlog/2026-11-25-mcp-extensions.md`. Builds on the extension
registry from `docs/superpowers/specs/2026-11-25-extension-plumbing-design.md`. Reviewed by a
builder check and two Codex reviews; their outcomes are folded in below. "(my call)" marks
decisions not made by the user.

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
- One shared OAuth discovery following the full MCP authorization discovery order, used by both
  the new middleware and the existing PKCE middleware (decided).
- The extension is a registry entry; mokei clients using client credentials declare it, and
  `@mokei/http-server` can advertise it.

## Non-goals

- `client_secret_basic` / `client_secret_post` (decided: JWT only for now).
- RSA (`RS256`) keys and PEM import (decided: kokuin's `EdDSA` and `ES256` only for now).
- Server-side changes to token validation: client-credentials tokens are ordinary bearer tokens,
  already validated through `@teikyo/oauth`.
- Dynamic client registration; the client is pre-registered with the authorisation server.
- CLI or config-file wiring for client credentials; programmatic API only (my call).
- Remote revocation of client-credentials tokens (my call, see "CLI token management").

## Anti-goals

- Sending a client assertion to any authorisation server other than the pinned issuer.
- Regressions in the interactive PKCE middleware against servers it works with today. Its
  discovery gains the MCP fallbacks; nothing else about it changes, including its resource
  resolution and store keys.

## Approaches

1. **Upstream in `@kokuin/oauth` (picked).** It already owns code exchange, refresh and
   revocation; the new grant sits beside them and other kokuin consumers get it. Costs a kokuin
   release before mokei can merge.
2. Directly in mokei `http-client`. No wait, but duplicates token-endpoint handling and leaves
   kokuin without the grant. Rejected.
3. Mokei now, move upstream later. Rejected: pays the migration for a short head start.

## Design

### `@kokuin/oauth` (kokuin branch, implemented by us)

- `ClientAssertionSigner = { alg: 'EdDSA' | 'ES256'; kid?: string; sign(data: Uint8Array): Promise<Uint8Array> }`.
  Owned by `@kokuin/oauth`, so the package takes no dependency on `@kokuin/token` (whose
  `SigningIdentity` forces `iss` to a DID). For `ES256`, `sign()` returns the raw `r||s` JOSE
  form, not DER.
- `createWebCryptoAssertionSigner({ alg, privateKey: CryptoKey, kid? }): ClientAssertionSigner`,
  runtime-neutral and dependency-free; WebCrypto ECDSA already yields `r||s` (my call).
- `createClientAssertion({ signer, clientID, audience, lifetimeSeconds?, now?, typ? }): Promise<string>`:
  compact JWS, header `{ alg, typ, kid? }` with `typ` defaulting to `client-authentication+jwt`
  (RFC 10070 recommendation, overridable for compatibility). Claims: `iss = sub = clientID`,
  `aud = audience` as a single string, `iat`, `exp = iat + lifetimeSeconds` (default 60), random
  `jti`. Kokuin takes `audience` explicitly; mokei always passes the pinned issuer, as the
  extension requires (`aud` is the authorisation server's `issuer`, never the token endpoint URL).
- `requestClientCredentialsToken({ tokenEndpoint, clientID, assertion, scope?, extraParams?, ...RequestOptions }): Promise<TokenResponse>`:
  POSTs `grant_type=client_credentials`, `client_id`,
  `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`,
  `client_assertion`, optional `scope`, plus `extraParams` (e.g. `resource`, RFC 8707) that never
  override grant fields. Same redirect refusal, error mapping (`OAuthTokenError`) and response
  validation as `exchangeCode`.
- A kokuin changeset (patch).

### Registry entry (`@mokei/context-protocol`)

`OAUTH_CLIENT_CREDENTIALS`: id `io.modelcontextprotocol/oauth-client-credentials`, no
`revision`, `protocolVersions` both `2025-11-25` and `2026-07-28`, empty method sets. Added to
`EXTENSIONS`.

### Shared discovery (`@mokei/http-client`)

One discovery module used by both middlewares. Fetching, size bounds and identity checks are
shared; grant-specific metadata requirements are applied by each caller.

1. **Protected-resource metadata (PRM).** A `resource_metadata` URL from the `WWW-Authenticate`
   challenge takes precedence. Otherwise try the path-specific well-known URL, then the root
   well-known URL. The accepted document's `resource` must equal the resolved resource exactly
   (as today).
2. **Expected issuer.** PKCE: the `authorization_servers` entry selected as today (default or
   `selectAuthServer`). Client credentials: the configured pin, which must appear in
   `authorization_servers` (else fail with an error naming the pin and the listed servers). No
   other issuer is ever tried.
3. **Authorisation-server metadata.** For the expected issuer, try in the order both MCP
   revisions specify: OAuth path insertion, OpenID Connect path insertion, OpenID Connect path
   appending (for a root issuer: OAuth, then OpenID Connect). Today's first URL stays first, so
   servers that work now resolve the same document. The accepted document's `issuer` must equal
   the expected issuer; it is never learned from the fetched document.
4. **Fallback policy.** Only "not found"-type HTTP statuses (`404`, `405`, `410`) advance to the
   next candidate URL (my call). Caller cancellation, timeouts, size-limit failures, parse
   failures, other statuses, and identity mismatches are terminal. Mismatched metadata is never
   accepted.
5. **Grant-specific requirements.** PKCE keeps its current `authorization_endpoint` and `S256`
   checks unchanged. Client credentials require a secure `token_endpoint` only, and accept
   metadata without an authorisation endpoint or PKCE support.

### Client credentials middleware (`@mokei/http-client`)

- `createClientCredentialsMiddleware(config): FetchMiddleware`, sibling of
  `createOAuthMiddleware`. Config: `clientID`, `issuer` (required pin), `signer`
  (`ClientAssertionSigner`), `scopes?`, `resource?`, `store?`, `clockSkewSeconds?`, `now?`,
  `assertionLifetimeSeconds?` (default 60), `runtime?`.
- **Resource.** An explicitly configured `resource` is used verbatim (absolute `https` URL,
  loopback `http` allowed as elsewhere, no fragment), not passed through `canonicalResource`.
  Without one, the default is `canonicalResource(mcpURL)`, as PKCE does. The resolved value is
  used for the PRM comparison, the token request (`resource` param) and the store key. This rule
  applies to client credentials only; PKCE resolution is unchanged.
- **Token storage.** Client-credentials records live under their own key namespace, built from
  grant, pinned issuer, resource, client ID and scopes, so the PKCE middleware can never attach a
  service token and a service grant never overwrites a PKCE record. Existing PKCE keys are
  untouched. Single-flight is keyed by the same identity, and recovery-flight state is per grant.
  Every record obtained (stored, from a joined flight, or from an atomic `update`) is checked
  against the pin before use. Bounded HTTP, store primitives and metadata fetching are shared
  with PKCE; nothing else is extracted from `middleware.ts`.
- **Flow.** Attach a stored token. When near expiry, re-run the grant pre-emptively (there is no
  refresh token), reusing the stored `tokenEndpoint` (it came from the pinned issuer's metadata).
  On `401`: discovery as above, metadata compatibility check, new assertion, token request,
  store, retry once. A second `401` after a fresh grant is returned. `403` passes through (no
  step-up). When `scopes` is unset, challenge scopes from `WWW-Authenticate` are requested, as in
  PKCE. Token-endpoint errors surface as in PKCE. Every grant attempt builds a fresh assertion
  with a new `jti`.
- **Metadata compatibility.** Before signing, for each of `grant_types_supported`,
  `token_endpoint_auth_methods_supported` and `token_endpoint_auth_signing_alg_values_supported`:
  - present: must be an array of strings (else fail as malformed metadata), and must contain
    `client_credentials`, `private_key_jwt` and the signer's `alg` respectively (exact element
    match), else fail with a distinct error for each;
  - absent: proceed with the grant. This is a deliberate interoperability exception to RFC 8414's
    defaults (which imply `authorization_code` / `client_secret_basic`): the client is
    preregistered for this grant and method, and the authorisation server's own error is
    surfaced if it disagrees (my call). The exception applies to the client-credentials path
    only.

### Declaration

When client-credentials auth is configured, the `ContextClient` declares
`OAUTH_CLIENT_CREDENTIALS` (on `initialize` for `2025-11-25`, per-request `_meta` for
`2026-07-28`).

- `createHTTPClient` takes a client-credentials option on its transport side, builds the
  middleware from it and turns the declaration on.
- `ContextClient` gets a public boolean param that turns the declaration on, for hand-built
  `HTTPTransport` + `ContextClient`; documented next to the middleware (my call).
- The host's `HTTPContextParams`, `createHostedContext` and reconnect builds thread the same
  option, so `ContextHost.addHTTPContext` can use client credentials and the declaration survives
  reconnects.

### Server (`@mokei/http-server`)

An opt-in flag advertises `OAUTH_CLIENT_CREDENTIALS` with settings `{}` in `server/discover` and
the `2025-11-25` `initialize` result (my call).

### CLI token management

- The store-key parser/enumerator recognises both key identities; legacy three-element PKCE keys
  parse exactly as today.
- `mokei auth list` shows client-credentials records, marked as such, with their exact resource.
- `mokei auth logout` deletes client-credentials records locally, matching their exact resource
  (no canonicalisation for these records). Remote revocation is skipped for them and the command
  says so: `revokeTokens` authenticates as a public client and cannot authenticate a confidential
  one, and a client-credentials token is short-lived and re-obtainable (my call).
- No CLI command creates client-credentials records (programmatic API only).

### Order

One mokei PR (decided): this item ships on the same branch as item 1, and the branch merges only
after the kokuin release is published (by the user) and adopted in mokei's catalog. Order of work:
kokuin branch first; then the mokei parts that do not need kokuin (registry entry, server
advertising, declaration seams, shared discovery with its PKCE adoption, store-key namespace and
CLI listing); then the middleware, developed against the local kokuin build (a temporary link
never committed) and switched to the published version before merge.

## Testing

- kokuin: assertion header (`typ` default and override, `kid`) and claims (`aud` is the given
  audience, single string); signature verifies for `EdDSA` and `ES256`; fresh `jti` per call;
  token request form fields; `extraParams` cannot override grant fields; redirect refusal; error
  mapping.
- Shared discovery, on both paths: challenge `resource_metadata` precedence; PRM path-specific
  then root fallback; AS metadata OAuth then OIDC orderings for path and root issuers; an
  unchanged-result test for today's first URL; terminal failures (cancellation, oversize, parse
  error, `500`, PRM `resource` mismatch, AS `issuer` mismatch) do not fall back.
- PKCE regression: existing middleware tests pass unchanged; explicit `resource` still
  canonicalised; store keys unchanged.
- Client credentials middleware against a fake authorisation server: first `401` → discovery →
  token → retry; pin absent from `authorization_servers` refuses before any token request; token-
  only metadata accepted; metadata compatibility (absent, malformed, present-and-incompatible for
  each field); explicit `resource` sent verbatim; re-grant near expiry without discovery; second
  `401` returned; `403` passes through; single-flight; a PKCE middleware sharing the store never
  attaches the service token and keeps its own record.
- Declaration present on both revisions via `createHTTPClient`, `ContextClient` param, and
  `ContextHost.addHTTPContext`, including after reconnect. Server advertising on and off.
- CLI: `auth list` shows both kinds; `auth logout` deletes a client-credentials record by exact
  resource and reports skipped revocation; legacy keys unaffected.

## Left to the builder

- Exact helper names and module split inside `packages/http-client/src/oauth/`.
- The new store-key encoding, provided it cannot collide with legacy three-element keys.
- How the client/server feature params are named (`ClientParams` / `ServerParams`).
