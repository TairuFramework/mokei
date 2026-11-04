# OAuth: session identity binding, claims, token coordination

**Date:** 2026-11-04
**Status:** implemented on the branch; move to `completed/` when it merges
**Branch:** `claude/oauth-hardening`
**Origin:** `docs/agents/plans/backlog/2026-09-04-oauth-hardening-followups.md` (the "pass verified
`AuthInfo` to MCP handlers" item), plus client token problems found while reviewing it.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Fix `2025-11-25` session binding now? | Yes, with per-request auth for session handlers |
| 2 | Server extras | Claims (1b) now. Per-tool scopes and 403 step-up (1c) deferred |
| 3 | Client coordination | A (process-wide flights) and B (atomic store update with a file lock) now. C (daemon-held tokens) later |
| 4 | Storage | A generic exported `KeyValueStore<V>`, with in-memory and JSON-file implementations. `TokenStore` is `KeyValueStore<StoredTokens>`. Persistence stays opt-in: no default file, no OS keychain |

## Server

### 1a. Bind `2025-11-25` sessions to their subject

Today `handleInitialize` builds the session server without `auth`, and any valid bearer token
can drive any session whose `Mcp-Session-Id` it presents.

- `Session` gains `owner?: { issuer?: string; subject: string }`, recorded from the
  `initialize` POST's `AuthInfo`.
- `handleRequest` passes `auth` to GET and DELETE as well as POST.
- Every request naming a session (POST, GET, DELETE) is checked against `owner`: a different
  issuer or subject, or auth present on one side only, answers `404 Session not found`. The
  answer is identical to the unknown-session one, so it reveals nothing about which sessions
  exist.
- Per-request auth: `ContextServer` takes an optional
  `resolveAuth(requestID) => ServerAuth | undefined`, consulted per inbound request before the
  static `auth`. The session handler records each POST request's `AuthInfo` by JSON-RPC id
  before enqueueing the message, and drops the entry when the server writes that id's response
  (or when the session closes). Handlers therefore see the scopes and expiry of the token that
  carried *this* request, not the one that opened the session.
- The session `createServer` call now receives `auth` (the initialize-time info) and
  `resolveAuth`. A `createServer` that forwards only `auth` still gets the initialize-time
  snapshot. Forwarding `resolveAuth` too gives per-request auth.
- Inside `ContextServer`, `#auth` is replaced by an `auth` resolved per request and threaded
  through dispatch (tools, prompts, resources, completion, tasks, listen). Task ownership
  still stores only `{ issuer, subject, scopes }`.

### 1b. Claims for handlers

- `HandlerRequest.auth` becomes `RequestAuth = TaskOwner & { expiresAt?: number; claims?:
  Readonly<Record<string, unknown>> }`.
- `ServerAuth` (the `ServerParams.auth` / `resolveAuth` type) accepts `claims`, and also `raw`,
  so a `@teikyo/oauth` `AuthInfo` can be passed as-is. A plain-object `raw` surfaces as
  `claims`. Claims are documented as signature-verified, verifier-specific, and never stored
  with task ownership.

### Deferred: 1c per-tool scopes and step-up

`createTool({ scopes })`, HTTP 403 `insufficient_scope` with `WWW-Authenticate: scope=…`, and
client 403 step-up handling. Recorded in the OAuth backlog file.

## Client

### Generic storage (`@mokei/http-client`, `@mokei/host-node`)

```ts
type KeyValueStore<V> = {
  get(key: string): Promise<V | undefined>
  set(key: string, value: V): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<Array<string>>
  /** Atomic read-decide-write. `fn` returns the next value, or `undefined` to delete it.
   * Returning `current` itself writes nothing. Throwing writes nothing. */
  update(key: string, fn: (current: V | undefined) => V | undefined | Promise<V | undefined>):
    Promise<V | undefined>
}
```

- `createMemoryStore<V>()` (http-client) serialises `update` per key in-process.
- `createJSONFileStore<V>(path, options?)` (host-node) does an atomic temp-file write and rename
  at mode 0600. Every write (`set`, `delete`, `update`) takes an in-process queue *and* a lock
  file at `<path>.lock`: exclusive create, a heartbeat that refreshes the lock's mtime while it
  is held, and stale takeover after `staleLockMs` (default 10 s) without a heartbeat. No new
  dependency. Reads take no lock, because writes are atomic renames.
- `TokenStore = KeyValueStore<StoredTokens>`. `createMemoryTokenStore` and
  `createFileTokenStore` become thin wrappers. `TokenStore.clear` is renamed `delete`, which
  is a breaking change, recorded in the release intent.

### A. Process-wide flight coordination

- Token keys become `tokenStoreKey({ resource, clientID, scopes })`, exported from
  http-client: a JSON array of the canonical resource, the client ID and the sorted, unique
  scopes. Two configurations with a different client or scope set no longer overwrite each
  other. The issuer is not part of the key, because it is unknown until discovery; it is
  stored inside the record. Tokens stored under the old resource-only key are ignored, so each
  user signs in once after upgrading.
- In-flight refreshes and authorisations are deduplicated through a module-level
  `WeakMap<TokenStore, Map<key, Promise>>`, so every middleware sharing a store shares its
  flights.
- Interactive authorisations are serialised per `AuthorizationHandler`, so contexts that
  share a handler never open two browser windows at once. `createNodeOAuthMiddleware` reuses
  one default loopback handler per timeout, so the CLI's contexts share it.

### B. Cross-process refresh

- A refresh runs inside `store.update(key, …)`: under the lock it re-reads the record. If
  another process already replaced the stale access token, it uses that token and sends no
  request. Otherwise it redeems the refresh token and writes the result before releasing the
  lock, so a rotating refresh token is redeemed once. `invalid_grant` deletes the record
  inside the same update.
- Interactive authorisation does not hold the lock, because it can take minutes. Before
  prompting it re-checks the store for a token another process may have obtained.

## Tests

- http-server: a session opened by subject A refuses POST, GET and DELETE from subject B, or
  with no auth, with 404. Session handlers see the auth of each request (scopes change after a
  token swap), and `claims` reach handlers on both revisions.
- context-server: `resolveAuth` takes precedence over static `auth`, and claims are normalised
  from `raw`.
- http-client: memory-store `update` atomicity. Two middleware instances sharing a store
  refresh once against a rotating-refresh-token fixture. Different `clientID`s on one resource
  keep separate tokens. Concurrent authorisations on one handler are serialised.
- host-node: file-store `update` serialises across stores and across *processes* (child
  processes incrementing a counter under `update`), stale-lock takeover, and two child
  processes that both hold an expired token redeem the rotating refresh token exactly once.

## Out of scope / later

- 1c per-tool scopes and step-up.
- C: the daemon holds tokens.
- An OS keychain store (it would implement `KeyValueStore`).
- `mokei auth list` / `mokei auth logout <resource>` with RFC 7009 revocation (`keys()` makes
  listing possible).
- A persistent default token file.
