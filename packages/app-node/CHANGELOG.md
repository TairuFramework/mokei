# @mokei/app-node

## 0.15.0

### Minor Changes

- Add durable flows. New packages: `@mokei/flow-host` (portable runtime with approval queue, input inbox, recovery), `@mokei/flow-host-node` (SQLite stores, retention), `@mokei/flow-client` (`FlowControl`, flow MCP server), `@mokei/app-node` (`mokei.json`, single `mokei.db`, telemetry), `@mokei/host-desktop` (native dialogs and notifications; `alerter` on macOS, `zenity` on Linux) and `@mokei/host-monitor` (browser run and inbox monitor). The daemon runs one flow service with live events and startup recovery. CLI gains `mokei daemon`, `flows`, `runs` and `inbox`. Unified traces cover flow runs, MCP requests and contexts, with persistence and monitor history.

  Breaking: `serveHostDaemon` takes a typed `EventEmitter<HostEvents>` from `@sozai/event`. `subscriptions` moves from `ServerParams` to `ServerConfig`.

- Align telemetry with the OpenTelemetry GenAI and MCP semantic conventions: `chat`, `invoke_agent` and `execute_tool` spans, MCP and GenAI metrics, OTLP metrics export, `tracing.parentFrom`, opt-in content capture. Breaking: span names (`mcp.<method>` → `<method> [target]`, `flow.run` → `invoke_workflow {flowID}`, `decision.predict` → `predict {model}`) and attributes (`run.id` → `mokei.run.id`, `flow.id` → `mokei.flow.id`, `mcp.transport` → `network.transport`, `system_one.*` → `gen_ai.*` or `mokei.system_one.*`). Stored traces are not migrated.

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.

### Patch Changes

- Updated dependencies:
  - @mokei/context-client@0.15.0
  - @mokei/host-protocol@0.15.0
