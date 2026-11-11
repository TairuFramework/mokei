# React Native Runtime, kokuin OAuth Reuse and Sign-in Deadline Implementation Plan

**Stage:** executing
**Mode:** tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The HTTP transport and OAuth client run on React Native through an injected `Runtime`, OAuth client logic comes from `@kokuin/oauth`, and an interactive sign-in is not cut off by the request timeout.

**Architecture:** `HTTPTransport` takes `runtime?: Runtime` and builds a timed base fetch from `runtime.fetch`; the request timeout is applied there, per network call, only when the transport tags the request with a timeout. The OAuth middleware takes `runtime` and `authorizationTimeout`, uses `@kokuin/oauth` for PKCE, `state`, code exchange, refresh and metadata GETs, and waits for the `AuthorizationHandler` under the caller's signal plus its own budget.

**Tech Stack:** TypeScript, vitest, `@sozai/runtime`, `@kokuin/oauth` `^0.7.4` (0.7.3 adds empty success bodies, kokuin PR #51; 0.7.4 omits an empty `scope`, kokuin PR #52).

**Spec:** `docs/superpowers/specs/2026-11-11-rn-runtime-oauth-reuse-design.md`

## Global Constraints

- `runtime` defaults to `createRuntime()` from `@sozai/runtime`; without it, behaviour is unchanged.
- `authorizationTimeout` is milliseconds, default `600_000`.
- Timeout message stays `Request timed out after <ms>ms`.
- GET stream and DELETE keep today's timing (no new time-to-headers timer): only requests the transport tags get the timeout.
- The authorization URL comes from kokuin `buildAuthorizationURL` with `authorizationParams: { resource }` (empty `scope` omitted from 0.7.4). Revocation's POST moves to kokuin `fetchOAuthJSON` (empty `200` accepted by default from 0.7.3). `requireHTTPS` / `allowLoopback` checks in discovery stay as they are (stricter than kokuin's).
- `OAuthResponseError` is internal; token and discovery failures become kokuin `OAuthTokenError`.
- Conventions: `kigu:conventions`; lint as `rtk proxy pnpm run lint`; rebuild a package before testing its dependants.
- Release: one patch changeset for `@mokei/http-client`, `@mokei/host`, `@mokei/session`.

## Review Focus

- A sign-in that outlasts `timeout` but not `authorizationTimeout` succeeds, and the retried MCP request still gets its own timeout (Task 2).
- Caller abort during the sign-in wait rejects promptly with the caller's reason (Task 2).
- A third-party `fetchMiddleware` that rebuilds `init` without spreading drops the timeout tag: the request then runs without a time-to-headers timeout. Documented in TSDoc (Task 2).
- `invalid_grant` on refresh still clears the stored token after the move to kokuin errors (Task 3).
- `resource` reaches both the token exchange and the refresh body; `scope` reaches the refresh body when scopes are configured (Task 3).

---

### Task 1: Runtime injection

**Files:**
- Modify: `packages/http-client/src/transport.ts` (params type; base fetch ~line 449), `packages/http-client/src/oauth/middleware.ts` (`OAuthClientConfig`, `state` ~line 378), `packages/http-client/src/oauth/pkce.ts`, `packages/http-client/package.json` (add `@sozai/runtime`)
- Modify: `packages/host/src/host.ts` (`HTTPContextParams` ~line 285-303, `addHTTPContext` ~line 632), `packages/session/src/session.ts` (`#setupHTTPContext` ~line 258), plus `AddHTTPContextParams` type
- Test: `packages/http-client/test/runtime.test.ts` (new)

**Interfaces:**
- Produces: `HTTPTransportParams.runtime?: Runtime`; `HTTPContextParams.runtime?: Runtime` (host and session pass it through); `OAuthClientConfig.runtime?: Runtime` (its `getRandomValues` drives `state` and the PKCE verifier).

- [ ] **Step 1: Failing tests** in `runtime.test.ts`:
  - `transport uses runtime.fetch` — `new HTTPTransport({ url, runtime: createRuntime({ fetch: spy }) })`; send one request; `spy` called with the URL and `method: 'POST'`; `globalThis.fetch` (stubbed to throw) never called.
  - `fetchMiddleware wraps runtime.fetch` — middleware records it was given the runtime fetch as `next`.
  - `OAuth state and verifier come from runtime.getRandomValues` — middleware with a runtime whose `getRandomValues` fills `0x01`; on a 401 the handler's `buildAuthorizationURL('http://127.0.0.1/cb')` has `state` equal to `toB64U` of the filled bytes, and the token request's `code_verifier` is the same-length `toB64U` of filled bytes.
  - `host and session pass runtime through` — `host.addHTTPContext({ key, url, runtime })` → first request goes to `spy`.
- [ ] **Step 2: Run, expect FAIL:** `cd packages/http-client && pnpm exec vitest run test/runtime.test.ts`.
- [ ] **Step 3: Implement.** Base fetch `(url, init) => runtime.fetch(url, init)`. `state` and verifier from `runtime.getRandomValues` (Task 3 swaps the PKCE helpers for kokuin's; here only thread `runtime`). TSDoc: React Native passes `@sozai/runtime-expo`'s `createRuntime({ fetch })`.
- [ ] **Step 4: PASS:** same command, then `pnpm exec vitest run && rtk proxy pnpm run test:types` in `packages/http-client`, build it, and run `packages/host` and `packages/session` suites.
- [ ] **Step 5: Commit** `feat(http-client): inject a Runtime for fetch and random values`.

### Task 2: Sign-in outside the request deadline

**Files:**
- Modify: `packages/http-client/src/transport.ts` (POST timer ~line 637, refresh timer ~line 323, base fetch), `packages/http-client/src/oauth/middleware.ts` (`OAuthClientConfig`, handler call ~line 393)
- Test: `packages/http-client/test/oauth-sign-in-deadline.test.ts` (new)

**Interfaces:**
- Produces: internal `REQUEST_TIMEOUT` symbol; `OAuthClientConfig.authorizationTimeout?: number`.
- Consumes: `runtime` from Task 1.

- [ ] **Step 1: Failing tests** (fake timers or short real values: transport `timeout: 50`, handler resolving after 150ms):
  - `a sign-in longer than the request timeout succeeds` — 401 then handler (150ms) then token then 200: the request resolves.
  - `a sign-in past authorizationTimeout fails` — `authorizationTimeout: 100`, handler never resolves but honours its signal: the request fails, and the handler's signal is aborted.
  - `caller abort ends the sign-in wait` — abort the caller's signal at 20ms: handler signal aborted, request rejects.
  - `network calls keep the timeout` — server never sends headers: request fails with `Request timed out after 50ms`.
  - `the tools/list refresh keeps refreshTimeout` — existing refresh path still aborts at `refreshTimeout` (reuse the existing x-mcp-header refresh fixture).
- [ ] **Step 2: Run, expect FAIL:** `pnpm exec vitest run test/oauth-sign-in-deadline.test.ts`.
- [ ] **Step 3: Implement.** Base fetch reads `init[REQUEST_TIMEOUT]`; when set, races time-to-headers against it and throws a timeout error the transport maps to today's message. POST and refresh tag `init` instead of arming their own timers (the controller stays for cancellation). Middleware: handler signal `AbortSignal.any([callerSignal, AbortSignal.timeout(authorizationTimeout)].filter(Boolean))`. TSDoc on `fetchMiddleware`: spread `init` to keep the timeout.
- [ ] **Step 4: PASS:** same command, then full `packages/http-client` suite and types (existing timeout tests in `transport.test.ts` must stay green unchanged).
- [ ] **Step 5: Commit** `fix(http-client): keep interactive sign-in out of the request deadline`.

### Task 3: OAuth on `@kokuin/oauth`

**Files:**
- Modify: `pnpm-workspace.yaml` (catalog `'@kokuin/oauth': ^0.7.4`), `packages/http-client/package.json`
- Modify: `packages/http-client/src/oauth/middleware.ts` (`exchangeRefresh`, `exchangeAuthorizationCode`, `isInvalidGrant`, PKCE/`state`), `packages/http-client/src/oauth/discovery.ts` (metadata GETs), `packages/http-client/src/oauth/revoke.ts` (POST through kokuin `fetchOAuthJSON`; `unsupported_token_type` check on `OAuthTokenError.code`)
- Delete: `packages/http-client/src/oauth/pkce.ts` (and `test/oauth-pkce.test.ts` once its cases move)
- Delete: `packages/http-client/src/oauth/fetch.ts` (no remaining users)
- Test: existing `oauth-*.test.ts` suites; add cases to `oauth-middleware-refresh.test.ts` and `oauth-middleware-authorize.test.ts`

**Interfaces:**
- Consumes: `runtime` (Task 1), `@kokuin/oauth` `generateCodeVerifier`, `deriveCodeChallenge`, `generateState`, `exchangeCode`, `refreshToken`, `fetchOAuthJSON`, `buildAuthorizationURL`, `OAuthTokenError`. Definition passed to kokuin: `{ name: issuer, mode: 'native', clientID, authorizationEndpoint, tokenEndpoint }`; runtime passed as `{ ...runtime, fetch: next }` so token calls stay unwrapped.

- [ ] **Step 1: Failing tests:**
  - `PKCE challenge matches RFC 7636 Appendix B` — verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM` (through the authorize flow's URL).
  - `code exchange sends resource` and `refresh sends resource and scope` — form bodies carry `resource` and, for refresh with configured scopes, `scope`.
  - `invalid_grant on refresh clears the stored token` — stays green after the switch (existing test; confirm it exercises the kokuin error).
  - `revocation accepts an empty 200` — revocation endpoint answers `200` with no body: result `status: 'revoked'`; `unsupported_token_type` still skipped.
- [ ] **Step 2: Run, expect FAIL** where behaviour is new; existing suites must still pass before the swap.
- [ ] **Step 3: Implement** the swap; keep the `token_type` bearer check and `StoredTokens` mapping; `isInvalidGrant` checks `OAuthTokenError.code`; discovery uses `fetchOAuthJSON({ runtime: { fetch }, url, method: 'GET', signal })`.
- [ ] **Step 4: PASS:** full `packages/http-client` suite, types, `pnpm test:packed`.
- [ ] **Step 5: Commit** `refactor(http-client): run the OAuth client flow on @kokuin/oauth`.

### Task 4: Docs and changeset

**Files:**
- Modify: `packages/http-client/README.md` (runtime / React Native, `authorizationTimeout`), `docs/agents/architecture.md` (one line each)
- Create: `.changeset/rn-runtime-oauth-reuse.md` (patch: `@mokei/http-client`, `@mokei/host`, `@mokei/session`)

- [ ] **Step 1:** Write docs and changeset; `pnpm change status`.
- [ ] **Step 2:** Full check: `rtk proxy pnpm run build && pnpm -r --no-bail run test && rtk proxy pnpm run lint` (known flakes: host-node SIGKILL timing, integration daemon start under load -- rerun alone).
- [ ] **Step 3: Commit** `docs: React Native runtime and sign-in deadline`.
