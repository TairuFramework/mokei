# @mokei/flow-host-node

Node-only SQLite storage, telemetry, configuration and retention for `@mokei/flow-host`.
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

The default database is `join(getDataDir('mokei'), 'mokei.db')`. An explicit `:memory:` path creates an in-memory database.
SQLite uses `journal_mode = WAL`, `busy_timeout = 5000` and `foreign_keys = ON`.
Opening a database with a newer schema version fails rather than changing it.
All three stores share the database. Their factories take the database positionally.

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
Unknown properties are rejected. Each supplied section must contain its required fields.
Omitted sections use defaults: empty siblings and flow directories, empty approval allowlist, no OTLP, `info` logs and 30-day retention.
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
  "retention": { "days": 30 }
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
A successful installation remains once-per-process, even after disposal. Restart the process to install telemetry again.
Host recreation can reuse the installed telemetry while its database remains open.

Local span capture is batched. Optional OTLP HTTP export runs alongside local capture.
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
