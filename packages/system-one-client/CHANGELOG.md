# @mokei/system-one-client

## 0.15.0

### Minor Changes

- Align telemetry with the OpenTelemetry GenAI and MCP semantic conventions: `chat`, `invoke_agent` and `execute_tool` spans, MCP and GenAI metrics, OTLP metrics export, `tracing.parentFrom`, opt-in content capture. Breaking: span names (`mcp.<method>` → `<method> [target]`, `flow.run` → `invoke_workflow {flowID}`, `decision.predict` → `predict {model}`) and attributes (`run.id` → `mokei.run.id`, `flow.id` → `mokei.flow.id`, `mcp.transport` → `network.transport`, `system_one.*` → `gen_ai.*` or `mokei.system_one.*`). Stored traces are not migrated.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.

- The System One MCP server exposes only `predict`; preset tools and `routerQuestions`, `guardQuestions`, `moderationQuestions`, `triageQuestions` are removed. `validateQuestions`, `validateState` and `validateResult` return Standard Schema results instead of throwing; `SystemOneClient.predict` still throws `SystemOneInputError` or `SystemOneResponseError`, and invalid backend answers now throw the latter. HTTP `400` maps to `SystemOneInputError`. Opt-in retries for transient failures. Renames: `SystemOneHTTPClientOptions` → `SystemOneHTTPClientParams`, `CreateSystemOneClientOptions` → `CreateSystemOneClientParams`; `SystemOneConnectionErrorOptions` and `SystemOneRetryableErrorOptions` removed in favour of `*Params`.

### Patch Changes

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.
