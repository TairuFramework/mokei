# @mokei/session

## 0.16.0

### Minor Changes

- Typed provider errors and chat retry. Providers now report failures as a `ProviderError` (from `@mokei/model-provider`) with a `kind` (`rate_limit`, `overloaded`, `server`, `network`, `timeout`, `auth`, `invalid_request`, `context_length` or `unknown`), `retryable`, `status`, `code` and `retryAfterMs` from `Retry-After`. **Behaviour change:** OpenAI, Anthropic and Ollama requests reject with a `ProviderError` instead of ky's `HTTPError`, `NetworkError` or `TimeoutError`, which stays available as `cause`; code that matched on the ky error types must switch. Llama's request errors are `invalid_request` `ProviderError`s. In-stream errors surface as `error` parts carrying a `ProviderError`: Anthropic's `error` event (previously a plain `Error`), and the OpenAI `{ "error": … }` SSE payload and the Ollama `{ "error": "…" }` line, which previously failed with a `TypeError`. A connection reset mid-stream is a `network` error. Embeddings and model listing retry in the HTTP client (POST included for embeddings), honouring `Retry-After`; Anthropic's `listModels` now honours its `signal`. New exports: `ProviderError`, `isRetryableProviderError`, `toProviderError`, `providerErrorFromResponse`, `parseRetryAfter`, `mapStreamErrors`, `retryStreamChat`, `retryDelay`, `DEFAULT_RETRY_POLICY` and their types, and each provider's `errors` helpers. `Session` retries a chat request that fails with a retryable error before producing any output: 2 retries by default, with exponential backoff and full jitter, honouring `Retry-After`, capped at 30 seconds. `SessionParams.retry`, and `retry` on `chat()` and `streamChatTurn()` (`false` disables), set the policy; `onRetry` and the session's `provider-retry` event report each retry. Retries are recorded as `mokei.retry` events on the one inference span, and a final `ProviderError` sets `error.type` to its kind on the inference and agent spans. `AgentSession` takes a `retry` option and yields a `retry` event, so a rate limit or overload no longer ends a run. `traceStreamChat`'s `start` receives a `recordRetry` hook. The `mokei` chat shows retries and explains provider failures by kind.

### Patch Changes

- Updated dependencies:
  - @mokei/context-client@0.16.0
  - @mokei/context-protocol@0.16.0
  - @mokei/context-rpc@0.16.0
  - @mokei/host@0.16.0
  - @mokei/model-provider@0.16.0

## 0.15.0

### Minor Changes

- Add JSON-authored, resumable System One decision flows (`@mokei/decision-flow`, `@mokei/decision-flow-server`) as MCP task-backed tools: static checking, retries, tracing, input elicitation, recovery, per-run approval grants, and flow references with `list_flows` and an input `decline` edge. `check_flow` reports `tool_invalid_schema` for uncompilable tool schemas. Breaking: `checkFlow` and `createDecisionFlowServer` return promises, `checkFlow` requires a `registry`, `flowPlan` takes a `lookup` argument.

- Align telemetry with the OpenTelemetry GenAI and MCP semantic conventions: `chat`, `invoke_agent` and `execute_tool` spans, MCP and GenAI metrics, OTLP metrics export, `tracing.parentFrom`, opt-in content capture. Breaking: span names (`mcp.<method>` → `<method> [target]`, `flow.run` → `invoke_workflow {flowID}`, `decision.predict` → `predict {model}`) and attributes (`run.id` → `mokei.run.id`, `flow.id` → `mokei.flow.id`, `mcp.transport` → `network.transport`, `system_one.*` → `gen_ai.*` or `mokei.system_one.*`). Stored traces are not migrated.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.

- Breaking: stdio `Session.addContext` and the `NodeContextHost`-typed `contextHost` move to `NodeSession` in the new `@mokei/session-node`; `@mokei/session` is portable and React Native safe, and `AgentSession` accepts either. Elicitation works across both MCP revisions with host handlers, context opt-outs, streamed agent events (including `elicitation-complete`) and cancellation. `cancelToolCall(id?)` cancels one call, or all in-flight calls when omitted.

### Patch Changes

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.

- Updated dependencies:
  - @mokei/context-client@0.15.0
  - @mokei/context-protocol@0.15.0
  - @mokei/context-rpc@0.15.0
  - @mokei/host@0.15.0
  - @mokei/model-provider@0.15.0
