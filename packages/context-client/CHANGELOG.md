# @mokei/context-client

## 0.16.2

### Patch Changes

- Settle input-required flows when the client closes. Disposing the client (including `ContextHost.remove`) or losing its transport now aborts the signal passed to a waiting `elicit`, `createMessage` or `listRoots` handler and rejects the pending request with `TransportClosedError`, even if the handler ignores its signal.

## 0.16.1

### Patch Changes

- Reconnect lost contexts. `reconnect: true | ReconnectOptions` on `addLocalContext`, `addHTTPContext`, `addDirectContext` and the session equivalents rebuilds a context after a transport loss, with backoff, a call gate (`ContextUnavailableError`, whose `cause` is the terminal `ReconnectExhaustedError` or `AuthRequiredError`), `context:reconnecting`, `context:reconnected`, `context:failed`, `context:removed` and `resource:subscription-lost` events, and restoration of resource subscriptions. Stdio contexts accept `respawn` to change spawn params per loss. `HTTPTransport` emits connection events and `dispose({ terminateSession })`, an interrupted task rejects with `TaskInterruptedError`, and the CLI chat shows reconnect notices. Reconnect is off by default; HTTP and direct contexts now emit `context:added`.

- Route `2026-07-28` elicitations to a per-call handler (`callTool`, `getPrompt`, `readResource`, `waitForTask`; host `callTool`, `callNamespacedTool`, `getPrompt`).

- React Native support and safer HTTP auth: `HTTPTransport`, `addHTTPContext` and `createOAuthMiddleware` take a `@sozai/runtime` `runtime` for `fetch` and random values. An interactive OAuth sign-in no longer runs under the request timeout (new `authorizationTimeout`, default 10 minutes). Credentialed requests never follow redirects. The OAuth client flow runs on `@kokuin/oauth` 0.7.4. New `tracing.payloads: 'never'` keeps content and error message text out of telemetry, and the content-capture environment variable cannot override it.

## 0.16.0

### Minor Changes

- Move to enkaku 0.23, kokuin 0.7, `@teikyo/oauth` 0.3 and `@hozon/adapter` 0.3. A host must use the same lines. Kokuin 0.7 signing takes `identity.signToken({ payload })`.

### Patch Changes

- `MOKEI_VERSION` (exported from `@mokei/context-protocol` and `@mokei/context-server`) replaces stale hard-coded versions: the default MCP `clientInfo`, the decision-flow, fetch, sqlite and system-one `serverInfo`, and the `mokei` tracer and meter scopes now report the package version.

- Updated dependencies:
  - @mokei/context-protocol@0.16.0
  - @mokei/context-rpc@0.16.0
  - @mokei/logger@0.16.0

## 0.15.0

### Minor Changes

- Add JSON-authored, resumable System One decision flows (`@mokei/decision-flow`, `@mokei/decision-flow-server`) as MCP task-backed tools: static checking, retries, tracing, input elicitation, recovery, per-run approval grants, and flow references with `list_flows` and an input `decline` edge. `check_flow` reports `tool_invalid_schema` for uncompilable tool schemas. Breaking: `checkFlow` and `createDecisionFlowServer` return promises, `checkFlow` requires a `registry`, `flowPlan` takes a `lookup` argument.

- Add durable flows. New packages: `@mokei/flow-host` (portable runtime with approval queue, input inbox, recovery), `@mokei/flow-host-node` (SQLite stores, retention), `@mokei/flow-client` (`FlowControl`, flow MCP server), `@mokei/app-node` (`mokei.json`, single `mokei.db`, telemetry), `@mokei/host-desktop` (native dialogs and notifications; `alerter` on macOS, `zenity` on Linux) and `@mokei/host-monitor` (browser run and inbox monitor). The daemon runs one flow service with live events and startup recovery. CLI gains `mokei daemon`, `flows`, `runs` and `inbox`. Unified traces cover flow runs, MCP requests and contexts, with persistence and monitor history.

  Breaking: `serveHostDaemon` takes a typed `EventEmitter<HostEvents>` from `@sozai/event`. `subscriptions` moves from `ServerParams` to `ServerConfig`.

- Add the MCP Tasks extension for 2026-07-28: durable server tasks, task input and cancellation, authorised subscriptions, automatic client waiting, HTTP routing. Task input history persists in `TaskRecord.inputs`; withdrawn requests reject with `InputRequestWithdrawnError` and identical `requestInput` replays settle outcomes. `TaskManager.update` rejects non-outstanding keys with -32602. Add MRTR (SEP-2322) fixes: typed `allowInputRequired`, empty `inputRequests` rejected, exported `defaultMintRequestState`.

- Align telemetry with the OpenTelemetry GenAI and MCP semantic conventions: `chat`, `invoke_agent` and `execute_tool` spans, MCP and GenAI metrics, OTLP metrics export, `tracing.parentFrom`, opt-in content capture. Breaking: span names (`mcp.<method>` → `<method> [target]`, `flow.run` → `invoke_workflow {flowID}`, `decision.predict` → `predict {model}`) and attributes (`run.id` → `mokei.run.id`, `flow.id` → `mokei.flow.id`, `mcp.transport` → `network.transport`, `system_one.*` → `gen_ai.*` or `mokei.system_one.*`). Stored traces are not migrated.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.

- Breaking: stdio `Session.addContext` and the `NodeContextHost`-typed `contextHost` move to `NodeSession` in the new `@mokei/session-node`; `@mokei/session` is portable and React Native safe, and `AgentSession` accepts either. Elicitation works across both MCP revisions with host handlers, context opt-outs, streamed agent events (including `elicitation-complete`) and cancellation. `cancelToolCall(id?)` cancels one call, or all in-flight calls when omitted.

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.

### Patch Changes

- Updated dependencies:
  - @mokei/context-protocol@0.15.0
  - @mokei/context-rpc@0.15.0
  - @mokei/logger@0.15.0
