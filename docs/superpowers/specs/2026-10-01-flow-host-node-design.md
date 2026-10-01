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
(sub-project 4), monitor pages (sub-project 5), desktop input and confirm modes (sub-project 3 surface wiring),
ingestion of telemetry emitted inside sibling server processes.

## Split

| Piece | Package | Why |
|-------|---------|-----|
| `TraceStore` interface, memory implementation | `@mokei/flow-host` | Portable. The daemon handlers and the monitor depend only on it. |
| Store contract changes (JSON values, key handling, `updatedBefore`) | `@mokei/flow-host` | Parity between memory and sqlite stores. |
| One root trace per run, run context around all run work | `@mokei/flow-host` | Correct correlation and safe trace deletion. |
| `createTraceStoreSpanExporter`, `createTraceStoreLogSink` | `@mokei/flow-host` | Use only `@opentelemetry/api`, `@opentelemetry/core`, `@opentelemetry/sdk-trace-base` and logtape types. |
| `pruneRuns` | `@mokei/flow-host` | Generic retention over the three store interfaces. |
| `openFlowDatabase`, sqlite `RunStore`, `TaskStore`, `TraceStore` | `@mokei/flow-host-node` | `node:sqlite`. |
| `setupFlowTelemetry` | `@mokei/flow-host-node` | Async-hooks context manager, process-global provider, file sink. |
| `loadFlowConfig`, `loadFlowDirs` | `@mokei/flow-host-node` | File system access. |
| `startRetention` | `@mokei/flow-host-node` | Timer around `pruneRuns`. |

## Changes to `@mokei/flow-host`

### One root trace per run

`flow.run` becomes a root span (`root: true`). When a span is active at `start()`, the run span records it as a
link, not as a parent. So every run owns exactly one trace ID, and deleting a run's trace never touches another
run. `flow.run.resume` keeps using the stored `traceparent` as its parent, so a resumed run stays in its trace.

### Run context around all run work

Today `withRun` wraps only the launch call. Every piece of host work done for a run moves under its run context:
watcher polls and their task updates, watcher warnings, recovery of that run and its error logs, inbox reconcile,
answer and URL cancellation, cancel, and run event emission. Logs from these paths then carry the run's trace.
Host logs not tied to one run (startup, dispose) stay uncorrelated.

Tasks recovered by context-server before flow-host recovery keep their original trace through the stored
`requestMeta`. Their spans parent to the pre-crash span, not to `flow.run.resume`. That is acceptable: the trace ID
is the same.

### Store value contract

- Run and task records hold JSON values only. The memory run store switches from `structuredClone` to a JSON copy,
  matching the memory task store and the sqlite stores. `FlowRunSnapshot.result.output` is typed `JSONValue`.
- Every returned record is a fresh deep copy, on `create`, `get`, `update` and `list`.
- `update` never changes the record key: `runID` or `taskID` in a patch is overwritten by the stored key, in both
  memory stores and both sqlite stores.
- `RunStore.list(filter: { states?; limit?; updatedBefore?: number })`. `updatedBefore` keeps records whose
  `updatedAt` is strictly earlier. Results order by `createdAt` descending, ties in insertion order. `limit` must be
  a non-negative integer, else the call throws.
- `TaskStore.list` returns records in insertion order.

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
  attributes: Record<string, JSONValue>
  events: Array<{ name: string; time: number; attributes: Record<string, JSONValue> }>
  links: Array<{ traceID: string; spanID: string }>
}

type StoredLog = {
  traceID: string
  spanID: string
  timestamp: number // epoch milliseconds
  level: LogLevel
  category: Array<string>
  message: string
  properties: Record<string, JSONValue>
}

type TraceStore = {
  addSpans(spans: Array<StoredSpan>): Promise<void>
  addLogs(logs: Array<StoredLog>): Promise<void>
  getTrace(traceID: string): Promise<{ spans: Array<StoredSpan>; logs: Array<StoredLog> }>
  deleteTraces(traceIDs: Array<string>): Promise<{ spans: number; logs: number }>
  deleteBefore(time: number, keepTraceIDs: Array<string>): Promise<{ spans: number; logs: number }>
}
```

- `getTrace` returns spans ordered by `startTime` and logs by `timestamp`, ties in insertion order.
- `addSpans` is idempotent on `(traceID, spanID)`: a re-export overwrites.
- `deleteBefore` removes spans that ended and logs written before `time`, except those in `keepTraceIDs`. It
  catches spans and logs whose run was already pruned or never existed, including late exports.
- The stores accept only normalised values. Normalisation happens in the exporter and the sink (below).

`createMemoryTraceStore()` implements it for tests and in-process hosts.

### Value normalisation

One shared, non-throwing `toJSONValue(value)` converts attribute, event and property values. It mirrors the
guards in `@sozai/otel`'s log sink: a `JSON.stringify` that throws (BigInt, cycle, throwing `toJSON`) or returns
`undefined` (symbol, function, `undefined`) falls back to `String(value)`, and a `String()` that throws gives
`'[unrenderable]'`. A record is never dropped because of one value.

Message rendering matches `@sozai/otel`: `rawMessage` when it is a string, otherwise the joined `message` parts,
each rendered with the same guards.

### Span exporter

`createTraceStoreSpanExporter(store)` is an OTel `SpanExporter`. `export()` maps each `ReadableSpan` to a
`StoredSpan` and calls `addSpans` once per batch. A store failure resolves the callback with
`ExportResultCode.FAILED` and reports through the capture reporter. It never throws into the caller.

### Log sink

`createTraceStoreLogSink(store)` returns a logtape `Sink` with `flush(): Promise<void>`.

- At emit time the sink reads the active span from `@opentelemetry/api`. A record with no valid active span is
  skipped.
- The sink also skips records in the capture category, `['mokei', 'flow-host', 'capture']`. That category carries
  the exporter's and the sink's own failure reports, so a failing store cannot feed itself.
- The record is normalised and copied at emit time, so later mutation of its properties has no effect.
- Normalised records go into a queue. One writer drains the queue: it takes the whole queue as one batch, awaits
  `addLogs`, then takes the next batch. A write is scheduled on a microtask when the writer is idle.
- `flush()` resolves once the queue is empty and no write is in flight, including records added during the flush.
- A failed batch is dropped and reported once through the capture reporter. The writer then continues.

The capture reporter is `getReporter(['mokei', 'flow-host', 'capture'], '@mokei/flow-host')`.

Run correlation needs no run tag on logs. A run stores its `traceID`, and all run work runs under that run's
context, so its logs carry the trace.

Capture is local to the process that installs the sink and the provider. Trace context propagates to sibling MCP
servers through request metadata, so a sibling with its own telemetry can join the trace. Its spans and logs are
not stored here.

### `pruneRuns`

```ts
pruneRuns(params: {
  runStore: RunStore
  taskStore: TaskStore
  traceStore: TraceStore
  before: number
}): Promise<{ runs: number; skipped: number; spans: number; logs: number }>
```

Terminal states are `denied`, `completed`, `failed` and `cancelled`. Terminal run records are immutable: the
host's transitions treat them as absorbing, and the `RunStore` contract now says so. This is what makes selecting
and then deleting safe without a store-level lock.

1. List terminal runs with `updatedBefore: before`.
2. For each run:
   a. Re-read the run. Skip it when it is gone, not terminal, or no longer older than `before`.
   b. When it has a `taskID`, read the task. Skip the run (count it in `skipped`, report it) when the task exists
      and its status is not `completed`, `failed` or `cancelled`. Such a task may still be recovered or worked on.
   c. Delete its trace (when it has a `traceID`), then its task, then the run.
3. Call `traceStore.deleteBefore(before, keepTraceIDs)`, where `keepTraceIDs` are the trace IDs of every run that
   still exists, listed after step 2. A long-lived non-terminal run therefore keeps its old spans.

The order means a crash mid-prune leaves the run record in place, so the next pass finishes the job. A missing task
or trace is not an error. A failure on one run is reported and the pass moves on to the next run. Counts are the
actual deletions.

## `@mokei/flow-host-node`

### Database

`openFlowDatabase({ path? }): { db: DatabaseSync; close(): void }`

- Default path: `join(getDataDir('mokei'), 'mokei.db')`. The parent directory is created.
- Pragmas: `journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`.
- Migrations are an ordered array of SQL steps keyed by `PRAGMA user_version`, applied in one transaction at open.
  A database with a `user_version` newer than the code knows fails to open with a clear error.
- One process owns the database. The daemon is that process.

Schema v1:

```sql
CREATE TABLE runs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  trace_id TEXT,
  task_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX runs_state ON runs (state, updated_at);
CREATE INDEX runs_created ON runs (created_at DESC, seq);

CREATE TABLE tasks (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX tasks_status ON tasks (status, seq);

CREATE TABLE spans (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  data TEXT NOT NULL,
  UNIQUE (trace_id, span_id)
);
CREATE INDEX spans_trace ON spans (trace_id, start_time, seq);
CREATE INDEX spans_end ON spans (end_time);

CREATE TABLE logs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  timestamp REAL NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX logs_trace ON logs (trace_id, timestamp, seq);
CREATE INDEX logs_time ON logs (timestamp);
```

`data` holds the whole record as JSON. The indexed columns duplicate the fields the stores query on, so a
`RunRecord` or `TaskRecord` that grows needs no migration. `seq` gives insertion order for ties.

### Stores

- `createSQLiteRunStore(db): RunStore`
- `createSQLiteTaskStore(db): TaskStore`
- `createSQLiteTraceStore(db): TraceStore`

Semantics match the memory stores, under the contract above:

- `create` on an existing key throws the same error as the memory store: `RunStoreConflictError` with message
  `Run already exists: <runID>` for runs, `Error` with `Task already exists: <taskID>` for tasks.
- `update` reads the row, merges the patch in memory, forces the key and `revision + 1`, then runs
  `UPDATE ... WHERE key = ? AND revision = ?` and sets every indexed column from the merged record along with
  `data`. A missing row throws `Error` with the memory store's message. Zero changes throws the conflict error
  (`RunStoreConflictError`, `TaskStoreConflictError`). The read, merge and write are synchronous, so nothing
  interleaves in one process.
- `list` follows the ordering rules above.
- `deleteTraces` and `deleteBefore` each run in one transaction and return the deleted counts.

### Telemetry setup

```ts
setupFlowTelemetry(params: {
  traceStore: TraceStore
  otlp?: { endpoint: string; headers?: Record<string, string> }
  logs?: { level?: LogLevel; file?: boolean }
}): { dispose(): Promise<void> }
```

Telemetry is installed once per process. Cached tracers in `@mokei/decision-flow` and `@sozai/flow-graph` keep
their delegate after the first registration, so a second provider would receive nothing. A second call throws,
even after `dispose()`.

Setup steps:

1. Check before allocating anything. Throw when telemetry was set up before in this process, when `@sozai/log`
   `isSetup()` is true, or when an OTel global tracer provider or context manager is already registered.
2. Build the provider: `new BasicTracerProvider({ spanProcessors })`. The processors are a `BatchSpanProcessor`
   over `createTraceStoreSpanExporter`, plus a `BatchSpanProcessor` over the OTLP HTTP exporter when `otlp` is set.
3. Register `AsyncLocalStorageContextManager` with `context.setGlobalContextManager` and the provider with
   `trace.setGlobalTracerProvider`. A `false` return is an error.
4. Configure logging with `@sozai/log` `setup()`:
   - the trace store sink for all categories at `logs.level` (default `info`), with the capture category excluded
     by the sink itself;
   - a `@tejika/log` daily-rotating file sink for app `mokei` at the same level, unless `logs.file` is `false`;
   - a console (stderr) sink at `error` for the capture category, so capture failures surface even without a file.
5. When any step fails, undo the earlier steps in reverse and rethrow.

`dispose()` is idempotent. The caller quiesces first: it disposes flow hosts and sessions and stops retention.
Then dispose runs these steps, attempting each one even when an earlier one fails, and throws an `AggregateError`
at the end when any failed:

1. `provider.forceFlush()`, then `provider.shutdown()`.
2. `sink.flush()`, the final log drain, after span export diagnostics.
3. `@sozai/log` `reset()`.
4. `trace.disable()` and `context.disable()`.

The database is closed by its owner after `dispose()`.

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
  naming the file and each failing field path. Invalid JSON throws `FlowConfigError` naming the file.
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

`startRetention({ runStore, taskStore, traceStore, days, intervalMs? }): { stop(): Promise<void> }`

- Starts the first pass at once, without awaiting it, then one pass every `intervalMs` (default 24 hours) on an
  unref'd timer.
- `before` is `Date.now() - days * 86400000`.
- Only one pass runs at a time. A tick that fires while a pass runs is skipped.
- A failed pass is reported and the next tick still runs.
- `stop()` is idempotent. It clears the timer and resolves once any running pass ends.

## Dependencies

- `@mokei/flow-host` gains runtime dependencies: `@opentelemetry/api`, `@opentelemetry/core`,
  `@opentelemetry/sdk-trace-base`, `@logtape/logtape` (types), `@sozai/log`.
- `@mokei/flow-host-node` (new): `@mokei/flow-host`, `@mokei/context-server`, `@sozai/log`, `@sozai/schema`,
  `@tejika/env`, `@tejika/log`, `@logtape/logtape`, `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`,
  `@opentelemetry/context-async-hooks`, `@opentelemetry/exporter-trace-otlp-http`.
- New catalog entries, one matched OpenTelemetry release set: `@opentelemetry/core` and
  `@opentelemetry/context-async-hooks` at the installed SDK version (2.11.x), and
  `@opentelemetry/exporter-trace-otlp-http` at the experimental version released with it (0.222.x). Also
  `@tejika/log` ^0.4.0 and `@logtape/logtape` at the installed 2.3.x.

## Testing

- **Store contract suites** live in `@mokei/flow-host-node` tests: one each for `RunStore`, `TaskStore` and
  `TraceStore`, run against the memory store and the sqlite store. Cases include conflict classes and messages,
  key forcing on update, insertion-order ties, `limit` validation, `updatedBefore`, copy isolation, and the JSON
  value domain.
- **Persistence:** records written, database closed and reopened, records read back. A future `user_version` fails
  to open.
- **Normalisation:** BigInt, cycle, symbol, function, throwing `toJSON`, null-prototype object, throwing
  `toString`.
- **Exporter and sink (portable, memory store):** batch mapping, links, failure reported not thrown, a persistently
  failing store under an active span does not recurse, deferred `addLogs` with concurrent emits, property mutation
  after emit, `flush()` waits for in-flight writes.
- **Flow-host correlation:** two runs started under one caller span get distinct traces with a link. Watcher,
  inbox and recovery logs of a real run carry its trace, after async boundaries and after recovery.
- **Telemetry setup (own test file, one lifetime):** a span tree with logs lands in the store, and `getTrace`
  returns both in order. A log outside any span is not stored. A second setup throws. Setup fails cleanly when
  logging is already configured. Dispose attempts every step when one fails.
- **OTLP:** spans reach a local HTTP receiver stub when `otlp` is set.
- **Config:** valid file, missing file defaults, invalid JSON, unknown field, invalid field paths, path resolution,
  `~` expansion.
- **Retention:** cutoff boundary, non-terminal runs kept, task and trace cascade, a terminal run with an active
  task skipped, orphan and late-exported spans removed, kept traces of live runs untouched, a failure on one run
  does not stop the pass, a crash between cascade steps finishes on the next pass, overlapping ticks skipped,
  `stop()` awaits a running pass.
- **Restart smoke test:** a flow-host on sqlite stores waits for input, is disposed, and a fresh host over the same
  file recovers the run and completes it after the answer.
