# OAuth: remaining follow-ups

**Origin:** deferred from the OAuth 2.1 HTTP-transport work
(`docs/agents/plans/completed/2026-09-04-http-auth-oauth.complete.md`) and from
`docs/agents/plans/completed/2026-11-04-oauth-identity-and-token-coordination.complete.md`, which gave MCP
handlers verified identity and claims, bound `2025-11-25` sessions to their subject, and
coordinated client token refresh. DCR, CIMD and the JWT-bearer grant were dropped on 2026-11-04
(see `completed/2026-11-04-backlog-trim.complete.md`). None of these items is a security
bypass; each needs its own design.

## Items

- **`Mcp-Param-*` validation on the server.** The HTTP server validates `MCP-Protocol-Version`,
  `Mcp-Method` and `Mcp-Name` (`completed/2026-11-04-oauth-scope-follow-ons.complete.md`) but not
  the `Mcp-Param-*` headers. Checking them needs each tool's `x-mcp-header` annotations on the
  server, so `collectHeaderAnnotations` would move out of `@mokei/http-client`. Not a security
  item: the scope check reads the body.

- **Daemon-held tokens, keychain store, logout.** The daemon could own the token store,
  refreshes and sign-in prompts for every context. An OS keychain store would implement
  `KeyValueStore<StoredTokens>`. Add `mokei auth list` / `mokei auth logout <resource>` with
  RFC 7009 revocation, using `TokenStore.keys()` and `parseTokenStoreKey`.
