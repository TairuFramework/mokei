# HTTP transport auth — OAuth + JWT (design)

**Date:** 2026-09-04
**Origin:** `docs/agents/plans/next/2026-07-02-http-auth-oauth.md` (promoted from the SDK v2
evaluation follow-up). Brainstormed 2026-09-04; revised after a Codex spec review the same day.
**Branch:** `feat/http-auth-oauth`

## Summary

Add OAuth 2.1 authorization to mokei's HTTP transport on both sides:

- **Client** — a fetch-middleware OAuth flow so `mokei chat` and `ContextHost.addHTTPContext`
  can connect to OAuth-protected remote MCP servers (discovery → PKCE authorize → token →
  refresh → 401 re-auth). Implemented **natively on the Kigu stack** (no SDK v2 dependency).
- **Server** — bearer-token verification middleware for `@mokei/http-server`, with a pluggable
  verifier interface plus two shipped verifiers (external-IdP JWKS and stack-native DID), and an
  RFC 9728 protected-resource metadata endpoint.

No new package is created. Client OAuth core lives in `@mokei/http-client`; the Node-only
interactive pieces live in `@mokei/host-node`; server auth lives in `@mokei/http-server`.

## Decisions and their rationale

| Decision | Choice | Why |
|----------|--------|-----|
| Iteration scope | Client **and** server | End-to-end interop is testable in-process against ourselves. |
| Client implementation | **Native** (Option B), not SDK v2 wrapper | Stack consistency; avoids `@modelcontextprotocol/client` + transitive `zod ^4.2` + `jose`. The authorization-code + PKCE flow signs nothing on the client, so it needs no JWT library at all. |
| Server default verifiers | **Both** JWKS and DID | The mainstream OAuth case is an external IdP whose access tokens are RS256/ES256 JWTs verified via JWKS — outside `@kokuin/token`'s model. A DID verifier covers the stack-native machine-to-machine case. |
| Client registration | **Pre-registered `client_id` only** | The client is configured with a `client_id` obtained out of band. Dynamic Client Registration (RFC 7591) and Client ID Metadata Documents (SEP-991) are deferred; servers that *require* those are unsupported this iteration and this limit is documented. |
| Authorize UX | Pluggable handler + Node loopback default | `mokei chat` needs an interactive browser flow; a library consumer supplies its own handler or a pre-obtained token for headless use. |
| Token storage | Pluggable store + **in-memory** default | A library embedding mokei must not write tokens to disk unless it opts in; the CLI wires a file store so sessions survive restarts. |

### Key finding: `@kokuin/token` does not fit external-IdP verification

`@kokuin/token` (verified against the sibling checkout) supports only **ES256 and EdDSA**
(no RS256) and resolves issuers as **DIDs** (`did:key`, `did:peer:4`) through a
`DIDMethodResolver` — not a URL `iss` plus a JWKS endpoint. Mainstream OAuth access tokens
(Auth0, Okta, Azure AD, Keycloak) are commonly RS256 JWTs with a URL issuer and a
`/.well-known/jwks.json` key set. Verifying those is a different job.

Resolution: the server contract is a pluggable `OAuthTokenVerifier` interface. We ship two
implementations — a JWKS verifier for external IdPs and a `@kokuin/token` verifier for
DID-issued tokens. Node's WebCrypto (`crypto.subtle.verify`) verifies RS256 and ES256 natively,
so the JWKS verifier needs **no new dependency** and no `jose`.

## Architecture

Five units. Unit A is the option-agnostic seam and is built first.

### Unit A — fetch seam (`@mokei/http-client`, isomorphic)

`HTTPTransportParams` gains an optional fetch middleware, named `fetchMiddleware` (it is a
middleware, not a `fetch` implementation):

```ts
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
type FetchMiddleware = (next: FetchLike) => FetchLike
```

`HTTPTransport` composes the middleware over `globalThis.fetch` once in its constructor and
calls the composed `this.#fetch` at all four current fetch sites:
`transport.ts:338` (refresh `tools/list`), `transport.ts:682` (POST send), `transport.ts:978`
(GET stream), `transport.ts:1081` (DELETE dispose). The default (no middleware) is
`globalThis.fetch`, so behaviour is unchanged.

`createHTTPClient` forwards `fetchMiddleware` to the transport via `HTTP_TRANSPORT_PARAM_KEYS`
(`transport.ts:1136`) — add the key; the `satisfies` check enforces completeness.

**Static-auth interaction.** The existing static `auth` option (`bearer`/`basic`/`header`) bakes
`Authorization` into `#headers` at `transport.ts:446`. Static `auth` and an OAuth middleware that
also sets `Authorization` are **mutually exclusive**: `createHTTPClient` / `HTTPTransport` throws
if both are supplied. (A non-`Authorization` static `header` auth may coexist with OAuth.)

### Unit B — OAuth client (`@mokei/http-client`, isomorphic, no new deps)

`createOAuthMiddleware(config): FetchMiddleware`.

**Configuration.**

```ts
type OAuthClientConfig = {
  clientId: string                    // pre-registered public client id
  scopes?: string[]                   // requested scopes
  resource?: string                   // canonical MCP resource URI; default derived from url
  handler: AuthorizationHandler
  store?: TokenStore                  // default: in-memory
  clockSkewSeconds?: number           // default 30
  now?: () => number                  // injectable clock for tests
}
```

The **canonical resource** (RFC 8707) defaults to the transport `url` reduced to its canonical
form (scheme + host + port + path, no query/fragment, per MCP guidance) and is sent as the
`resource` parameter in **both** the authorization request and the token request. The `TokenStore`
key is this canonical resource string.

**Protocol requests (exact fields).**

- Authorization request (browser URL): `response_type=code`, `client_id`, `redirect_uri`,
  `code_challenge`, `code_challenge_method=S256`, `state`, `scope` (space-joined), `resource`.
- Token request (code exchange): `grant_type=authorization_code`, `code`, `redirect_uri`
  (the exact URI the handler used), `client_id`, `code_verifier`, `resource`. Public client: the
  exchange sends **no client secret and no client-authentication header**
  (`token_endpoint_auth_method=none` is client configuration, not a request field).
- Refresh request: `grant_type=refresh_token`, `refresh_token`, `client_id`, `resource`, and
  `scope` only to narrow.

**Flow.**

- Attach the stored access token as `Authorization: Bearer` on each outgoing request.
- On a `401` carrying `WWW-Authenticate`, run discovery: RFC 9728 protected-resource metadata
  (from the challenge's `resource_metadata`, else the well-known path), then RFC 8414
  authorization-server metadata.
- **Discovery validation:** the RFC 9728 `resource` value must equal the requested canonical
  resource; the RFC 8414 `issuer` must exactly equal the metadata URL's issuer; all endpoints must
  be `https` (except `http://127.0.0.1`/`localhost` for local testing). When
  `authorization_servers` has multiple entries, selection is configurable and otherwise the first
  is used deterministically. If metadata advertises `code_challenge_methods_supported`, it must
  include `S256`; if it explicitly omits `S256` while listing methods, fail closed.
- PKCE `S256`: a random `code_verifier`, `code_challenge = base64url(SHA-256(verifier))` via
  `crypto.subtle.digest` and `@sozai/codec` base64url.
- **State is generated and held in the OAuth core**, not the handler. The core generates a random
  single-use `state`, passes it to the handler, compares the returned value itself, consumes it
  once, and rejects any mismatch **before** the code exchange. The handler only captures the
  redirect result.
- Invoke `AuthorizationHandler.authorize(...)`, receive `{ code, state, redirectUri }` (or an
  OAuth `error`), validate `state`, exchange the code (reusing the returned `redirectUri`), persist
  through `TokenStore`.

**Token lifecycle.**

```ts
type StoredTokens = {
  accessToken: string
  tokenType: string            // must be a bearer type; else rejected
  refreshToken?: string
  expiresAt?: number           // epoch seconds, from expires_in + now (not from a JWT exp)
  scope?: string
}
```

Expiry derives from the token response `expires_in` (access tokens may be **opaque** — do not
assume a JWT `exp`). Refresh happens pre-emptively when within `clockSkewSeconds` of `expiresAt`,
and on a `401` a refresh is attempted before a full re-authorization. A rotated `refresh_token`
atomically replaces the stored one; an unusable record is cleared.

**Non-recursive protocol fetch.** Discovery, token, and refresh HTTP calls use the **unwrapped
`next`** fetch (never the composed middleware — that would recurse and would try to attach a token
to the token endpoint itself).

**Single-flight.** Refresh and authorization are single-flighted per `TokenStore` key: concurrent
`401`s (long POST/SSE traffic plus the reconnecting GET loop) coalesce onto one in-flight
refresh/authorize, re-check the store after acquiring the lock, and each request is bounded to a
single auth retry.

Exported interfaces:

The handler chooses its own `redirect_uri` — a loopback handler only knows it after binding
`127.0.0.1:0` — so the core cannot pre-build the authorization URL (which must embed
`redirect_uri`). The core therefore hands the handler a **URL builder** rather than a finished URL:
the core still owns every other parameter (`client_id`, `scope`, PKCE, `resource`, `state`), the
handler supplies its `redirectUri`, and returns it for reuse at the token endpoint.

```ts
interface AuthorizationHandler {
  authorize(params: {
    // Stamps the handler's redirect_uri into the core-built authorization URL.
    buildAuthorizationUrl(redirectUri: string): string
    state: string
  }): Promise<{ code: string; state: string; redirectUri: string }>
}

interface TokenStore {
  get(key: string): Promise<StoredTokens | undefined>
  set(key: string, tokens: StoredTokens): Promise<void>
  clear(key: string): Promise<void>
}
```

`@kokuin/token` is **not** a dependency of this unit. A JWT-bearer client-assertion grant
(machine auth / SEP-991) is out of scope.

### Unit C — Node handler and store (`@mokei/host-node`)

- `createLoopbackAuthorizationHandler(options?)` returns an `AuthorizationHandler` that:
  - binds an `http.createServer` to `127.0.0.1:0` on a **random single-use callback path**, then
    calls `buildAuthorizationUrl(redirectUri)` with its now-known `http://127.0.0.1:<port>/<path>`;
  - opens the system browser at the built authorization URL via `nano-spawn` — `open` (macOS),
    `xdg-open` (Linux), `cmd.exe /c start ""` (Windows; `start` is a `cmd` builtin and cannot be
    spawned directly);
  - captures the redirect, propagating an OAuth `error`/`error_description` as a rejection;
  - enforces a bounded **timeout** and cancellation, serves a small success/error page, and
    **guarantees server shutdown** on every path;
  - returns `{ code, state, redirectUri }` (state is validated by the OAuth core, and the exact
    `redirectUri` is reused at the token endpoint).
- `createFileTokenStore(path)` returns a file-backed `TokenStore`: owner-only permissions where
  the platform supports it, atomic replace (temp file + rename), strict JSON parsing (corruption
  → treat as empty), and **no token values in logs**. Plaintext-at-rest is documented; an OS
  credential store is a possible future option. The CLI wires this store.

### Unit D — server auth (`@mokei/http-server`)

- `OAuthTokenVerifier` interface — verification takes the **expected resource/audience** as
  context, and issuer + audience/resource + expiry (`exp`, `nbf` with clock tolerance) + signature
  checks are **normative for every verifier**:

  ```ts
  interface OAuthTokenVerifier {
    verifyAccessToken(token: string, ctx: { resource: string }): Promise<AuthInfo>
  }
  type AuthInfo = {
    subject: string
    scopes: string[]
    expiresAt?: number
    raw?: unknown
  }
  ```

- `requireBearerAuth({ verifier, resource, requiredScopes?, resourceMetadataUrl })` — protects a
  request:
  - missing/invalid/expired credentials → `401` with
    `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<url>"` (omit `error` when
    simply absent);
  - insufficient scope → **`403`** with
    `WWW-Authenticate: Bearer error="insufficient_scope", scope="<needed>"`;
  - success → the gate **passes** (returns `undefined`; the request proceeds). The gate does not by
    itself surface `AuthInfo` to MCP handlers — see Identity propagation for that separate,
    deferred channel.
- `createJWKSVerifier({ issuer, jwksUri? })` — `issuer` is **required in all modes** (a JWKS URI
  alone does not identify the accepted issuer); `jwksUri` optionally overrides the JWKS location,
  else it comes from RFC 8414 discovery on `issuer`. Verifies with `crypto.subtle` under a **strict
  `alg` allowlist** (RS256, ES256) with JWK `kty`/`use`/`key_ops` compatibility checks (no algorithm
  confusion), and enforces `iss` (= configured `issuer`), `aud` (= the `ctx.resource` passed to
  `verifyAccessToken`, the single authoritative audience — there is no separate config `audience`),
  `exp`, and `nbf`. JWKS cache: honour HTTP cache-control/TTL; on an unknown `kid`
  or a rotation-related verification failure force **one** refresh; single-flight the fetch; bound
  the key set.
- `createDIDVerifier(options)` — wraps `@kokuin/token` `verifyToken` (ES256/EdDSA, DID issuer) for
  stack-native machine-to-machine tokens, applying the same normative audience/expiry checks.
  Groundwork for scope item 3.
- Scope extraction: map the JWT `scope` claim (space-delimited) to `AuthInfo.scopes`; a
  configurable extractor covers provider-specific claims.

**Composition surface (both serving modes).** `@mokei/http-server` exposes two entry points:
`createHTTPHandler` returns a raw `handleRequest(Request): Promise<Response>`
(`handler.ts:118`), while `serveHTTP` builds a private hono app mounting the MCP route
(`serve.ts:23`). Auth must work for both:

- `requireBearerAuth` is authored as a `Request → Response | undefined` gate (undefined = pass)
  so it composes with the raw `handleRequest` (wrap: run the gate, else delegate).
- `serveHTTP` gains an `auth` option that installs the gate as hono middleware ahead of the MCP
  route.

**Metadata route.** `protectedResourceMetadata(config)` serves the RFC 9728 document, advertising
a correct `resource` identifier and a non-empty `authorization_servers`. The exact path uses RFC
9728 §3.1 **path-insertion**: the well-known segment goes after the host and before the resource's
own path. A root resource (`https://host/`) is served at `/.well-known/oauth-protected-resource`;
a path-bearing resource (`https://host/mcp`) is served at
`/.well-known/oauth-protected-resource/mcp`. `serveHTTP` registers `app.get(<that computed path>,
…)` alongside the MCP route (`serve.ts:23`); raw mode exposes the same as a `Request → Response`
handler. The advertised `resource` must equal the canonical resource the verifier enforces and the
client sends.

**Identity propagation.** The committed surface this iteration is the **gate only**: it allows or
rejects the request and returns no value on success, so it needs no attach channel. Making
`AuthInfo` visible to MCP handlers is a **separate, deferred** decision (taken in planning): the
current `createServer` contract carries transport/hub/connection id only (`handler.ts:24` /
`serve.ts:28`) and has **no auth field**, so exposing identity would add one and would **bind a
session to a single subject** across its POST/GET/DELETE requests. Not built unless planning elects
it.

### Seam threading (host)

`HTTPContextParams` (consumed by `addHTTPContext`, `host.ts:436`) gains the `fetchMiddleware`
field; `addHTTPContext` passes it into the `new HTTPTransport(...)` it constructs. This is the
only forwarding site: `createHostedContext` (`host.ts:112`) receives an already-constructed
`transport` and is unchanged.

## Data flow

**Client authorize:** request → OAuth middleware attaches token → server `401` + challenge →
discover + validate protected-resource then AS metadata → generate PKCE + single-use `state` →
`AuthorizationHandler` opens browser, user consents, redirect returns `code`+`state` → core
validates `state` → token exchange (with `resource`) → `TokenStore.set` → retry original request.
Later requests attach the stored token; the middleware refreshes on `expires_in` and re-authorizes
only when refresh fails. All discovery/token/refresh calls use the unwrapped fetch and are
single-flighted per resource.

**Server verify:** request → `requireBearerAuth` → `verifier.verifyAccessToken(token, { resource })`
→ on success the gate passes and the request proceeds; on missing/invalid → `401`, on insufficient
scope → `403`, each with the correct `WWW-Authenticate` challenge. The metadata endpoint advertises the
authorization server and the canonical `resource`.

## Testing

- **Unit:** RFC 7636 PKCE test vector; RFC 9728/8414 metadata parsing **and** the resource/issuer
  equality + `https` checks; `S256`-support gating; state generate/validate/consume; token
  lifecycle from `expires_in` (opaque tokens), refresh-rotation replacement, clock-skew; JWKS
  verify with WebCrypto-generated RS256 and ES256 keys, unknown-`kid` forced refresh, `alg`
  allowlist rejection; DID verify with `@kokuin/token` `randomIdentity()`; `401` vs `403` challenge
  shapes and required-scope rejection; static-`auth`+OAuth mutual-exclusion error.
- **Integration (in-process):** an `@mokei/http-server` handler protected by `requireBearerAuth`
  (both `serveHTTP` and raw `handleRequest`), a minimal fake authorization server, and an
  `@mokei/http-client` OAuth middleware with a stubbed auto-approving `AuthorizationHandler` —
  exercising authorize → token → refresh → 401 re-auth, plus the metadata endpoint's
  `resource` matching the verifier and client.
- **SDK v2 interop (stretch / follow-up):** verifying against real SDK v2 peers needs an SDK v2
  test harness; tracked as a follow-up.

## Out of scope (captured)

- Dynamic Client Registration (RFC 7591) and Client ID Metadata Documents (SEP-991); servers
  requiring them are unsupported until a later iteration.
- Client JWT-bearer authorization grant (machine auth).
- The full DID machine-to-machine design (scope item 3) beyond shipping the server DID verifier.
- Authorization-server duties (mokei is a resource server / client only; use a dedicated IdP).
- OS credential-store token storage (file store is plaintext; documented).

## Acceptance

- `mokei chat` / `ContextHost.addHTTPContext`, configured with a pre-registered `client_id`,
  connects to an OAuth-protected remote MCP server: discovery (validated) → PKCE authorize →
  token (with `resource`) → authenticated session → refresh on expiry → re-auth on 401.
- `@mokei/http-server` can require bearer tokens with a pluggable verifier enforcing
  issuer/audience/expiry/signature, plus a metadata endpoint, with JWKS and DID verifiers available
  out of the box, correct `401`/`403` challenges, and working composition in both `serveHTTP` and
  raw `handleRequest` modes.
