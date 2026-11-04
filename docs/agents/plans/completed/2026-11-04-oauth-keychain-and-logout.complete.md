# OAuth keychain store and `mokei auth` logout

**Status:** complete
**Date:** 2026-11-04

## Goal

The last OAuth follow-ons from `backlog/2026-09-04-oauth-hardening-followups.md`: an OS keychain
token store, and a way to list and end stored sign-ins with RFC 7009 revocation.

## Shipped

- **Keychain store** (`@mokei/host-node`). `createKeychainStore<V>` is a `KeyValueStore` with one
  keychain entry per key (account) under a service, values JSON-encoded. It uses `@napi-rs/keyring`
  `^2.1.2` (the stack's version, as in `@kokuin`), imported on first use. `keys()` uses
  `findCredentials`. The keychain has no locking, so `set`, `delete` and `update` are serialised
  per service in-process and, with `lockPath`, across processes. Both this store and the JSON file
  store lock with `@sozai/lock`, through the adapter in `file-lock.ts`, replacing mokei's own
  heartbeat lock. A provably live holder is never taken over. `createKeychainTokenStore` defaults to service
  `mokei-oauth` and a lock in `getStateDir('mokei')`. It returns one store per service and lock
  path, so middlewares share in-flight refreshes. Failures surface as `KeychainUnavailableError`.
- **Wiring.** `createNodeOAuthMiddleware({ keychain })` and the chat command
  `/context add-http … --oauth-keychain`, each exclusive with the tokens-file option.
- **Revocation** (`@mokei/http-client`). `revokeTokens` reads `revocation_endpoint` from the
  issuer's metadata (`fetchAuthServerMetadata`, split out of `discover`). It revokes the refresh
  token, then the access token, as a public client. `unsupported_token_type` is skipped, and no
  issuer or no endpoint is reported as `unsupported`.
- **CLI.** `mokei auth list` lists stored sign-ins from `parseTokenStoreKey` and never prints
  tokens. `mokei auth logout <resource>` revokes and deletes every matching sign-in; it deletes
  even if revocation fails, then exits 1. Both take `--keychain` or `--tokens <path>`, and logout
  takes `--client-id` and `--no-revoke`.

## Decisions

- Persistence stays opt-in. The keychain is used only with `--oauth-keychain`, so nothing writes
  to the OS keychain unasked, and headless machines without one are unaffected.
- A boolean `--oauth-keychain` flag rather than a reserved `--oauth-tokens keychain` value.
- **Daemon-held tokens deferred.** No daemon opens HTTP contexts, and processes already
  coordinate through a shared, locked store. Kept in the backlog with the trigger "a daemon
  connects HTTP contexts".
- Tests use an injected in-memory keychain backend. The real backend was only smoke-tested: this
  container has no Secret Service, which gives the `KeychainUnavailableError` path.
