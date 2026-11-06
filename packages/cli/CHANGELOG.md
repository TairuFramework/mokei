# mokei

## 0.16.0

### Minor Changes

- OS keychain token store and `mokei auth`. `@mokei/host-node` adds `createKeychainStore<V>`, a `KeyValueStore` in the OS keychain through `@napi-rs/keyring` (loaded on first use; a `KeychainBackend` can be injected), and `createKeychainTokenStore()` for OAuth tokens under the `mokei-oauth` service. The keychain has no locking, so writes hold a lock file in mokei's state directory. The JSON file store and the keychain store now both lock with `@sozai/lock`, replacing mokei's own heartbeat lock. A holder whose process is provably alive is never taken over, and `staleLockMs` (default now 60000) applies only when the holder's liveness cannot be proven. An older mokei sharing a tokens file may still take over a lock this version holds for more than its 10-second heartbeat window. A missing or inaccessible keychain fails with `KeychainUnavailableError`. `createNodeOAuthMiddleware` takes `keychain`, mutually exclusive with `tokensPath`, and the CLI's `/context add-http` takes `--oauth-keychain`. Persistence stays opt-in. `@mokei/http-client` adds `revokeTokens` (RFC 7009: refresh token first, then access token; `unsupported_token_type` is skipped) and exports `canonicalResource`. AS metadata now reads `revocation_endpoint`, and an empty OAuth response body parses as `{}`. New CLI commands: `mokei auth list` shows stored sign-ins (never tokens), and `mokei auth logout <resource>` revokes, then deletes, every sign-in for a resource. It deletes even when revocation fails, exiting `1`. Both take `--keychain` or `--tokens <path>`, and logout also takes `--client-id` and `--no-revoke`.

- Move to enkaku 0.23, kokuin 0.7, `@teikyo/oauth` 0.3 and `@hozon/adapter` 0.3. A host must use the same lines. Kokuin 0.7 signing takes `identity.signToken({ payload })`.

- Typed provider errors and chat retry. Providers now report failures as a `ProviderError` (from `@mokei/model-provider`) with a `kind` (`rate_limit`, `overloaded`, `server`, `network`, `timeout`, `auth`, `invalid_request`, `context_length` or `unknown`), `retryable`, `status`, `code` and `retryAfterMs` from `Retry-After`. **Behaviour change:** OpenAI, Anthropic and Ollama requests reject with a `ProviderError` instead of ky's `HTTPError`, `NetworkError` or `TimeoutError`, which stays available as `cause`; code that matched on the ky error types must switch. Llama's request errors are `invalid_request` `ProviderError`s. In-stream errors surface as `error` parts carrying a `ProviderError`: Anthropic's `error` event (previously a plain `Error`), and the OpenAI `{ "error": … }` SSE payload and the Ollama `{ "error": "…" }` line, which previously failed with a `TypeError`. A connection reset mid-stream is a `network` error. Embeddings and model listing retry in the HTTP client (POST included for embeddings), honouring `Retry-After`; Anthropic's `listModels` now honours its `signal`. New exports: `ProviderError`, `isRetryableProviderError`, `toProviderError`, `providerErrorFromResponse`, `parseRetryAfter`, `mapStreamErrors`, `retryStreamChat`, `retryDelay`, `DEFAULT_RETRY_POLICY` and their types, and each provider's `errors` helpers. `Session` retries a chat request that fails with a retryable error before producing any output: 2 retries by default, with exponential backoff and full jitter, honouring `Retry-After`, capped at 30 seconds. `SessionParams.retry`, and `retry` on `chat()` and `streamChatTurn()` (`false` disables), set the policy; `onRetry` and the session's `provider-retry` event report each retry. Retries are recorded as `mokei.retry` events on the one inference span, and a final `ProviderError` sets `error.type` to its kind on the inference and agent spans. `AgentSession` takes a `retry` option and yields a `retry` event, so a rate limit or overload no longer ends a run. `traceStreamChat`'s `start` receives a `recordRetry` hook. The `mokei` chat shows retries and explains provider failures by kind.

### Patch Changes

- The chat tool-call status no longer shows a negative running time (`running -1s`) right after a call starts.

- Flow service startup failures keep their cause. `@mokei/decision-flow-server` throws `RegisteredFlowError` (flow ID and checker issues) for rejected registered flows, re-exported from `@mokei/flow-host`. `@mokei/flow-host-node` throws `FlowFileError` for unreadable or malformed flow files, logs the failing startup stage, flow file and full error, and reports `FlowFileError` and `FlowDefinitionError` statuses with the file path and sanitized issue codes. `mokei daemon start` and the monitor banner show the failing file and issues.

- Updated dependencies:
  - @mokei/anthropic-provider@0.16.0
  - @mokei/app-node@0.16.0
  - @mokei/context-client@0.16.0
  - @mokei/context-protocol@0.16.0
  - @mokei/context-server-node@0.16.0
  - @mokei/flow-client@0.16.0
  - @mokei/flow-host-node@0.16.0
  - @mokei/host@0.16.0
  - @mokei/host-desktop@0.16.0
  - @mokei/host-monitor@0.16.0
  - @mokei/host-node@0.16.0
  - @mokei/host-protocol@0.16.0
  - @mokei/http-client@0.16.0
  - @mokei/llama-provider@0.16.0
  - @mokei/model-provider@0.16.0
  - @mokei/ollama-provider@0.16.0
  - @mokei/openai-provider@0.16.0
  - @mokei/session@0.16.0
  - @mokei/session-node@0.16.0

## 0.15.0

### Minor Changes

- Add durable flows. New packages: `@mokei/flow-host` (portable runtime with approval queue, input inbox, recovery), `@mokei/flow-host-node` (SQLite stores, retention), `@mokei/flow-client` (`FlowControl`, flow MCP server), `@mokei/app-node` (`mokei.json`, single `mokei.db`, telemetry), `@mokei/host-desktop` (native dialogs and notifications; `alerter` on macOS, `zenity` on Linux) and `@mokei/host-monitor` (browser run and inbox monitor). The daemon runs one flow service with live events and startup recovery. CLI gains `mokei daemon`, `flows`, `runs` and `inbox`. Unified traces cover flow runs, MCP requests and contexts, with persistence and monitor history.

  Breaking: `serveHostDaemon` takes a typed `EventEmitter<HostEvents>` from `@sozai/event`. `subscriptions` moves from `ServerParams` to `ServerConfig`.

- Align telemetry with the OpenTelemetry GenAI and MCP semantic conventions: `chat`, `invoke_agent` and `execute_tool` spans, MCP and GenAI metrics, OTLP metrics export, `tracing.parentFrom`, opt-in content capture. Breaking: span names (`mcp.<method>` → `<method> [target]`, `flow.run` → `invoke_workflow {flowID}`, `decision.predict` → `predict {model}`) and attributes (`run.id` → `mokei.run.id`, `flow.id` → `mokei.flow.id`, `mcp.transport` → `network.transport`, `system_one.*` → `gen_ai.*` or `mokei.system_one.*`). Stored traces are not migrated.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.

### Patch Changes

- Updated dependencies:
  - @mokei/anthropic-provider@0.15.0
  - @mokei/app-node@0.15.0
  - @mokei/context-client@0.15.0
  - @mokei/context-protocol@0.15.0
  - @mokei/context-server-node@0.15.0
  - @mokei/flow-client@0.15.0
  - @mokei/flow-host-node@0.15.0
  - @mokei/host@0.15.0
  - @mokei/host-desktop@0.15.0
  - @mokei/host-monitor@0.15.0
  - @mokei/host-node@0.15.0
  - @mokei/host-protocol@0.15.0
  - @mokei/llama-provider@0.15.0
  - @mokei/model-provider@0.15.0
  - @mokei/ollama-provider@0.15.0
  - @mokei/openai-provider@0.15.0
  - @mokei/session@0.15.0
  - @mokei/session-node@0.15.0
