---
"@mokei/http-client": minor
"@mokei/host-node": minor
"mokei": minor
---

OS keychain token store and `mokei auth`. `@mokei/host-node` adds `createKeychainStore<V>`, a `KeyValueStore` in the OS keychain through `@napi-rs/keyring` (loaded on first use; a `KeychainBackend` can be injected), and `createKeychainTokenStore()` for OAuth tokens under the `mokei-oauth` service. The keychain has no locking, so writes hold a heartbeat lock file in mokei's state directory, the same lock the JSON file store uses, now exported as `withFileLock`. A missing or inaccessible keychain fails with `KeychainUnavailableError`. `createNodeOAuthMiddleware` takes `keychain`, mutually exclusive with `tokensPath`, and the CLI's `/context add-http` takes `--oauth-keychain`. Persistence stays opt-in. `@mokei/http-client` adds `revokeTokens` (RFC 7009: refresh token first, then access token; `unsupported_token_type` is skipped) and exports `canonicalResource`. AS metadata now reads `revocation_endpoint`, and an empty OAuth response body parses as `{}`. New CLI commands: `mokei auth list` shows stored sign-ins (never tokens), and `mokei auth logout <resource>` revokes, then deletes, every sign-in for a resource. It deletes even when revocation fails, exiting `1`. Both take `--keychain` or `--tokens <path>`, and logout also takes `--client-id` and `--no-revoke`.
