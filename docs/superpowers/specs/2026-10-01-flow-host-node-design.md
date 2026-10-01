# Flow host Node storage and observability -- design

**Milestone:** flow daemon, sub-project 2
**Branch:** `feat/flow-host-node`
**Builds on:** `@mokei/flow-host` (sub-project 1)

## Goal

Give the daemon (sub-project 3) everything Node-specific it needs to host flow-host durably: persistent stores,
span and log capture per run, an optional OTLP export, the `flows.json` config and retention. Consumers depend on
portable interfaces. The sqlite implementations and the Node process setup live in a new package,
`@mokei/flow-host-node`.

Exit criteria: store, capture, config and retention tests green, plus a restart smoke test over a sqlite file.

Out of scope: daemon handlers and `host-protocol` procedures (sub-project 3), CLI commands and the MCP facade
(sub-project 4), monitor pages (sub-project 5), desktop input and confirm modes (sub-project 3 surface wiring).

## Split

| Piece | Package | Why |
|-------|---------|-----|
| `TraceStore` interface, memory implementation | `@mokei/flow-host` | Portable. The daemon handlers and the monitor depend only on it. |
| `RunStore.list` `updatedBefore` filter | `@mokei/flow-host` | Retention needs it. Memory store updated too. |
| `createTraceStoreSpanExporter`, `createTraceStoreLogSink` | `@mokei/flow-host` | Use only `@opentelemetry/api`, `@opentelemetry/sdk-trace-base` and logtape types. |
| `pruneRuns` | `@mokei/flow-host` | Generic retention over the three store interfaces. |
| `openFlowDatabase`, sqlite `RunStore`, `TaskStore`, `TraceStore` | `@mokei/flow-host-node` | `node:sqlite`. |
| `setupFlowTelemetry` | `@mokei/flow-host-node` | Async-hooks context manager, process-global provider, file sink. |
| `loadFlowConfig`, `loadFlowDirs` | `@mokei/flow-host-node` | File system access. |
| `startRetention` | `@mokei/flow-host-node` | Timer around `pruneRuns`. |

## Portable additions to `@mokei/flow-host`

### `TraceStore`

```ts
type StoredSpan = {
  traceID: string
  spanID: string
  parentSpanID?: string
  name: string
  kind: number
  startTime: number // epoch milliseconds, fractional
  endTime: number
  status: { code: number; message?: string }
  attributes: Record<string, unknown>
  events: Array<{ name: string; time: number; attributes: Record<string, unknown> }>
}

type StoredLog = {
  traceID: string
  spanID: string
  timestamp: number // epoch milliseconds
  level: LogLevel
  category: Array<string>
  message: string
  properties: Record<string, unknown>
}

type TraceStore = {
  addSpans(spans: Array<StoredSpan>): Promise<void>
  addLogs(logs: Array<StoredLog>): Promise<void>
  getTrace(traceID: string): Promise<{ spans: Array<StoredSpan>; logs: Array<StoredLog> }>
  deleteTraces(traceIDs: Array<string>): Promise<void>
  deleteBefore(time: number, keepTraceIDs: Array<string>): Promise<{ spans: number; logs: number }>
}
```

- `getTrace` returns spans ordered by `startTime` and logs by `timestamp`.
- `addSpans` is idempotent on `(traceID, spanID)`: a re-export overwrites.
- `deleteBefore` removes spans that ended and logs written before `time`, except those in `keepTraceIDs`. It
  catches spans and logs whose run was already pruned or never existed.
- Attribute and property values are stored as JSON. A value JSON cannot hold (a BigInt, a cycle) is replaced by its
  `String()` form, never dropped with its record.

`createMemoryTraceStore()` implements it for tests and in-process hosts.

### Span exporter and log sink

- `createTraceStoreSpanExporter(store)` is an OTel `SpanExporter`. `export()` maps `ReadableSpan` to `StoredSpan`
  and calls `addSpans` once per batch. A store failure resolves the export callback with `ExportResultCode.FAILED`
  and reports through `getReporter`. It never throws into the caller.
- `createTraceStoreLogSink(store)` is a logtape `Sink`. At emit time it reads the active span from
  `@opentelemetry/api`. A record with no active valid span is skipped. Records are buffered and written with
  `addLogs` on a microtask, so the sync sink never awaits. Failures report through `getReporter`.
- The sink exposes `flush(): Promise<void>` for shutdown and tests.
- The message is rendered the same way as `@sozai/otel`'s `createOTelLogSink`: `rawMessage` when it is a string,
  otherwise the joined parts.

Run correlation needs no run tag on logs. A run already stores its `traceID`, and every flow-graph, decide and MCP
span runs under the `flow.run` span, so its logs carry that trace. `flow.run.resume` keeps the trace through its
`traceparent` parent.

### `RunStore.list` filter

`list(filter: { states?; limit?; updatedBefore?: number })`. `updatedBefore` keeps records whose `updatedAt` is
strictly earlier.

### `pruneRuns`

```ts
pruneRuns(params: {
  runStore: RunStore
  taskStore: TaskStore
  traceStore: TraceStore
  before: number
}): Promise<{ runs: number; spans: number; logs: number }>
```

1. List terminal runs with `updatedBefore: before`.
2. Per run, delete its trace (when it has a `traceID`), then its task (when it has a `taskID`), then the run.
3. Call `traceStore.deleteBefore(before, keepTraceIDs)`, where `keepTraceIDs` are the trace IDs of every remaining
   run. A long-lived non-terminal run therefore keeps its old spans.

The order means a crash mid-prune leaves the run record in place, so the next pass finishes the job. A missing task
or trace is not an error. A failure on one run is reported and the pass moves on to the next run.

Terminal states are `denied`, `completed`, `failed` and `cancelled`.

## `@mokei/flow-host-node`

### Database

`openFlowDatabase({ path? }): { db: DatabaseSync; close(): void }`

- Default path: `join(getDataDir('mokei'), 'mokei.db')`. The parent directory is created.
- Pragmas: `journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`.
- Migrations are an ordered array of SQL steps keyed by `PRAGMA user_version`, applied in one transaction at open.
  A database with a `user_version` newer than the code knows fails to open with a clear error.

Schema v1:

```sql
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  trace_id TEXT,
  task_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX runs_state ON runs (state, updated_at);
CREATE INDEX runs_created ON runs (created_at);

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX tasks_status ON tasks (status);

CREATE TABLE spans (
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (trace_id, span_id)
);
CREATE INDEX spans_end ON spans (end_time);

CREATE TABLE logs (
  id INTEGER PRIMARY KEY,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  timestamp REAL NOT NULL,
  level TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX logs_trace ON logs (trace_id, timestamp);
CREATE INDEX logs_time ON logs (timestamp);
```

`data` holds the whole record as JSON. The indexed columns duplicate the fields the stores query on, so a
`RunRecord` or `TaskRecord` that grows needs no migration.

### Stores

- `createSQLiteRunStore(db): RunStore`
- `createSQLiteTaskStore(db): TaskStore`
- `createSQLiteTraceStore(db): TraceStore`

Semantics match the memory stores exactly:

- `create` on an existing ID throws (`RunStoreConflictError` for runs, `Error` for tasks, as the memory stores do).
- `update` is a compare-and-set: `UPDATE ... WHERE id = ? AND revision = ?`. Zero changes on an existing row throw
  the conflict error. A missing row throws `Error` with the same message as the memory store. The update sets
  `revision + 1` and returns the stored record.
- `list` for runs orders by `created_at` descending. Task `list` filters by status.
- Every returned record is a fresh object.
- `deleteTraces` and `deleteBefore` each run in one transaction.

### Telemetry setup

```ts
setupFlowTelemetry(params: {
  traceStore: TraceStore
  otlp?: { endpoint: string; headers?: Record<string, string> }
  logs?: { level?: LogLevel; file?: boolean }
}): { dispose(): Promise<void> }
```

1. Register `AsyncLocalStorageContextManager` as the global context manager.
2. Register a `BasicTracerProvider` with a `BatchSpanProcessor` over `createTraceStoreSpanExporter`, plus a
   `BatchSpanProcessor` over an OTLP HTTP exporter when `otlp` is set.
3. Configure logging through `@sozai/log` `setup()`: the trace store sink for all categories at `logs.level`
   (default `info`), and a `@tejika/log` daily-rotating file sink for app `mokei` unless `logs.file` is `false`.
4. `dispose()` flushes the log sink, force-flushes and shuts down the provider, and resets logging and the global
   OTel registrations.

Calling it twice without `dispose` throws. That is a programming error in the host, and silent double registration
would split spans across providers.

### Config

`loadFlowConfig(path?): Promise<FlowConfig>`, default path `join(getDataDir('mokei'), 'flows.json')`.

```json
{
  "siblings": {
    "system-one": { "command": "node", "args": ["..."], "env": {} }
  },
  "flowDirs": ["~/flows"],
  "approval": { "allow": ["system-one:predict"] },
  "tracing": { "otlp": { "endpoint": "http://localhost:4318/v1/traces", "headers": {} } },
  "logs": { "level": "info" },
  "retention": { "days": 30 }
}
```

- A missing file returns the defaults: no siblings, no flow directories, empty allow list, no OTLP, `logs.level`
  `info`, `retention.days` 30.
- Validation uses `@sozai/schema`. Unknown top-level fields are rejected. An invalid file throws `FlowConfigError`
  naming the file and each failing field path.
- `flowDirs` entries and sibling `args` that are relative paths ending in `.js`, `.mjs` or `.cjs` resolve against
  the config file's directory. A leading `~` expands to the home directory.
- `retention.days` must be a positive integer.
- There is no predictor field. The default predictor is the MCP `system-one:predict` sibling. A fake predictor is a
  test concern.
- Changes apply on daemon restart.

`loadFlowDirs(dirs): Promise<{ files: Array<string>; flows: Array<FlowDefinition> }>` reads every `*.json` file in
each directory, sorted by name, and parses it. A parse error names the file. A missing directory is an error. Flow
validation stays with flow-host registration.

### Retention

`startRetention({ runStore, taskStore, traceStore, days, intervalMs? }): { stop(): Promise<void> }` runs `pruneRuns` once at
start and then every `intervalMs` (default 24 hours) on an unref'd timer. `before` is `Date.now() - days * 86400000`.
A failed pass is reported and the next pass still runs. `stop()` clears the timer and resolves once any running pass ends.

## Dependencies

- `@mokei/flow-host`: `@opentelemetry/api`, `@opentelemetry/sdk-trace-base` and `@sozai/log` become runtime
  dependencies.
- `@mokei/flow-host-node` (new): `@mokei/flow-host`, `@mokei/context-server`, `@sozai/log`, `@sozai/schema`,
  `@tejika/env`, `@tejika/log`, `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`,
  `@opentelemetry/context-async-hooks`, `@opentelemetry/exporter-trace-otlp-http`.
- New catalog entries: `@tejika/log`, `@opentelemetry/context-async-hooks`,
  `@opentelemetry/exporter-trace-otlp-http`.

## Testing

- **Store contract suites** live in `@mokei/flow-host-node` tests: one each for `RunStore`, `TaskStore` and
  `TraceStore`, run against the memory store and the sqlite store. The memory stores come from `@mokei/flow-host`
  and `@mokei/context-server`.
- **Persistence:** records written, database closed and reopened, records read back. A future `user_version` fails
  to open.
- **Capture:** under `setupFlowTelemetry` with a temp database, a span tree with a log emitted inside a child span
  lands in the trace store, and `getTrace` returns both in order. A log outside any span is not stored. A failing
  store is reported, not thrown.
- **OTLP:** spans reach a local HTTP receiver stub when `otlp` is set.
- **Config:** valid file, missing file defaults, unknown field, invalid field paths, path resolution, `~` expansion.
- **Retention:** cutoff boundary, non-terminal runs kept, task and trace cascade, orphan spans removed, kept traces
  of live runs untouched, a failure on one run does not stop the pass.
- **Restart smoke test:** a flow-host on sqlite stores waits for input, is disposed, and a fresh host over the same
  file recovers the run and completes it after the answer.
