# @mokei/session-node

## 0.16.2

## 0.16.1

### Patch Changes

- Reconnect lost contexts. `reconnect: true | ReconnectOptions` on `addLocalContext`, `addHTTPContext`, `addDirectContext` and the session equivalents rebuilds a context after a transport loss, with backoff, a call gate (`ContextUnavailableError`, whose `cause` is the terminal `ReconnectExhaustedError` or `AuthRequiredError`), `context:reconnecting`, `context:reconnected`, `context:failed`, `context:removed` and `resource:subscription-lost` events, and restoration of resource subscriptions. Stdio contexts accept `respawn` to change spawn params per loss. `HTTPTransport` emits connection events and `dispose({ terminateSession })`, an interrupted task rejects with `TaskInterruptedError`, and the CLI chat shows reconnect notices. Reconnect is off by default; HTTP and direct contexts now emit `context:added`.

## 0.16.0

### Patch Changes

- Updated dependencies:
  - @mokei/context-protocol@0.16.0
  - @mokei/host@0.16.0
  - @mokei/host-node@0.16.0
  - @mokei/model-provider@0.16.0
  - @mokei/session@0.16.0

## 0.15.0

### Minor Changes

- Align telemetry with the OpenTelemetry GenAI and MCP semantic conventions: `chat`, `invoke_agent` and `execute_tool` spans, MCP and GenAI metrics, OTLP metrics export, `tracing.parentFrom`, opt-in content capture. Breaking: span names (`mcp.<method>` → `<method> [target]`, `flow.run` → `invoke_workflow {flowID}`, `decision.predict` → `predict {model}`) and attributes (`run.id` → `mokei.run.id`, `flow.id` → `mokei.flow.id`, `mcp.transport` → `network.transport`, `system_one.*` → `gen_ai.*` or `mokei.system_one.*`). Stored traces are not migrated.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.

- Breaking: stdio `Session.addContext` and the `NodeContextHost`-typed `contextHost` move to `NodeSession` in the new `@mokei/session-node`; `@mokei/session` is portable and React Native safe, and `AgentSession` accepts either. Elicitation works across both MCP revisions with host handlers, context opt-outs, streamed agent events (including `elicitation-complete`) and cancellation. `cancelToolCall(id?)` cancels one call, or all in-flight calls when omitted.

### Patch Changes

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.

- Updated dependencies:
  - @mokei/context-protocol@0.15.0
  - @mokei/host@0.15.0
  - @mokei/host-node@0.15.0
  - @mokei/model-provider@0.15.0
  - @mokei/session@0.15.0
