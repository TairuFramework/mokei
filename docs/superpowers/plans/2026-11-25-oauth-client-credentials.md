# OAuth Client Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Stage:** executing
**Mode:** tasks

**Goal:** Headless MCP connections through the `io.modelcontextprotocol/oauth-client-credentials` extension: client credentials grant with `private_key_jwt`, built in `@kokuin/oauth` and adopted by `@mokei/http-client`.

**Architecture:** Kokuin gains a client assertion builder and the token request. Mokei gains a registry entry with declaration and advertising switches, one shared OAuth discovery (full MCP order) used by both the PKCE and the new middleware, an isolated store-key namespace with CLI support, the middleware, and `createHTTPClient` / host wiring.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, biome; WebCrypto for signing.

**Spec:** `docs/superpowers/specs/2026-11-25-oauth-client-credentials-design.md`

## Global Constraints

- Kokuin tasks (K1, K2) run in the kokuin repository, on a new branch `feat/oauth-client-credentials` created from its `main`, in its main checkout (not a worktree). Follow kokuin's `AGENTS.md`. All other tasks run on this mokei branch.
- Extension id `io.modelcontextprotocol/oauth-client-credentials`; no `revision`; protocol versions `2025-11-25` and `2026-07-28`; empty method sets; advertised settings `{}`.
- Client authentication is `private_key_jwt` only; algorithms `EdDSA` and `ES256` only; `ES256` signatures are raw `r||s`.
- Assertion: header `{ alg, typ, kid? }`, `typ` default `client-authentication+jwt`; claims `iss = sub = clientID`, `aud` = pinned issuer as a single string, `iat`, `exp = iat + 60` by default, random `jti`, fresh per grant attempt.
- `client_assertion_type` is `urn:ietf:params:oauth:client-assertion-type:jwt-bearer`.
- An assertion is only ever sent to the token endpoint from the pinned issuer's metadata.
- PKCE middleware: existing tests pass unchanged; its resource resolution (`canonicalResource(config.resource ?? url)`) and store keys do not change.
- Discovery fallback advances only on `OAuthTokenError` with `status` `404`, `405` or `410`; everything else is terminal.
- The temporary local kokuin link (Task M4 onwards) is never committed: never stage `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` changes made for it.
- Mokei changesets: patch bumps. Kokuin changeset: patch for `@kokuin/oauth`.
- Committed docs never contain local filesystem paths.

## Review Focus

- Token response without `expires_in` (no `expiresAt`): never re-granted pre-emptively; a `401` still recovers. Test in M4.
- Non-bearer `token_type` (e.g. `DPoP`): rejected, nothing stored. Test in M4.
- Pin `https://as.example.com/` vs metadata `issuer` `https://as.example.com`: refused, error names both values. Test in M2.
- Caller aborts during the grant: request rejects with the abort reason, no record stored, a later request starts a fresh grant. Test in M4.
- Configured `scopes` plus a `401` challenge naming other scopes: configured scopes are sent unchanged (challenge scopes only when `scopes` is unset). Test in M4.

---

### Task K1: Client assertion (kokuin)

**Files:**
- Create: `packages/oauth/src/client-assertion.ts`
- Modify: `packages/oauth/src/index.ts`
- Test: `packages/oauth/test/client-assertion.test.ts`

**Interfaces:**
- Produces:
  - `type ClientAssertionAlgorithm = 'EdDSA' | 'ES256'`
  - `type ClientAssertionSigner = { alg: ClientAssertionAlgorithm; kid?: string; sign(data: Uint8Array): Promise<Uint8Array> }`
  - `createWebCryptoAssertionSigner(params: { alg: ClientAssertionAlgorithm; privateKey: CryptoKey; kid?: string }): ClientAssertionSigner` (Ed25519 / ECDSA P-256 SHA-256 via `crypto.subtle.sign`)
  - `createClientAssertion(params: { signer: ClientAssertionSigner; clientID: string; audience: string; lifetimeSeconds?: number; now?: () => number; typ?: string; getRandomValues?: Runtime['getRandomValues'] }): Promise<string>`
  - `const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'`

- [ ] **Step 1: Write failing tests** in `client-assertion.test.ts`, generating keys with `crypto.subtle.generateKey`:
  - `header and claims`: decode the JWS; header equals `{ alg: 'EdDSA', typ: 'client-authentication+jwt', kid: 'k1' }`; claims `iss === sub === 'client-a'`, `aud === 'https://as.example.com'` (string, not array), `exp - iat === 60` with `now: () => 1000`, `jti` a non-empty string.
  - `typ override`: `typ: 'JWT'` appears in the header; no `kid` key when the signer has none.
  - `lifetime`: `lifetimeSeconds: 120` gives `exp - iat === 120`.
  - `verifies EdDSA` and `verifies ES256`: `crypto.subtle.verify` over `header.payload` with the public key returns `true`; the `ES256` signature is 64 bytes.
  - `fresh jti`: two calls give different `jti`.
- [ ] **Step 2: Run** `pnpm --filter @kokuin/oauth exec vitest run test/client-assertion.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `client-assertion.ts`. Use `@sozai/codec` (`toB64U`, `fromUTF` or equivalents already used in the package) for encoding; `jti` from 16 random bytes, base64url. Export from `index.ts`.
- [ ] **Step 4: Run** the same command plus `pnpm --filter @kokuin/oauth run test:types`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(oauth): client assertion builder for private_key_jwt`.

### Task K2: Client credentials token request (kokuin)

**Files:**
- Create: `packages/oauth/src/client-credentials.ts`
- Modify: `packages/oauth/src/index.ts`, `packages/oauth/README.md` (short section), `.changeset/` (new patch intent for `@kokuin/oauth`)
- Test: `packages/oauth/test/client-credentials.test.ts`

**Interfaces:**
- Consumes: `CLIENT_ASSERTION_TYPE` (K1); `fetchOAuthJSON`, `validateTokenResponse`, `extraForm` from `exchange.ts` / `http.ts` (export `validateTokenResponse` and `extraForm` internally if needed).
- Produces: `requestClientCredentialsToken(params: { runtime: Runtime; tokenEndpoint: string; clientID: string; assertion: string; scope?: string; extraParams?: Record<string, string> } & RequestOptions): Promise<TokenResponse>`

- [ ] **Step 1: Write failing tests** with `fake-runtime.ts`:
  - `form fields`: body has exactly `grant_type=client_credentials`, `client_id`, `client_assertion_type` (the constant), `client_assertion`, `scope` when given, plus `resource` from `extraParams`.
  - `extraParams cannot override`: `extraParams: { grant_type: 'x', client_assertion: 'y', client_id: 'z', client_assertion_type: 'w' }` leaves the grant's values.
  - `no scope`: omitted `scope` sends no `scope` field.
  - `error mapping`: a `400 { error: 'invalid_client' }` rejects with `OAuthTokenError` code `invalid_client`, status 400.
  - `redirect refused`: the fetch is called with `redirect: 'error'`.
  - `response validated`: a body without `access_token` rejects.
- [ ] **Step 2: Run** `pnpm --filter @kokuin/oauth exec vitest run test/client-credentials.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** via `fetchOAuthJSON` and `validateTokenResponse`, mirroring `exchangeCode`. Export from `index.ts`. Add README section and the changeset.
- [ ] **Step 4: Run** `pnpm --filter @kokuin/oauth test` and kokuin lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(oauth): client credentials grant`.

### Task M1: Registry entry, declaration and advertising

**Files:**
- Modify: `packages/context-protocol/src/extensions.ts`, `packages/context-protocol/src/index.ts`
- Modify: `packages/context-client/src/types.ts` (`ClientParams`), `packages/context-client/src/client.ts` (constructor, near the `tasks` declaration)
- Modify: `packages/context-server/src/server.ts` (`ServerParams` and constructor, near `tasks`)
- Test: `packages/context-protocol/test/extensions.test.ts`, `packages/context-client/test/` and `packages/context-server/test/` (extension tests already present for Tasks)

**Interfaces:**
- Produces:
  - `OAUTH_CLIENT_CREDENTIALS: ExtensionDefinition` (in `EXTENSIONS`)
  - `ClientParams.oauthClientCredentials?: boolean` (default `false`): declares the extension.
  - `ServerParams.oauthClientCredentials?: boolean` (default `false`): advertises it with `{}`.
    The flag lives on `ContextServer` because `@mokei/http-server` callers build the server
    themselves in `createServer`; the http-server README documents it (Task M5).

- [ ] **Step 1: Write failing tests:**
  - protocol: `OAUTH_CLIENT_CREDENTIALS` has the id, no `revision`, both versions, empty method sets, and is in `EXTENSIONS`.
  - client: with `oauthClientCredentials: true`, `initialize` on `2025-11-25` carries `capabilities.extensions['io.modelcontextprotocol/oauth-client-credentials']` equal to `{}`; on `2026-07-28` the per-request `_meta` client capabilities carry it. Without the flag, neither does.
  - server: with the flag, `server/discover` and the `2025-11-25` `initialize` result list it as `{}`; without, neither does. `getServerExtension(OAUTH_CLIENT_CREDENTIALS)` returns `{}` against a flagged server on both revisions.
- [ ] **Step 2: Run** `pnpm --filter @mokei/context-protocol --filter @mokei/context-client --filter @mokei/context-server test`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Mirror the `tasks` pattern (`this.#extensions.set(OAUTH_CLIENT_CREDENTIALS, declareExtension(OAUTH_CLIENT_CREDENTIALS))`). Rebuild `context-protocol` before running dependents.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(context-protocol): oauth client credentials extension entry`.

### Task M2: Shared OAuth discovery

**Files:**
- Modify: `packages/http-client/src/oauth/discovery.ts`, `packages/http-client/src/oauth/middleware.ts` (the `discover` call only)
- Test: `packages/http-client/test/oauth-discovery.test.ts`

**Interfaces:**
- Produces (replacing today's `discover` / `fetchAuthServerMetadata` signatures; update every caller, including `revoke.ts`):
  - `AuthServerMetadata`: `authorization_endpoint?: string` becomes optional; adds `grant_types_supported?: unknown`, `token_endpoint_auth_methods_supported?: unknown`, `token_endpoint_auth_signing_alg_values_supported?: unknown`.
  - `type DiscoveryGrant = 'authorization_code' | 'client_credentials'`
  - `discover(params: { resource: string; resourceMetadataURL?: string; fetch: FetchLike; grant: DiscoveryGrant; selectAuthServer?: (servers: Array<string>) => string; expectedIssuer?: string; signal?: AbortSignal }): Promise<{ prm: ProtectedResourceMetadata; as: AuthServerMetadata }>`. With `expectedIssuer`, it must be in `authorization_servers` (else `Error` naming the pin and the list) and `selectAuthServer` is ignored.
  - `fetchAuthServerMetadata(params: { issuer: string; fetch: FetchLike; grant: DiscoveryGrant; allowLoopback?: boolean; signal?: AbortSignal }): Promise<AuthServerMetadata>`
  - `authServerMetadataURLs(issuer: string): Array<string>` and `protectedResourceMetadataURLs(resource: string): Array<string>` (exported for tests).

Candidate orders (exact):
- PRM, no challenge URL: `{origin}/.well-known/oauth-protected-resource{path}`, then `{origin}/.well-known/oauth-protected-resource` (second only when `path` is non-empty). A challenge `resource_metadata` URL is the only candidate.
- AS, issuer with path `/p`: `{origin}/.well-known/oauth-authorization-server/p`, `{origin}/.well-known/openid-configuration/p`, `{origin}/p/.well-known/openid-configuration`. Root issuer: `{origin}/.well-known/oauth-authorization-server`, `{origin}/.well-known/openid-configuration`.

Grant requirements: `authorization_code` keeps today's checks (`authorization_endpoint` https, `S256` when methods listed); `client_credentials` requires only a secure `token_endpoint`. Both check `issuer` equality, `token_endpoint` and `revocation_endpoint` https.

- [ ] **Step 1: Write failing tests** (fake fetch recording URLs):
  - `authServerMetadataURLs` and `protectedResourceMetadataURLs` return the exact orders above.
  - PRM path-specific `404` falls back to root; challenge URL is used alone.
  - AS: OAuth `404` → OIDC path insertion used; both `404` → path appending used; for a root issuer OAuth then OIDC.
  - unchanged first URL: a server answering today's URLs resolves the same documents with exactly two fetches.
  - terminal: `500`, unparsable body, oversized body, aborted signal, PRM `resource` mismatch, AS `issuer` mismatch each reject without fetching the next candidate.
  - `expectedIssuer` absent from `authorization_servers` rejects before any AS fetch; message contains both the pin and the listed servers.
  - Review Focus: pin `https://as.example.com/` with metadata `issuer` `https://as.example.com` rejects; message names both.
  - `client_credentials` accepts metadata with no `authorization_endpoint` and `code_challenge_methods_supported: ['plain']`; `authorization_code` still rejects both.
- [ ] **Step 2: Run** `pnpm --filter @mokei/http-client exec vitest run test/oauth-discovery.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** PKCE passes `grant: 'authorization_code'`; fallback eligibility is `error instanceof OAuthTokenError && [404, 405, 410].includes(error.status)`.
- [ ] **Step 4: Run** `pnpm --filter @mokei/http-client test`. Expected: all PASS, existing PKCE tests unchanged.
- [ ] **Step 5: Commit** `feat(http-client): MCP discovery fallbacks shared by OAuth grants`.

### Task M3: Client-credentials store keys and CLI

**Files:**
- Modify: `packages/http-client/src/oauth/store.ts`, `packages/http-client/src/index.ts`
- Modify: `packages/cli/src/commands/auth.ts`
- Test: `packages/http-client/test/oauth-store.test.ts`, `packages/cli/test/auth-command.test.ts`

**Interfaces:**
- Produces:
  - `clientCredentialsStoreKey(params: { issuer: string; resource: string; clientID: string; scopes?: Array<string> }): string` = `JSON.stringify(['client_credentials', issuer, resource, clientID, sortedUniqueScopes])`
  - `parseClientCredentialsStoreKey(key: string): { issuer: string; resource: string; clientID: string; scopes: Array<string> } | undefined`
  - `tokenStoreKey` / `parseTokenStoreKey` unchanged.

- [ ] **Step 1: Write failing tests:**
  - store: round trip; scopes sorted and de-duplicated; `parseTokenStoreKey` returns `undefined` for a client-credentials key and `parseClientCredentialsStoreKey` returns `undefined` for a legacy key.
  - CLI `auth list`: a store with one legacy and one client-credentials record lists both; JSON rows gain `grant: 'authorization_code' | 'client_credentials'`; the table gains a `GRANT` column.
  - CLI `auth logout <resource>`: a client-credentials record stored with resource `https://mcp.example.com/mcp/?tenant=a` is deleted by that exact argument, and not by `https://mcp.example.com/mcp`; its outcome is `revocation: 'skipped'` with `detail: 'client credentials tokens are deleted locally only'`, even with revoke on; `revokeTokens` is not called for it. Legacy records still match by `canonicalResource`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/http-client exec vitest run test/oauth-store.test.ts` and `pnpm --filter @mokei/cli exec vitest run test/auth-command.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Rebuild `@mokei/http-client` before the CLI tests.
- [ ] **Step 4: Run** the Step 2 commands. Expected: PASS.
- [ ] **Step 5: Commit** `feat(http-client): client credentials token store keys`.

### Task M4: Client credentials middleware

Before this task, the controller builds the kokuin branch and points this workspace's `@kokuin/oauth` at it with an uncommitted link (the location is given in the dispatch, not here).

**Files:**
- Create: `packages/http-client/src/oauth/client-credentials.ts`
- Modify: `packages/http-client/src/oauth/middleware.ts` (export `toStoredTokens`, `runtimeFor` and the `storeFlights` primitive for reuse; no behaviour change), `packages/http-client/src/index.ts`
- Test: `packages/http-client/test/oauth-client-credentials.test.ts`

**Interfaces:**
- Consumes: K1, K2 (`createClientAssertion`, `requestClientCredentialsToken`, `ClientAssertionSigner`); M2 `discover({ grant: 'client_credentials', expectedIssuer })`; M3 `clientCredentialsStoreKey`.
- Produces:
  - `type ClientCredentialsConfig = { clientID: string; issuer: string; signer: ClientAssertionSigner; scopes?: Array<string>; resource?: string; store?: TokenStore; clockSkewSeconds?: number; now?: () => number; assertionLifetimeSeconds?: number; runtime?: Runtime }`
  - `createClientCredentialsMiddleware(config: ClientCredentialsConfig): FetchMiddleware`
  - re-export `ClientAssertionSigner`, `createWebCryptoAssertionSigner` from `@mokei/http-client`.

Behaviour (from the spec, "Client credentials middleware"): explicit `resource` verbatim (absolute `https`, loopback `http`, no fragment, else throw at construction); default `canonicalResource(url)`. Records stored with `issuer` and `tokenEndpoint`; used only when `issuer === config.issuer`. Single-flight keyed by the client-credentials key. Metadata compatibility per spec: present fields must be string arrays containing `client_credentials` / `private_key_jwt` / `signer.alg`; distinct errors `AS metadata does not list grant client_credentials`, `AS metadata does not list auth method private_key_jwt`, `AS metadata does not list signing alg <alg>`, and `AS metadata field <name> is malformed`.

- [ ] **Step 1: Write failing tests** against a fake MCP server + AS (fetch stub):
  - cold `401` → discovery → one token request (form contains a JWT whose `aud` is the pin and `iss` the client ID) → retried request carries `Bearer <token>`.
  - pin not in `authorization_servers`: rejects; token endpoint never called.
  - token-only AS metadata (no `authorization_endpoint`) accepted.
  - compatibility: for each of the three fields, absent → grant proceeds; `'private_key_jwt'` as a string (not array) → malformed error; array lacking the value → its distinct error; no token request in the failing cases.
  - explicit `resource: 'https://mcp.example.com/mcp/?tenant=a'` sent verbatim as the `resource` form field and in the store key.
  - near expiry (`expires_in: 30`, skew 60): next request re-grants without any metadata fetch, with a new `jti`.
  - second `401` after a fresh grant is returned to the caller; `403` passes through without a grant.
  - `scopes` unset and challenge `scope="a b"` → `scope=a b` sent.
  - 5 concurrent cold requests → exactly one token request.
  - shared store with `createOAuthMiddleware` for the same client ID and resource: PKCE never attaches the service token and its own record is untouched.
  - Review Focus tests: no `expires_in` (no pre-emptive grant; `401` recovers); `token_type: 'DPoP'` rejected, nothing stored; abort during grant rejects with the reason and stores nothing, next request grants afresh; configured `scopes: ['x']` with challenge `scope="y"` sends `scope=x`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/http-client exec vitest run test/oauth-client-credentials.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `client-credentials.ts`.
- [ ] **Step 4: Run** `pnpm --filter @mokei/http-client test`. Expected: PASS.
- [ ] **Step 5: Commit** only `packages/http-client/src`, `packages/http-client/test` paths: `feat(http-client): oauth client credentials middleware`.

### Task M5: createHTTPClient and host wiring, docs

**Files:**
- Modify: `packages/http-client/src/transport.ts` (`CreateHTTPClientParams`, `createHTTPClient`)
- Modify: `packages/host/src/types.ts` (`HTTPContextParams`), `packages/host/src/host.ts` (`addHTTPContext`), `packages/host/src/hosted-context.ts` (`CreateHostedContextParams`)
- Modify: `packages/http-client/README.md`, `packages/http-server/README.md`, `docs/agents/architecture.md`, `.changeset/oauth-client-credentials.md`
- Test: `packages/http-client/test/client.test.ts`, `packages/host/test/` (HTTP context tests)

**Interfaces:**
- Consumes: M1 `oauthClientCredentials`; M4 `ClientCredentialsConfig`, `createClientCredentialsMiddleware`.
- Produces:
  - `CreateHTTPClientParams.clientCredentials?: ClientCredentialsConfig`: builds the middleware as the transport's `fetchMiddleware` and sets `oauthClientCredentials: true`.
  - `HTTPContextParams.clientCredentials?: ClientCredentialsConfig`: same, built once per `addHTTPContext` and reused by every reconnect build; `CreateHostedContextParams.oauthClientCredentials?: boolean` passed to `ContextClient`.
  - Both throw `clientCredentials cannot be combined with fetchMiddleware` when both are given (my call: no implicit middleware composition).

- [ ] **Step 1: Write failing tests:**
  - `createHTTPClient({ clientCredentials })` against a fake server: the first request after a `401` carries the bearer token, and the client declares the extension (check `_meta` on `2026-07-28`, `initialize` on `2025-11-25`).
  - combining with `fetchMiddleware` throws the exact message, in both entry points.
  - host: `addHTTPContext({ clientCredentials })` declares the extension; after a forced reconnect the new client still declares it and reuses the stored token (one token request in total).
- [ ] **Step 2: Run** `pnpm --filter @mokei/http-client --filter @mokei/host test`. Expected: new tests FAIL.
- [ ] **Step 3: Implement**, then docs: http-client README section (middleware, signer adapter, `createHTTPClient` option, hand-built `oauthClientCredentials`), http-server README (server `oauthClientCredentials`), architecture.md auth paragraph, changeset (patch: `context-protocol`, `context-client`, `context-server`, `http-client`, `host`, `cli`).
- [ ] **Step 4: Run** `rtk proxy pnpm run build`, `pnpm test`, `rtk proxy pnpm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** (not the link files) `feat(http-client): client credentials in createHTTPClient and host`.

### Task M6: Adopt the published kokuin release

Blocked until the user publishes the `@kokuin/oauth` release from the kokuin branch.

**Files:**
- Modify: `pnpm-workspace.yaml` (catalog `@kokuin/oauth` to the published version), `pnpm-lock.yaml`

- [ ] **Step 1:** Remove the local link; set the catalog entry to the published version; `pnpm install`.
- [ ] **Step 2: Run** `rtk proxy pnpm run build`, `pnpm test`, `rtk proxy pnpm run lint`. Expected: PASS.
- [ ] **Step 3: Commit** `chore: adopt @kokuin/oauth client credentials release`.
