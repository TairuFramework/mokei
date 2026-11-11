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

- **Sign-in and timeout polish** (deferred from
  `completed/2026-11-11-rn-runtime-oauth-reuse.complete.md`):
  - kokuin's own `timeoutMs` (30s) wins over the transport's tag at default settings, so a hung OAuth
    endpoint reads "The operation was aborted due to timeout" and a `timeout` above 30s is capped for
    OAuth calls. Pass the tag through as `timeoutMs`, or map `TimeoutError` to the transport's
    timeout error.
  - A request that joins another key's in-flight sign-in, or queues behind one on the same handler,
    does not reject promptly on its own caller abort: race the joiner's await against its signal.
  - A handler that ignores its `signal` can overlap the next sign-in after an abort: document on
    `AuthorizationHandler.signal` that handlers must stop on abort.
  - No test pins a retried MCP request that hangs after sign-in (it keeps its timeout by inspection).
  - Linked-signal listeners on the caller's signal are not removed after headers (harmless with
    per-request signals).
