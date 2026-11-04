# OAuth: remaining follow-ups

**Origin:** deferred from the OAuth 2.1 HTTP-transport work
(`docs/agents/plans/completed/2026-09-04-http-auth-oauth.complete.md`) and from
`docs/agents/plans/completed/2026-11-04-oauth-identity-and-token-coordination.complete.md`, which gave MCP
handlers verified identity and claims, bound `2025-11-25` sessions to their subject, and
coordinated client token refresh. DCR, CIMD and the JWT-bearer grant were dropped on 2026-11-04
(see `completed/2026-11-04-backlog-trim.complete.md`). None of these items is a security
bypass; each needs its own design.

## Items

- **Per-tool scopes and step-up (MCP `insufficient_scope`).** Scopes are still enforced
  server-wide only (`requiredScopes`). Add `createTool({ scopes })`, answer HTTP 403
  `insufficient_scope` with `WWW-Authenticate: scope=…` (on `2026-07-28` the gate can read the
  tool from the `Mcp-Method` and name headers without parsing the body), and teach the client
  middleware to step up on 403, not only recover from 401.

- **Daemon-held tokens, keychain store, logout.** The daemon could own the token store,
  refreshes and sign-in prompts for every context. An OS keychain store would implement
  `KeyValueStore<StoredTokens>`. Add `mokei auth list` / `mokei auth logout <resource>` with
  RFC 7009 revocation, using `TokenStore.keys()` and `parseTokenStoreKey`.
