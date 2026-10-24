# @mokei/host-desktop

## 0.15.0

### Minor Changes

- Add durable flows. New packages: `@mokei/flow-host` (portable runtime with approval queue, input inbox, recovery), `@mokei/flow-host-node` (SQLite stores, retention), `@mokei/flow-client` (`FlowControl`, flow MCP server), `@mokei/app-node` (`mokei.json`, single `mokei.db`, telemetry), `@mokei/host-desktop` (native dialogs and notifications; `alerter` on macOS, `zenity` on Linux) and `@mokei/host-monitor` (browser run and inbox monitor). The daemon runs one flow service with live events and startup recovery. CLI gains `mokei daemon`, `flows`, `runs` and `inbox`. Unified traces cover flow runs, MCP requests and contexts, with persistence and monitor history.

  Breaking: `serveHostDaemon` takes a typed `EventEmitter<HostEvents>` from `@sozai/event`. `subscriptions` moves from `ServerParams` to `ServerConfig`.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.

### Patch Changes

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.

- Updated dependencies:
  - @mokei/context-client@0.15.0
  - @mokei/context-protocol@0.15.0
  - @mokei/host@0.15.0
