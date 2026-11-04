---
"@mokei/context-server": minor
"@mokei/http-server": minor
"@mokei/http-client": minor
"@mokei/host-node": minor
---

OAuth hardening. `2025-11-25` HTTP sessions are now bound to the issuer and subject that sent `initialize`: a request from any other identity naming the session (POST, GET or DELETE) gets the same 404 as an unknown session. Session handlers receive each request's own auth through the new `ContextServer` `resolveAuth` param, which `createServer` now receives alongside `auth`. `request.auth` is a `RequestAuth` that adds `expiresAt` and `claims` (the verifier's decoded claims, surfaced from `AuthInfo.raw`). On the client, a generic `KeyValueStore<V>` (`get`, `set`, `delete`, `keys`, atomic `update`) is exported with `createMemoryStore` and, in `@mokei/host-node`, `createJSONFileStore`, whose writes are locked across processes. `TokenStore` is now `KeyValueStore<StoredTokens>`. **Breaking:** `TokenStore.clear` is renamed `delete`, and `update` and `keys` are required. Tokens are keyed by `tokenStoreKey({ resource, clientID, scopes })`, so existing stored tokens are ignored and each user signs in once. Middlewares sharing a store share in-flight refreshes and sign-ins, refreshes run inside `store.update` (so processes sharing a tokens file redeem a rotating refresh token once), and sign-ins through one handler run one at a time.
