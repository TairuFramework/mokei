# @mokei/flow-host-node

Node-only durable flow service, SQLite storage, telemetry, configuration and retention for `@mokei/flow-host`.
The portable runtime remains Node-free. See the [architecture](../../docs/agents/architecture.md#flow-runtime).

## Installation

```sh
pnpm add @mokei/flow-host-node @mokei/flow-host @mokei/session-node
```

The package requires Node.js with `node:sqlite` support. One process owns the database and telemetry installation.

## Public entry points

| Entry point | Behaviour |
|-------------|-----------|
| `openFlowDatabase({ path? })` | Creates parent directories, opens SQLite, migrates the schema and returns `{ db, close }`. |
| `createSQLiteRunStore(db)` | Creates a portable `RunStore` with revision-based compare-and-swap updates. |
| `createSQLiteTaskStore(db)` | Creates a persistent MCP `TaskStore` with revision-based compare-and-swap updates. |
| `createSQLiteTraceStore(db)` | Creates a portable `TraceStore` for span and log capture, lookup and deletion. |
| `setupFlowTelemetry({ traceStore, otlp?, logs? })` | Installs tracing and logging once per process and returns asynchronous `dispose`. |
| `loadFlowConfig(path?)` | Reads and validates configuration, applies defaults and resolves configured paths. |
| `loadFlowDirs(dirs)` | Returns `{ files, flows }` from JSON files in the supplied directories. |
| `startRetention({ runStore, taskStore, traceStore, days, intervalMs? })` | Starts immediate and periodic pruning and returns asynchronous `stop`. |
| `createFlowService({ configPath?, databasePath?, desktop?, onEvent })` | Owns shared initialization, recovery, desktop policy and cleanup. |
| `createFlowHandlers(service)` | Binds the 13 flow, run and inbox host-protocol procedures to that service. |

The default database is `join(getDataDir('mokei'), 'mokei.db')`. An explicit `:memory:` path creates an in-memory database.
SQLite uses `journal_mode = WAL`, `busy_timeout = 5000` and `foreign_keys = ON`.
Opening a database with a newer schema version fails rather than changing it.
All three stores share the database. Their factories take the database positionally.

## Composed daemon

The `mokei` CLI owns the executable `mokei/lib/daemon-entry.js`. Its proxy and monitor commands
select that entry when starting the per-user daemon. It creates one flow service for every
connection to share and injects native desktop operations from `@mokei/host-desktop`.
`@mokei/host-node` supplies generic serving and handler composition without importing flow or
desktop implementations. Custom applications can compose the same service through
[`serveHostDaemon`](../host-node/README.md#daemon-composition).

Configuration comes from `getDataDir('mokei')/flows.json`.
The service's `start()` is idempotent. Generic proxy and monitor status inspection are available
while flows initialize, and stay available if flow startup fails.

`info.flowService` reports `{ state: 'starting' }`, `{ state: 'ready' }`, or
`{ state: 'failed', error: { type, message, path?, issues? } }`. Configuration errors identify
the configuration path and sanitized validation issues; messages exclude credentials and
configured environment values. Other fatal startup errors identify the failing initialization
stage. Flow procedures reject while starting, failed or shutting down. Correct the cause and
restart the daemon: there is no automatic startup retry or hot reload.

Ready status follows configuration and flow loading, SQLite and telemetry setup, sibling
connections, flow registration and recovery, initial task/inbox reconciliation, and retention
startup. The reconciliation barrier waits for recovered tasks' first snapshots so pending
inputs are queryable when ready; it does not wait for flows to finish or for user answers.
Individual recovery failures become failed runs without disabling the service.
The session enables task input elicitation. Direct sibling elicitation outside the task inbox
uses the existing decline fallback.

Shutdown closes flow admission, aborts desktop operations and awaits admitted calls. It then
stops retention, suspends stored runs, disconnects siblings, drains telemetry and closes SQLite.
Shutdown is idempotent, attempts every cleanup even after an earlier failure, and also cleans
up resources acquired during an initialization race. Stored runs remain recoverable after
graceful shutdown. An abrupt process exit can lose unflushed telemetry.

## Procedures and live events

| Procedures | Purpose |
|------------|---------|
| `flows.list`, `flows.check` | List registered flows or validate an inline definition. Validation results contain public data, never internal functions. |
| `runs.start`, `runs.get`, `runs.list`, `runs.cancel` | Start registered or inline flows and inspect or cancel runs. Approval policy applies to both start forms. |
| `runs.trace` | Read only the selected run's captured `{ spans, logs }`; a known run without a trace returns empty arrays. |
| `inbox.list`, `inbox.get` | Inspect currently pending approval or input items. |
| `inbox.answer`, `inbox.decline`, `inbox.cancel` | Settle through runtime validation and single-use approval authorization; return `{ settled: true }`. |
| `inbox.prompt` | Route a pending item to the monitor or native dialog and return `{ action: 'accept' \| 'decline' \| 'cancel' }` after validated settlement. |

Trace capture is batched: reads can lag active work and do not force a flush.
The shared `events` stream includes `service:status`, `run:state`, `inbox:added` and
`inbox:settled` alongside existing context events, each with an event ID and timestamp.
Events are live changes with no durable replay. Subscribe before querying `info`, `runs.list`
and `inbox.list`; buffer events during the reads, then re-read affected run and item IDs.
A settled item is absent from the pending inbox. Reconcile by reading current state rather
than applying an older buffered snapshot over a newer query result. Repeat this sequence
after reconnecting; event IDs do not provide a replay cursor.

| Public error code | Meaning |
|-------------------|---------|
| `FLOW_UNAVAILABLE` | Service is starting, failed or shutting down; composed handlers include safe status in error data. |
| `FLOW_NOT_FOUND`, `RUN_NOT_FOUND`, `INBOX_ITEM_NOT_FOUND` | Requested registered flow, run or pending inbox item is missing. |
| `FLOW_INVALID`, `INBOX_ANSWER_INVALID` | Definition or answer validation failed; error data contains `issues`. |
| `PROMPT_UNSUPPORTED` | No desktop adapter or supported dialog is available for the item. |
| `PROMPT_IN_PROGRESS` | Another prompt operation owns the same item. |
| `INTERNAL_ERROR` | Unexpected failure; public message is `Flow request failed`, with details logged locally. |

## Monitor surface

The daemon routes inbox notifications and prompts through the monitor surface before the native
desktop surface. Each open monitor tab reports Page Visibility API state and browser notification
permission. The daemon verifies claimed visibility with a fresh ping before suppressing a
notification or routing a prompt.

An attended tab suppresses desktop notifications for new items. If no attended tab answers,
the daemon tries a reachable monitor tab with browser notification permission, then the native
surface. Notifications suppressed while the monitor is attended are not delivered later.
Recovery summaries remain native-only; the monitor reads pending items when it connects.

Prompts go to an attended monitor tab first. A hidden tab can receive a browser notification
that opens the item form. If no monitor tab can show the prompt, the native dialog is tried.
The flow host remains the only component that settles inbox items. The monitor uses
`inbox.answer`, `inbox.decline` or `inbox.cancel`; a tab that disconnects before settlement
allows the prompt to fall back to the native surface.

Monitor presence and delivery replies have five-second ping and acknowledgement timeouts. Stale
replies are ignored, and withdrawals close a notification or prompt that is no longer wanted.
Disabling `desktop.notifications` disables only native notifications. The monitor still handles
notifications when its browser permission allows them.

## Desktop policy

`desktop.notifications` defaults to `false`. Set it to `true` in configuration and restart to
enable notifications. Recovery gathers the startup population before notification delivery:
zero pending items send nothing; one sends `Flow needs your approval` or `Flow needs your input`;
multiple send one count message such as `3 pending prompts`. New items notify individually.
Messages contain no input content previews. Polling, subscriptions and reconnects do not notify.
An item represented at startup is not notified again during that daemon lifetime, even if it
settles while delivery is pending. Restart intentionally announces the current population again.
Notification failures are logged without retrying or changing inbox items.

On macOS with `alerter`, clicking a single-item notification opens that item's dialog through
the same path as `inbox.prompt`; a click while that item's dialog is open, or on an item whose
form cannot be shown, does nothing. Each item notification has its own group, so new items do
not replace earlier ones, and settling an item removes its notification. Clicking the count
message only dismisses it. When a monitor is attached, the click opens the item's monitor inbox
page instead. `osascript` notifications open no dialog.

Otherwise dialogs open only through `inbox.prompt`, including when notifications are disabled. Approval
dialogs show the flow label and planned tools and require explicit approval. Input dialogs use
the requested schema; the runtime validates answers before settlement. Native dialogs serialize
across items. Settlement elsewhere aborts an active dialog and rejects its late answer.
Caller cancellation, disconnect or shutdown releases prompt ownership and aborts the dialog
while leaving its item pending; a user-selected cancel follows runtime inbox cancellation.
Unsupported dialogs leave the item available for another answer surface.

## Setup and shutdown

This example loads configuration and flows, connects configured sibling MCP servers and recovers stored work.
The default predictor uses the session's System One MCP tool when a flow contains decision nodes.
Configured sibling commands and flow definitions must be available before startup.

```typescript
import { createFlowHost } from '@mokei/flow-host'
import {
  createSQLiteRunStore,
  createSQLiteTaskStore,
  createSQLiteTraceStore,
  loadFlowConfig,
  loadFlowDirs,
  openFlowDatabase,
  setupFlowTelemetry,
  startRetention,
} from '@mokei/flow-host-node'
import { NodeSession } from '@mokei/session-node'

const config = await loadFlowConfig()
const { flows } = await loadFlowDirs(config.flowDirs)
const database = openFlowDatabase({})
const runStore = createSQLiteRunStore(database.db)
const taskStore = createSQLiteTaskStore(database.db)
const traceStore = createSQLiteTraceStore(database.db)
const telemetry = setupFlowTelemetry({
  traceStore,
  otlp: config.tracing.otlp,
  logs: config.logs,
})
const session = new NodeSession({ elicit: true })
for (const [key, sibling] of Object.entries(config.siblings)) {
  await session.addContext({ key, ...sibling })
}
const host = await createFlowHost({
  session,
  flows,
  approval: config.approval,
  runStore,
  taskStore,
})
const retention = startRetention({
  runStore,
  taskStore,
  traceStore,
  days: config.retention.days,
})

async function shutdown(): Promise<void> {
  await retention.stop()
  try {
    await host.dispose()
  } finally {
    try {
      await session.dispose()
    } finally {
      try {
        await telemetry.dispose()
      } finally {
        database.close()
      }
    }
  }
}

process.once('SIGINT', () => {
  void shutdown().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
})
```

Shutdown order is retention, host and session, telemetry, then database.
`stop()` prevents new retention passes and awaits an existing pass.
Host disposal suspends work for recovery. It does not cancel stored runs.
Task TTL defaults to `null`, including tasks waiting for input.
Explicit cancellation before disposal ends runs instead of suspending them.

Before shutdown, stop accepting requests and await application-owned pending calls.
Await every disposal promise before closing SQLite. Telemetry disposal drains batched spans and queued logs.
Startup failures also require cleanup of resources already created, in the same order.
Recovery requires the same flow definitions and sibling tools on restart.
Recovery events can fire during `createFlowHost`. Its `listeners` option receives those events during construction.

## Configuration

`loadFlowConfig()` defaults to `join(getDataDir('mokei'), 'flows.json')`.
A missing file returns defaults. Invalid JSON or schema violations throw `FlowConfigError`, with `path`, `issues` and a message.
Unknown properties are rejected. Supplied sections must satisfy their schema's required fields;
an empty `desktop: {}` section is allowed and keeps notifications disabled.
Omitted sections use defaults: empty siblings and flow directories, empty approval allowlist, no OTLP, `info` logs, 30-day retention and `desktop.notifications: false`.
The loader runs at startup. Configuration changes take effect on restart, without a file watcher.

A complete configuration example:

```json
{
  "siblings": {
    "system-one": {
      "command": "node",
      "args": ["./servers/system-one.mjs"],
      "env": { "SYSTEM_ONE_URL": "http://127.0.0.1:8080" }
    }
  },
  "flowDirs": ["./flows", "~/shared-flows"],
  "approval": { "allow": ["system-one:predict"] },
  "tracing": {
    "otlp": {
      "endpoint": "http://127.0.0.1:4318/v1/traces",
      "headers": { "x-service": "mokei" }
    }
  },
  "logs": { "level": "info" },
  "retention": { "days": 30 },
  "desktop": { "notifications": false }
}
```

Relative flow directories resolve against the configuration file's directory.
Sibling arguments ending in `.js`, `.mjs` or `.cjs` also resolve there, unless they are flags or URLs.
`~` and `~/` expand to the home directory. Absolute paths, URLs and other tilde forms remain unchanged.
Commands, environment values and other arguments remain unchanged.
Retention days must be an integer of at least one.
Log levels are `trace`, `debug`, `info`, `warning`, `error` and `fatal`.

`loadFlowDirs` reads only top-level `.json` files, in sorted filename order within each directory.
Directory order follows the supplied array. It parses JSON without validating flow definitions.
`createFlowHost` validates definitions during registration. Directory and read errors propagate, and malformed JSON errors identify the file.

## Storage contracts

Records and trace payloads must be JSON values: null, booleans, finite numbers, strings, arrays and string-keyed objects.
Functions, `undefined`, symbols, bigint and cycles cannot survive JSON persistence.
Stores round-trip through JSON and return detached records. Mutating a returned record does not update storage.
Run and task writes require the expected revision and increment it after a successful update.
The runtime treats `denied`, `completed`, `failed` and `cancelled` run records as immutable terminal records.

Trace spans use `(traceID, spanID)` identity and replace earlier values on repeated writes.
Logs append, including identical records. `getTrace(traceID)` returns `{ spans, logs }`.
Spans sort by start time and logs by timestamp, with insertion order breaking ties.
`deleteTraces(traceIDs)` deletes complete traces. `deleteBefore(time, keepTraceIDs)` preserves every listed trace.
The latter deletes older span end times and log timestamps, using a strict cutoff.
Both deletion methods return `{ spans, logs }` counts. Times use epoch milliseconds.

## Telemetry lifetime and capture

`setupFlowTelemetry` installs an asynchronous context manager and a global OpenTelemetry tracer provider.
Existing logging configuration, a global tracer provider or a global context manager prevents installation.
Successful global tracer-provider registration consumes the process lifetime, even if later file-sink or logging setup fails. Owned resources are cleaned up, but cached tracers retain the original provider. Restart the process after such a failure or after disposal to install telemetry again. Failures before provider registration can be retried after their cause is corrected.
Host recreation can reuse the installed telemetry while its database remains open.

Local span capture is batched. Optional OTLP HTTP export runs alongside local capture.
Export requests, span batches and provider flushes each have a fixed 10-second timeout, overriding corresponding OpenTelemetry environment defaults.
Telemetry disposal also bounds provider shutdown to 10 seconds, then attempts log drainage and registration cleanup even after export failures.
The shutdown timeout stops waiting for remote completion. It does not cancel an outstanding HTTP request.
Owned local span writes are drained separately before disposal returns, including when the provider times out.
The composed daemon allows 60 seconds for its entire shutdown hook, including initialization and admitted calls before telemetry and SQLite disposal.
This limit reserves time for ordinary cleanup. An acquisition or admitted call that never settles can exhaust it and cause a failure exit.
The service does not close SQLite underneath active calls. Remote export failures remain aggregated disposal errors after later cleanup attempts.
The standalone generic host retains its default shutdown timeout.
Each new run has its own trace. Recovered runs retain their stored trace context.
Log capture includes records with a valid active span context and records their trace and span IDs.
Logs without that context are not stored in the trace store.
Capture errors use `['mokei', 'flow-host', 'capture']` and bypass capture to prevent recursion.
File logging defaults to daily rotation. `logs: { file: false }` disables the file sink.
The default minimum log level is `info`.

Capture covers this process only. Spans and logs emitted inside sibling processes are not ingested locally.
Remote processes need their own telemetry setup for remote export.

## Retention

`startRetention` calls portable `pruneRuns` immediately, then every `86400000` milliseconds by default.
Pass `intervalMs` to change the interval. The timer does not keep the process alive, and passes never overlap.
The cutoff is the current time minus `days` days. Pass `config.retention.days` to use its 30-day default.

Only terminal runs last updated strictly before the cutoff qualify.
Pruning rechecks each run and its task before deletion.
A non-terminal task protects its run from pruning, even when that run appears terminal.
Eligible runs lose their trace, task and run record in that order.
Failures leave the run available for another pass and produce capture diagnostics.

The final sweep preserves traces referenced by every remaining run, including live runs and skipped candidates.
It deletes older orphan spans and logs. Long-running or input-waiting runs therefore retain their referenced traces.
