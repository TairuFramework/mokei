# OAuth identity and token coordination

**Status:** complete
**Date:** 2026-11-04
**PR:** #82

## Goal

Give MCP handlers verified identity on both protocol revisions, close the `2025-11-25` session
hijack, and stop OAuth clients that share tokens from racing each other's refreshes.

## Shipped

- **Session binding (security fix).** A `2025-11-25` HTTP session belongs to the issuer and
  subject that sent `initialize`. A POST, GET or DELETE from any other identity gets the same
  `404` as an unknown session id.
- **Per-request auth.** `ContextServer` takes `resolveAuth(requestID)`. On the session path,
  `createServer` receives it alongside `auth`, so handlers see the scopes and expiry of the token
  that carried each request.
- **Claims.** `request.auth` is `RequestAuth`: identity, scopes, `expiresAt` and frozen
  verifier `claims` (from `AuthInfo.raw`). Task ownership still stores identity and scopes only.
- **Generic store.** `KeyValueStore<V>` with an atomic `update`, `createMemoryStore`
  (`@mokei/http-client`) and `createJSONFileStore` (`@mokei/host-node`), whose writes take a
  heartbeat lock file shared across processes. `TokenStore` is `KeyValueStore<StoredTokens>`.
- **Token coordination.** Tokens are keyed by `tokenStoreKey({ resource, clientID, scopes })`.
  Middlewares sharing a store share in-flight refreshes and sign-ins. Refreshes run inside
  `store.update`, so processes sharing a tokens file redeem a rotating refresh token once.
  Sign-ins through one handler run one at a time.
- **Breaking (0.16).** `TokenStore.clear` is renamed `delete`, and `update` and `keys` are
  required. Tokens stored under the old resource-only key are ignored, so each user signs in once.

## Decisions

- Persistence stays opt-in (`--oauth-tokens`): no default tokens file, no OS keychain store.
- Coordination lives in the client and the store, not the daemon.

## Deferred

Per-tool scopes with 403 step-up, daemon-held tokens, a keychain store and `mokei auth logout`
are tracked in `backlog/2026-09-04-oauth-hardening-followups.md`.
