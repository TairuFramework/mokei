# OAuth: remaining follow-ups

**Origin:** deferred from the OAuth 2.1 HTTP-transport work
(`docs/agents/plans/completed/2026-09-04-http-auth-oauth.complete.md`) and from
`docs/agents/plans/completed/2026-11-04-oauth-identity-and-token-coordination.complete.md`, which gave MCP
handlers verified identity and claims, bound `2025-11-25` sessions to their subject, and
coordinated client token refresh. DCR, CIMD and the JWT-bearer grant were dropped on 2026-11-04
(see `completed/2026-11-04-backlog-trim.complete.md`). None of these items is a security
bypass; each needs its own design.

## Items

- **Daemon-held tokens.** The daemon could own the token store, refreshes and sign-in prompts
  for every context, so processes would not each hold tokens. Deferred on 2026-11-04
  (`completed/2026-11-04-oauth-keychain-and-logout.complete.md`). No daemon opens HTTP contexts
  today: the host daemon and the flow daemon run stdio servers only, and the CLI's chat is in
  process. Processes already coordinate through a shared store (file or keychain) with locked
  refreshes. **Trigger:** revisit when a daemon starts connecting HTTP contexts, for example flows
  using remote MCP servers.
