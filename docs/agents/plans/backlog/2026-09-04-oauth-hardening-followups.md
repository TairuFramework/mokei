# OAuth: remaining follow-ups

**Origin:** deferred from the OAuth 2.1 HTTP-transport work
(`docs/agents/plans/completed/2026-09-04-http-auth-oauth.complete.md`) and from
`docs/agents/plans/completed/2026-11-04-oauth-identity-and-token-coordination.complete.md`, which gave MCP
handlers verified identity and claims, bound `2025-11-25` sessions to their subject, and
coordinated client token refresh. DCR, CIMD and the JWT-bearer grant were dropped on 2026-11-04
(see `completed/2026-11-04-backlog-trim.complete.md`). None of these items is a security
bypass; each needs its own design.

## Items

- **Per-tool scope follow-ons.** Per-tool scopes and `403` step-up shipped
  (`completed/2026-11-04-per-tool-oauth-scopes.complete.md`). Still open: advertising tool scopes
  in `tools/list` or filtering the list by the caller's scopes; scopes on prompts and resources;
  and a gate in front of the handler keyed on the `Mcp-Method` / `Mcp-Name` headers, which first
  needs the server to reject requests whose headers do not match the body.

- **Daemon-held tokens, keychain store, logout.** The daemon could own the token store,
  refreshes and sign-in prompts for every context. An OS keychain store would implement
  `KeyValueStore<StoredTokens>`. Add `mokei auth list` / `mokei auth logout <resource>` with
  RFC 7009 revocation, using `TokenStore.keys()` and `parseTokenStoreKey`.
