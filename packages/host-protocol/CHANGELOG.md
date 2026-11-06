# @mokei/host-protocol

## 0.16.0

### Minor Changes

- Unified traces follow-ons. Context traces are named by their server: the recorder reads open spans live, so `mokei.server.name` (now also set by the daemon proxy from `initialize` or `server/discover`) reaches trace summaries and open-span snapshots. It is a summary attribute and part of the search text. A new `trace_calls` index records spans that call into another trace (`mokei.context.trace_id`). `traces.get` returns them as `calls` with `callsTruncated`, and the monitor lists them under "Called from". A new `traces.logs` procedure pages a trace's logs newest first, by span, before a time or with a cursor, and the monitor uses it for "Load older logs". A child-only summary delta dropped at the hydration limit is now looked up and counted as lost when its trace is indexed, and one left after hydration fails for good is counted too. **Breaking:** `events` takes a `{ types? }` param, and the daemon subscribes only to those types (`flow-client` asks for its three flow events). Every caller must now send `param` (`{}` for all events), so restart the daemon after upgrading. **Breaking:** `context:message` is removed from the `events` stream and from `@mokei/host-protocol`; MCP traffic is carried by trace spans.

- Move to enkaku 0.23, kokuin 0.7, `@teikyo/oauth` 0.3 and `@hozon/adapter` 0.3. A host must use the same lines. Kokuin 0.7 signing takes `identity.signToken({ payload })`.

## 0.15.0

### Minor Changes

- Add durable flows. New packages: `@mokei/flow-host` (portable runtime with approval queue, input inbox, recovery), `@mokei/flow-host-node` (SQLite stores, retention), `@mokei/flow-client` (`FlowControl`, flow MCP server), `@mokei/app-node` (`mokei.json`, single `mokei.db`, telemetry), `@mokei/host-desktop` (native dialogs and notifications; `alerter` on macOS, `zenity` on Linux) and `@mokei/host-monitor` (browser run and inbox monitor). The daemon runs one flow service with live events and startup recovery. CLI gains `mokei daemon`, `flows`, `runs` and `inbox`. Unified traces cover flow runs, MCP requests and contexts, with persistence and monitor history.

  Breaking: `serveHostDaemon` takes a typed `EventEmitter<HostEvents>` from `@sozai/event`. `subscriptions` moves from `ServerParams` to `ServerConfig`.

- Align telemetry with the OpenTelemetry GenAI and MCP semantic conventions: `chat`, `invoke_agent` and `execute_tool` spans, MCP and GenAI metrics, OTLP metrics export, `tracing.parentFrom`, opt-in content capture. Breaking: span names (`mcp.<method>` → `<method> [target]`, `flow.run` → `invoke_workflow {flowID}`, `decision.predict` → `predict {model}`) and attributes (`run.id` → `mokei.run.id`, `flow.id` → `mokei.flow.id`, `mcp.transport` → `network.transport`, `system_one.*` → `gen_ai.*` or `mokei.system_one.*`). Stored traces are not migrated.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.
