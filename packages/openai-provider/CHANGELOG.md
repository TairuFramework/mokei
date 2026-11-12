# @mokei/openai-provider

## 0.16.1

### Patch Changes

- Send streamed tool calls back with their full arguments. A server that streams a tool call's arguments in several chunks (llama.cpp with LFM3, for one) got only the first chunk back in the next request's history and rejected it; the aggregated call's `raw` now carries the accumulated arguments, and the streamed parts are no longer mutated.

## 0.16.0

### Minor Changes

- Typed provider errors and chat retry. Providers now report failures as a `ProviderError` (from `@mokei/model-provider`) with a `kind` (`rate_limit`, `overloaded`, `server`, `network`, `timeout`, `auth`, `invalid_request`, `context_length` or `unknown`), `retryable`, `status`, `code` and `retryAfterMs` from `Retry-After`. **Behaviour change:** OpenAI, Anthropic and Ollama requests reject with a `ProviderError` instead of ky's `HTTPError`, `NetworkError` or `TimeoutError`, which stays available as `cause`; code that matched on the ky error types must switch. Llama's request errors are `invalid_request` `ProviderError`s. In-stream errors surface as `error` parts carrying a `ProviderError`: Anthropic's `error` event (previously a plain `Error`), and the OpenAI `{ "error": … }` SSE payload and the Ollama `{ "error": "…" }` line, which previously failed with a `TypeError`. A connection reset mid-stream is a `network` error. Embeddings and model listing retry in the HTTP client (POST included for embeddings), honouring `Retry-After`; Anthropic's `listModels` now honours its `signal`. New exports: `ProviderError`, `isRetryableProviderError`, `toProviderError`, `providerErrorFromResponse`, `parseRetryAfter`, `mapStreamErrors`, `retryStreamChat`, `retryDelay`, `DEFAULT_RETRY_POLICY` and their types, and each provider's `errors` helpers. `Session` retries a chat request that fails with a retryable error before producing any output: 2 retries by default, with exponential backoff and full jitter, honouring `Retry-After`, capped at 30 seconds. `SessionParams.retry`, and `retry` on `chat()` and `streamChatTurn()` (`false` disables), set the policy; `onRetry` and the session's `provider-retry` event report each retry. Retries are recorded as `mokei.retry` events on the one inference span, and a final `ProviderError` sets `error.type` to its kind on the inference and agent spans. `AgentSession` takes a `retry` option and yields a `retry` event, so a rate limit or overload no longer ends a run. `traceStreamChat`'s `start` receives a `recordRetry` hook. The `mokei` chat shows retries and explains provider failures by kind.

### Patch Changes

- Updated dependencies:
  - @mokei/context-protocol@0.16.0
  - @mokei/model-provider@0.16.0

## 0.15.0

### Minor Changes

- Align telemetry with the OpenTelemetry GenAI and MCP semantic conventions: `chat`, `invoke_agent` and `execute_tool` spans, MCP and GenAI metrics, OTLP metrics export, `tracing.parentFrom`, opt-in content capture. Breaking: span names (`mcp.<method>` → `<method> [target]`, `flow.run` → `invoke_workflow {flowID}`, `decision.predict` → `predict {model}`) and attributes (`run.id` → `mokei.run.id`, `flow.id` → `mokei.flow.id`, `mcp.transport` → `network.transport`, `system_one.*` → `gen_ai.*` or `mokei.system_one.*`). Stored traces are not migrated.

### Patch Changes

- Updated dependencies:
  - @mokei/context-protocol@0.15.0
  - @mokei/model-provider@0.15.0
