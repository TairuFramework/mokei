# @mokei/host-monitor

## 0.16.2

## 0.16.1

### Patch Changes

- Adopt upstream fixes: runtime schema validators come from `@sozai/schema`'s `createValidatorCache` (decision flow graphs now share a bounded cache by default), the monitor ends SSE sessions with the enkaku bridge's `dispose()` on daemon reconnect, `serveHTTP` reads the MCP handler with `HTTPServer.use`, and `MOKEI_VERSION` reports 0.16.0. Requires `@enkaku/*` 0.23.2 and `@sozai/http-server` 0.2.2.

## 0.16.0

### Minor Changes

- Move to enkaku 0.23, kokuin 0.7, `@teikyo/oauth` 0.3 and `@hozon/adapter` 0.3. A host must use the same lines. Kokuin 0.7 signing takes `identity.signToken({ payload })`.

### Patch Changes

- Updated dependencies:
  - @mokei/host-protocol@0.16.0

## 0.15.0

### Minor Changes

- Add durable flows. New packages: `@mokei/flow-host` (portable runtime with approval queue, input inbox, recovery), `@mokei/flow-host-node` (SQLite stores, retention), `@mokei/flow-client` (`FlowControl`, flow MCP server), `@mokei/app-node` (`mokei.json`, single `mokei.db`, telemetry), `@mokei/host-desktop` (native dialogs and notifications; `alerter` on macOS, `zenity` on Linux) and `@mokei/host-monitor` (browser run and inbox monitor). The daemon runs one flow service with live events and startup recovery. CLI gains `mokei daemon`, `flows`, `runs` and `inbox`. Unified traces cover flow runs, MCP requests and contexts, with persistence and monitor history.

  Breaking: `serveHostDaemon` takes a typed `EventEmitter<HostEvents>` from `@sozai/event`. `subscriptions` moves from `ServerParams` to `ServerConfig`.

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.

### Patch Changes

- Updated dependencies:
  - @mokei/host-protocol@0.15.0
