# @mokei/host-node

## 0.16.0

### Minor Changes

- OAuth hardening. `2025-11-25` HTTP sessions are now bound to the issuer and subject that sent `initialize`: a request from any other identity naming the session (POST, GET or DELETE) gets the same 404 as an unknown session. Session handlers receive each request's own auth through the new `ContextServer` `resolveAuth` param, which `createServer` now receives alongside `auth`. `request.auth` is a `RequestAuth` that adds `expiresAt` and `claims` (the verifier's decoded claims, surfaced from `AuthInfo.raw`). On the client, a generic `KeyValueStore<V>` (`get`, `set`, `delete`, `keys`, atomic `update`) is exported with `createMemoryStore` and, in `@mokei/host-node`, `createJSONFileStore`, whose writes are locked across processes. `TokenStore` is now `KeyValueStore<StoredTokens>`. **Breaking:** `TokenStore.clear` is renamed `delete`, and `update` and `keys` are required. Tokens are keyed by `tokenStoreKey({ resource, clientID, scopes })`, so existing stored tokens are ignored and each user signs in once. Middlewares sharing a store share in-flight refreshes and sign-ins, refreshes run inside `store.update` (so processes sharing a tokens file redeem a rotating refresh token once), and sign-ins through one handler run one at a time.

- OS keychain token store and `mokei auth`. `@mokei/host-node` adds `createKeychainStore<V>`, a `KeyValueStore` in the OS keychain through `@napi-rs/keyring` (loaded on first use; a `KeychainBackend` can be injected), and `createKeychainTokenStore()` for OAuth tokens under the `mokei-oauth` service. The keychain has no locking, so writes hold a lock file in mokei's state directory. The JSON file store and the keychain store now both lock with `@sozai/lock`, replacing mokei's own heartbeat lock. A holder whose process is provably alive is never taken over, and `staleLockMs` (default now 60000) applies only when the holder's liveness cannot be proven. An older mokei sharing a tokens file may still take over a lock this version holds for more than its 10-second heartbeat window. A missing or inaccessible keychain fails with `KeychainUnavailableError`. `createNodeOAuthMiddleware` takes `keychain`, mutually exclusive with `tokensPath`, and the CLI's `/context add-http` takes `--oauth-keychain`. Persistence stays opt-in. `@mokei/http-client` adds `revokeTokens` (RFC 7009: refresh token first, then access token; `unsupported_token_type` is skipped) and exports `canonicalResource`. AS metadata now reads `revocation_endpoint`, and an empty OAuth response body parses as `{}`. New CLI commands: `mokei auth list` shows stored sign-ins (never tokens), and `mokei auth logout <resource>` revokes, then deletes, every sign-in for a resource. It deletes even when revocation fails, exiting `1`. Both take `--keychain` or `--tokens <path>`, and logout also takes `--client-id` and `--no-revoke`.

- Unified traces follow-ons. Context traces are named by their server: the recorder reads open spans live, so `mokei.server.name` (now also set by the daemon proxy from `initialize` or `server/discover`) reaches trace summaries and open-span snapshots. It is a summary attribute and part of the search text. A new `trace_calls` index records spans that call into another trace (`mokei.context.trace_id`). `traces.get` returns them as `calls` with `callsTruncated`, and the monitor lists them under "Called from". A new `traces.logs` procedure pages a trace's logs newest first, by span, before a time or with a cursor, and the monitor uses it for "Load older logs". A child-only summary delta dropped at the hydration limit is now looked up and counted as lost when its trace is indexed, and one left after hydration fails for good is counted too. **Breaking:** `events` takes a `{ types? }` param, and the daemon subscribes only to those types (`flow-client` asks for its three flow events). Every caller must now send `param` (`{}` for all events), so restart the daemon after upgrading. **Breaking:** `context:message` is removed from the `events` stream and from `@mokei/host-protocol`; MCP traffic is carried by trace spans.

- Move to enkaku 0.23, kokuin 0.7, `@teikyo/oauth` 0.3 and `@hozon/adapter` 0.3. A host must use the same lines. Kokuin 0.7 signing takes `identity.signToken({ payload })`.

### Patch Changes

- Updated dependencies:
  - @mokei/context-client@0.16.0
  - @mokei/context-protocol@0.16.0
  - @mokei/host@0.16.0
  - @mokei/host-protocol@0.16.0
  - @mokei/http-client@0.16.0
  - @mokei/logger@0.16.0

## 0.15.0

### Minor Changes

- Add durable flows. New packages: `@mokei/flow-host` (portable runtime with approval queue, input inbox, recovery), `@mokei/flow-host-node` (SQLite stores, retention), `@mokei/flow-client` (`FlowControl`, flow MCP server), `@mokei/app-node` (`mokei.json`, single `mokei.db`, telemetry), `@mokei/host-desktop` (native dialogs and notifications; `alerter` on macOS, `zenity` on Linux) and `@mokei/host-monitor` (browser run and inbox monitor). The daemon runs one flow service with live events and startup recovery. CLI gains `mokei daemon`, `flows`, `runs` and `inbox`. Unified traces cover flow runs, MCP requests and contexts, with persistence and monitor history.

  Breaking: `serveHostDaemon` takes a typed `EventEmitter<HostEvents>` from `@sozai/event`. `subscriptions` moves from `ServerParams` to `ServerConfig`.

- Align telemetry with the OpenTelemetry GenAI and MCP semantic conventions: `chat`, `invoke_agent` and `execute_tool` spans, MCP and GenAI metrics, OTLP metrics export, `tracing.parentFrom`, opt-in content capture. Breaking: span names (`mcp.<method>` → `<method> [target]`, `flow.run` → `invoke_workflow {flowID}`, `decision.predict` → `predict {model}`) and attributes (`run.id` → `mokei.run.id`, `flow.id` → `mokei.flow.id`, `mcp.transport` → `network.transport`, `system_one.*` → `gen_ai.*` or `mokei.system_one.*`). Stored traces are not migrated.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.

- Breaking: stdio `Session.addContext` and the `NodeContextHost`-typed `contextHost` move to `NodeSession` in the new `@mokei/session-node`; `@mokei/session` is portable and React Native safe, and `AgentSession` accepts either. Elicitation works across both MCP revisions with host handlers, context opt-outs, streamed agent events (including `elicitation-complete`) and cancellation. `cancelToolCall(id?)` cancels one call, or all in-flight calls when omitted.

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.

### Patch Changes

- Updated dependencies:
  - @mokei/context-client@0.15.0
  - @mokei/context-protocol@0.15.0
  - @mokei/host@0.15.0
  - @mokei/host-protocol@0.15.0
  - @mokei/http-client@0.15.0
  - @mokei/logger@0.15.0
