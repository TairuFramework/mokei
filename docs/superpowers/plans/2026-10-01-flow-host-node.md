# Flow Host Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable SQLite stores, per-run telemetry capture, configuration and retention for Node flow hosts.

**Architecture:** Portable contracts, capture adapters, correlation and pruning live in `@mokei/flow-host`. The new `@mokei/flow-host-node` owns SQLite, process telemetry, files and timers. Shared contract tests prove memory and SQLite parity.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Node `node:sqlite`, OpenTelemetry, LogTape, `@sozai/schema`, `@tejika/env`, `@tejika/log`.

**Spec:** `docs/superpowers/specs/2026-10-01-flow-host-node-design.md`

## Global Constraints

- Preserve the approved spec's signatures, including positional store factories and configuration loaders.
- Keep `@mokei/flow-host` Node-free. Node imports belong in `@mokei/flow-host-node` or tests.
- One process owns the database. Telemetry is installed once per process, even after disposal.
- Use `node:sqlite`. Default database: `join(getDataDir('mokei'), 'mokei.db')`.
- Default configuration: `join(getDataDir('mokei'), 'flows.json')`.
- Pragmas: `journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`.
- Terminal run states: `denied`, `completed`, `failed`, `cancelled`. Terminal run records are immutable.
- Keep task TTL defaults at `null`. Dispose suspends work for recovery.
- Capture category: `['mokei', 'flow-host', 'capture']`. Reporter: `getReporter(['mokei', 'flow-host', 'capture'], '@mokei/flow-host')`.
- Defaults: log level `info`, retention `30` days, retention interval `86400000` milliseconds.
- Use one matched release set: core, trace SDK and async-hooks `2.11.x`, OTLP HTTP `0.222.x`, LogTape `2.3.x`.
- Add catalog entries `@tejika/log: ^0.4.0` and `@logtape/logtape: ^2.3.0`.
- Use `type`, `Array<T>`, `unknown`, capital `ID`, ES `#private`, kebab-case files and `.js` relative imports.
- Use British spelling and ` -- ` prose dashes. Exclude task labels from code and test names. Never use `sed -i`.
- The approved spec authorises the new public package. Add it to `versioning.fixed` in `pnpm-workspace.yaml`.
- Implementers run direct binaries, never pnpm or git. The controller installs, rebuilds, runs repository checks and commits.
- Execute tasks sequentially on `feat/flow-host-node`. Dispatch each task with this constraints section and its complete task text.
- After Task 1, the controller runs `pnpm install` and rebuilds affected workspace dependencies, including context-server.
- After Task 6, the controller runs `rtk proxy pnpm run build` from `packages/flow-host` before Node-package consumers run.
- After Task 7, the controller runs `pnpm install`. Rebuild any subsequently changed workspace dependency before downstream tests.
- Exclude daemon procedures, CLI, monitor, desktop wiring and sibling-process telemetry ingestion.
- Final changeset lists patch bumps only for `@mokei/flow-host` and `@mokei/flow-host-node`.

## Review Focus

- An invalid active span must not correlate logs or produce a bogus link -- assert this in Tasks 4 and 5.
- Concurrent run work and terminal event listeners must retain their own context across awaits -- assert this in Task 5.
- Existing process telemetry or partial setup failure must leave the caller's registrations intact -- assert this in Task 10.
- Empty ID collections and large keep sets must not generate invalid SQL or delete live traces -- assert this in Task 9.
- Script-looking flags and ordinary sibling arguments must survive path resolution unchanged -- assert this in Task 11.

---

## File Structure

| Paths | Responsibility |
| --- | --- |
| `packages/flow-host/src/run-store.ts`, `types.ts`, `map-task.ts` | JSON records, stable keys and run filtering |
| `packages/context-server/src/task-store.ts` | Existing task contract and JSON error data |
| `packages/flow-host/src/trace-store.ts` | Trace types and memory implementation |
| `packages/flow-host/src/to-json-value.ts` | Guarded value and message rendering |
| `packages/flow-host/src/trace-store-span-exporter.ts`, `trace-store-log-sink.ts` | Portable capture adapters |
| `packages/flow-host/src/tracing.ts`, `host.ts`, `launch.ts`, `watcher.ts`, `recovery.ts`, `inbox.ts` | Run context ownership |
| `packages/flow-host/src/prune-runs.ts` | Generic deletion cascade and orphan sweep |
| `packages/flow-host-node/src/database.ts`, `migrations.ts` | Database lifetime and schema |
| `packages/flow-host-node/src/sqlite-run-store.ts`, `sqlite-task-store.ts`, `sqlite-trace-store.ts` | Persistent stores |
| `packages/flow-host-node/src/telemetry.ts` | Process telemetry ownership and teardown |
| `packages/flow-host-node/src/config.ts`, `flow-dirs.ts` | Configuration validation and flow files |
| `packages/flow-host-node/src/retention.ts` | Non-overlapping pruning timer |
| `packages/flow-host-node/test/contracts/*.ts` | Shared store assertions |
| Both packages' `src/index.ts` | Public exports only |

Verification commands below run from the owning package directory. Every code task also runs `../../node_modules/.bin/tsc --noEmit --skipLibCheck -p tsconfig.test.json`. Expected: exit 0.

### Task 1: Align JSON store contracts and portable dependencies

**Files:**
- Modify: `packages/flow-host/src/run-store.ts`, `packages/flow-host/src/types.ts`, `packages/flow-host/src/map-task.ts`
- Modify: `packages/context-server/src/task-store.ts`, `packages/flow-host/package.json`, `pnpm-workspace.yaml`
- Test: `packages/flow-host/test/run-store.test.ts`, `packages/flow-host/test/map-task.test.ts`, `packages/context-server/test/task-store.test.ts`

**Interfaces:**
- Consumes: `JSONValue`, `TaskRecord`, `TaskStore`, `TaskStoreConflictError` from `@mokei/context-server`.
- Produces: `RunStore.list(filter: { states?: Array<RunState>; limit?: number; updatedBefore?: number }): Promise<Array<RunRecord>>`.
- Preserves: `RunStore.create(record: RunRecord): Promise<void>`, `get(runID: string): Promise<RunRecord | undefined>`, `update(runID: string, patch: Partial<RunRecord>, expected: { revision: number }): Promise<RunRecord>`, `delete(runID: string): Promise<void>`.
- Produces: `FlowRunSnapshot.result.output?: JSONValue`, `TaskRecord.error.data?: JSONValue`. Expose `updatedBefore?: number` through `FlowHost.list` too.
- Preserves: `TaskStore.list(filter: { status: Array<TaskStatus> }): Promise<Array<TaskRecord>>`, insertion order, existing CAS and key forcing.

- [ ] **Step 1: Write failing store tests.**

Add `keeps the run key and revision controlled by the store`:
```ts
const changed = await store.update('one', { runID: 'other', revision: 99 }, { revision: 0 })
expect(changed).toMatchObject({ runID: 'one', revision: 1 })
expect(await store.get('other')).toBeUndefined()
```
Add `filters strictly before updatedAt and preserves insertion ties`: create `a`, `b` at `createdAt: 10`, `updatedAt: 20`, and `c` at `createdAt: 30`, `updatedAt: 21`.
```ts
expect((await store.list({ updatedBefore: 21 })).map((run) => run.runID)).toEqual(['a', 'b'])
expect(await store.list({ limit: 0 })).toEqual([])
```
Add `rejects invalid list limits`, parameterised over `-1`, `1.5`, `NaN`, `Infinity`. Assert rejection with `RangeError`.
Add `isolates JSON values at every record boundary`: mutate input, fetched, listed, patch and update-result nested arrays. Assert persisted values remain unchanged.
Add `uses JSON copy semantics`: optional `undefined` disappears, arrays containing `null`, booleans, strings and numbers round-trip.
Extend task tests with exact duplicate, missing and conflict messages, insertion order and `ttlMs: null`.
Add a compile-time `expectTypeOf` assertion that mapped output is `JSONValue | undefined`.

- [ ] **Step 2: Verify failure.**
Run in flow-host: `../../node_modules/.bin/vitest run test/run-store.test.ts test/map-task.test.ts`. Expect key/filter/limit failures.

- [ ] **Step 3: Declare dependencies before implementation.**
Move API and SDK from flow-host devDependencies to dependencies. Add core, LogTape and `@sozai/log` using `catalog:`.
Add catalog core `^2.11.0`, async-hooks `^2.11.0`, OTLP HTTP `^0.222.0`, LogTape `^2.3.0`, Tejika log `^0.4.0`.
Align the existing SDK catalog entry to `^2.11.0`. The controller runs `pnpm install` before capture tasks.

- [ ] **Step 4: Implement the contract.**
Use JSON round-trips in the memory run store. Force stored keys after patches. Validate limits before filtering.
Use strict `< updatedBefore`, stable descending creation order and fresh returned copies.
Document terminal run immutability as a caller contract. Preserve absorbing host transitions without inventing new store rejection semantics.
Narrow task error data and mapped output to JSON values. Follow existing protocol JSON types without unsafe arbitrary-value casts.

- [ ] **Step 5: Verify both packages.**
Run flow-host's commands from Step 2 and its typecheck. Run `../../node_modules/.bin/vitest run test/task-store.test.ts` and typecheck in context-server.
Expected: all pass. The controller rebuilds context-server before later workspace consumers.

- [ ] **Step 6: Controller commit message:** `feat(flow-host): align portable store contracts`

### Task 2: Add TraceStore and its memory implementation

**Files:**
- Create: `packages/flow-host/src/trace-store.ts`
- Modify: `packages/flow-host/src/index.ts`
- Test: `packages/flow-host/test/trace-store.test.ts`

**Interfaces:**
- Consumes: `JSONValue` from `@mokei/context-server`, `LogLevel` from `@logtape/logtape`.
- Produces and exports:
```ts
type StoredSpan = {
  traceID: string
  spanID: string
  parentSpanID?: string
  name: string
  kind: number
  startTime: number
  endTime: number
  status: { code: number; message?: string }
  attributes: Record<string, JSONValue>
  events: Array<{ name: string; time: number; attributes: Record<string, JSONValue> }>
  links: Array<{ traceID: string; spanID: string }>
}
type StoredLog = {
  traceID: string
  spanID: string
  timestamp: number
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
function createMemoryTraceStore(): TraceStore
```

- [ ] **Step 1: Write failing trace tests.**
Add `orders spans and logs with stable insertion ties`: insert spans at `2.5`, `1.5`, `1.5` and logs at `20`, `10`, `10`. Assert chronological order and insertion ties.
Add `overwrites a span without changing its insertion position`: re-export the same pair with a changed name. Assert one row and original tie position.
Add `copies batches and fetched nested records`: mutate input attributes/events and returned records. Assert later reads retain original values.
Add `deletes strictly older rows except kept traces`:
```ts
expect(await store.deleteBefore(20, [liveTraceID])).toEqual({ spans: 1, logs: 1 })
expect((await store.getTrace(boundaryTraceID)).spans).toHaveLength(1)
expect(await store.deleteTraces([])).toEqual({ spans: 0, logs: 0 })
```
Use span `endTime`, not `startTime`, for cutoff. Assert missing traces return empty arrays and repeat deletion counts zero.

- [ ] **Step 2: Verify failure.**
Run: `../../node_modules/.bin/vitest run test/trace-store.test.ts`. Expect missing module/export.

- [ ] **Step 3: Implement and export the types and factory.**
Keep JSON copies, insertion sequence and pair-keyed span upserts. Accept already normalised records only.
Return actual counts for both deletion methods. Preserve fractional epoch milliseconds.

- [ ] **Step 4: Verify tests and package typecheck.**
Run the Step 2 command. Expected: pass.

- [ ] **Step 5: Controller commit message:** `feat(flow-host): add memory trace storage`

### Task 3: Add guarded telemetry value normalisation

**Files:**
- Create: `packages/flow-host/src/to-json-value.ts`
- Test: `packages/flow-host/test/to-json-value.test.ts`

**Interfaces:**
- Consumes: `JSONValue` and LogTape `LogRecord` types.
- Produces internally: `toJSONValue(value: unknown): JSONValue`, `renderLogMessage(record: Pick<LogRecord, 'rawMessage' | 'message'>): string`.

- [ ] **Step 1: Write failing normalisation tests.**
Add `normalises values without dropping records`, using these assertions:
```ts
expect(toJSONValue(12n)).toBe('12')
expect(toJSONValue(undefined)).toBe('undefined')
expect(toJSONValue(Symbol('value'))).toBe('Symbol(value)')
expect(toJSONValue(Object.create(null))).toEqual({})
expect(toJSONValue({ toJSON() { throw new Error('bad') } })).toBe('[object Object]')
```
Assert cyclic objects fall back to their string representation. Assert functions become `String(fn)`.
Assert an object whose `toJSON` and `toString` both throw becomes `'[unrenderable]'`.
Assert valid nested JSON is copied and `NaN` normalises to `null`.
Add `renders raw messages and guarded template parts`: string `rawMessage` wins verbatim. Template parts join without separators.
Assert object interpolation uses JSON, BigInt uses strings, and unrenderable interpolation preserves the surrounding text.

- [ ] **Step 2: Verify failure.**
Run: `../../node_modules/.bin/vitest run test/to-json-value.test.ts`. Expect missing module.

- [ ] **Step 3: Implement the two functions.**
Try `JSON.stringify` then `JSON.parse`. On throws or undefined serialisation, try `String`, then `'[unrenderable]'`.
Match `@sozai/otel` rendering: string parts remain strings, odd interpolation parts try JSON, remaining parts try guarded strings.

- [ ] **Step 4: Verify tests and package typecheck.**
Run the Step 2 command. Expected: pass.

- [ ] **Step 5: Controller commit message:** `feat(flow-host): normalise telemetry values safely`

### Task 4: Capture span batches and serialised log batches

**Files:**
- Create: `packages/flow-host/src/trace-store-span-exporter.ts`, `packages/flow-host/src/trace-store-log-sink.ts`
- Modify: `packages/flow-host/src/index.ts`
- Test: `packages/flow-host/test/trace-store-span-exporter.test.ts`, `packages/flow-host/test/trace-store-log-sink.test.ts`

**Interfaces:**
- Consumes: `TraceStore`, `StoredSpan`, `StoredLog` from `./trace-store.js`.
- Consumes: `toJSONValue(value: unknown): JSONValue`, `renderLogMessage(record: Pick<LogRecord, 'rawMessage' | 'message'>): string`.
- Produces and exports: `createTraceStoreSpanExporter(store: TraceStore): SpanExporter` and `createTraceStoreLogSink(store: TraceStore): Sink & { flush(): Promise<void> }`.
- `SpanExporter`/`ReadableSpan` come from SDK trace base. `ExportResultCode` comes from core. `Sink`/`LogRecord` are type-only LogTape imports.

- [ ] **Step 1: Write failing capture tests.**
Add `maps a span batch including events and links`: export two real readable SDK spans. Assert one `addSpans` call and all stored fields.
Use an event timestamp `[1, 500000]`. Assert `time === 1000.5`. Assert SDK `traceId`/`spanId` map to `traceID`/`spanID`.
Assert root spans omit parent IDs, child spans preserve parent IDs, links omit unrelated SDK fields and attributes normalise independently.
Add `reports exporter failure through the callback`: reject `addSpans`. Assert callback once with `FAILED`, reporter once, no thrown exception.
Add `skips uncorrelated invalid and capture logs`: absent span, zero IDs and capture category each produce no `addLogs` call.
Add `copies log properties and correlation at emit time`: mutate properties and switch active spans before draining. Assert original JSON and original IDs.
Add `serialises batches and drains concurrent flush emissions`: hold first `addLogs`, emit more records, call two flushes.
```ts
expect(addLogs).toHaveBeenCalledTimes(1)
expect(flushed).toBe(false)
// Release the first batch, await both flushes.
expect(maxConcurrentWrites).toBe(1)
expect(persistedMessages).toEqual(['first', 'second', 'during flush'])
```
Add `drops a failed batch once and continues without recursive capture`: fail repeatedly under an active span with logging configured.
Assert exactly one report per failed batch, bounded store calls and eventual flush completion. Restore logging and OTel globals after each file.

- [ ] **Step 2: Verify failure.**
Run: `../../node_modules/.bin/vitest run test/trace-store-span-exporter.test.ts test/trace-store-log-sink.test.ts`. Expect missing exports.

- [ ] **Step 3: Implement the exporter.**
Map epoch times as `seconds * 1000 + nanoseconds / 1000000`. Normalise individual attribute and event values.
Call `addSpans` once per export. Catch synchronous and asynchronous failures. Resolve callbacks once with success or failure.
Implement `shutdown(): Promise<void>` and `forceFlush(): Promise<void>` awaiting outstanding exports. Do not close the externally owned store.
Report with `getReporter(['mokei', 'flow-host', 'capture'], '@mokei/flow-host')`.

- [ ] **Step 4: Implement the sink.**
Require `isSpanContextValid` at emit time. Exclude the capture category and its descendants to prevent recursive reporting.
Copy and normalise before queueing. Schedule an idle writer with a microtask. Drain entire queued batches with one writer.
Drop failed batches and report once. Resolve every flush waiter only when both queue and writer are empty.

- [ ] **Step 5: Verify capture tests and package typecheck.**
Run the Step 2 command. Expected: pass.

- [ ] **Step 6: Controller commit message:** `feat(flow-host): capture spans and correlated logs`

### Task 5: Give every run an independent trace and complete run context

**Files:**
- Modify: `packages/flow-host/src/tracing.ts`, `packages/flow-host/src/host.ts`, `packages/flow-host/src/launch.ts`
- Modify: `packages/flow-host/src/watcher.ts`, `packages/flow-host/src/recovery.ts`, `packages/flow-host/src/inbox.ts`
- Test: `packages/flow-host/test/tracing.test.ts`, `packages/flow-host/test/run-context.test.ts`

**Interfaces:**
- Consumes: existing `createRunTracing()` with `start(record): Pick<RunRecord, 'traceID' | 'traceparent'>`, `resume(record): void`, `withRun<T>(runID: string, work: () => T): T`, `state`, `end`, `dispose`.
- Produces internally: pass `withRun<T>(runID: string, work: () => T): T` into watcher, recovery and inbox parameter types.
- Preserves: public `createFlowHost(params: FlowHostParams): Promise<FlowHost>` and all host/inbox operations.

- [ ] **Step 1: Write failing correlation tests.**
Add `starts independent root traces linked to the caller`: start two runs inside one caller span.
```ts
expect(first.traceID).not.toBe(second.traceID)
expect(first.traceID).not.toBe(caller.spanContext().traceId)
expect(runSpans.every((span) => span.parentSpanContext === undefined)).toBe(true)
expect(runSpans[0]?.links[0]?.context).toEqual(caller.spanContext())
```
Add `ignores an invalid caller span link` and retain both existing no-SDK tests asserting absent stored trace fields.
Add `correlates concurrent watcher inbox and terminal listener work after awaits`: use real hosts with two input flows.
Wrap real client polling and updates to emit logs after an await. Inject one poll failure and a URL input cancellation.
Log from all three event listeners after an await. Answer one run and cancel the other. Assert every marker has its run's traceID.
Assert terminal event logs remain correlated although the run span ends. Assert no context leaks into subsequent outside-span logging.
Add `correlates resumed recovery failures and inbox work`: dispose an input host, recreate it, answer it, and inject another run's recovery failure.
Assert recovered logs use stored trace IDs. Assert `flow.run.resume` parents the stored traceparent and recovered task spans retain original request metadata.
Use existing `test/fixture.ts`, input definitions in `test/inbox.test.ts` and the async context manager pattern in `test/tracing.test.ts`.

- [ ] **Step 2: Verify failure.**
Run: `../../node_modules/.bin/vitest run test/tracing.test.ts test/run-context.test.ts`. Expect root/context assertions to fail.

- [ ] **Step 3: Implement root ownership and run context boundaries.**
Start `flow.run` with `root: true`. Add a link only for a valid caller span. Preserve stored-parent semantics for `flow.run.resume`.
Wrap complete launch authorisation, polling loops, warning/error catches, task updates and each recovered run in `withRun`.
Resume before entering recovery context. Keep per-run recovery catches within that context.
Wrap inbox reconciliation, answers, declines, cancellation, URL cancellation, run cancellation and queued transitions.
Emit events under run context. Capture the context before terminal span cleanup, including subsequent inbox settlement emissions.
Preserve per-run queue ordering and network calls outside queues. Keep startup/dispose outside run context.

- [ ] **Step 4: Verify the complete portable package.**
Run: `../../node_modules/.bin/vitest run`. Run package typecheck. Expected: all pass, including recovery and terminal cleanup.

- [ ] **Step 5: Controller commit message:** `fix(flow-host): isolate traces and correlate all run work`

### Task 6: Implement resumable generic run pruning

**Files:**
- Create: `packages/flow-host/src/prune-runs.ts`
- Modify: `packages/flow-host/src/index.ts`
- Test: `packages/flow-host/test/prune-runs.test.ts`

**Interfaces:**
- Consumes: `RunStore.list({ states?, limit?, updatedBefore? })`, `get`, `delete` and `TaskStore.get`, `delete`.
- Consumes: `TraceStore.deleteTraces(traceIDs: Array<string>): Promise<{ spans: number; logs: number }>`, `deleteBefore(time: number, keepTraceIDs: Array<string>): Promise<{ spans: number; logs: number }>`.
- Produces and exports:
```ts
function pruneRuns(params: {
  runStore: RunStore
  taskStore: TaskStore
  traceStore: TraceStore
  before: number
}): Promise<{ runs: number; skipped: number; spans: number; logs: number }>
```

- [ ] **Step 1: Write failing pruning tests.**
Add `cascades old terminal runs in trace task run order`: spy on deletions and assert exact order, counts and missing records.
Add `keeps boundary and non-terminal runs`: cutoff `100`, updatedAt `99` prunes, `100` stays. Include all seven run states.
Add `skips terminal runs whose tasks remain active`: working/input-required tasks stay, `skipped === 2`, report twice.
Add `rechecks candidates before deletion`: a disappeared, newly non-terminal or refreshed run stays untouched. Count each as skipped.
Add `sweeps orphan and late exports but keeps all surviving run traces`: include skipped terminal traces and long-lived active traces.
Add `continues after a cascade failure and finishes on the next pass`: fail task deletion after trace deletion.
```ts
expect(first.runs).toBe(1)
expect(first.spans).toBe(2)
expect(await runStore.get(failedRunID)).toBeDefined()
expect(second.runs).toBe(1)
expect(second.spans).toBe(0)
```
Count successful trace deletions even when a later cascade step fails. Assert missing tasks/traces are harmless.

- [ ] **Step 2: Verify failure.**
Run: `../../node_modules/.bin/vitest run test/prune-runs.test.ts`. Expect missing export.

- [ ] **Step 3: Implement the pruning function.**
Select terminal candidates strictly before cutoff. Re-read each candidate before touching its task or trace.
Treat only completed/failed/cancelled tasks as terminal. Report active-task skips and per-run failures with the capture reporter.
Delete trace, task, then run. Accumulate actual successful deletions immediately. Failed cascades leave their run for retry.
List every remaining run after cascades. Sweep older orphan telemetry while protecting their trace IDs.
Let selection/final-sweep failures reject so the retention scheduler reports failed passes.

- [ ] **Step 4: Verify tests and package typecheck.**
Run: `../../node_modules/.bin/vitest run`. Expected: all pass.
The controller rebuilds flow-host with `rtk proxy pnpm run build` from `packages/flow-host` before Task 7.

- [ ] **Step 5: Controller commit message:** `feat(flow-host): prune terminal runs and orphan telemetry`

### Task 7: Scaffold the public Node package and declare dependencies

**Files:**
- Create: `packages/flow-host-node/package.json`, `packages/flow-host-node/LICENSE`
- Create: `packages/flow-host-node/tsconfig.json`, `packages/flow-host-node/tsconfig.test.json`, `packages/flow-host-node/vitest.config.ts`
- Create: `packages/flow-host-node/src/index.ts`, `packages/flow-host-node/test/package.test.ts`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Consumes: built `@mokei/flow-host` and `@mokei/context-server` through workspace links.
- Produces: ESM package `@mokei/flow-host-node`, version `0.14.0`, export `.: ./lib/index.js`, types `lib/index.d.ts`.

- [ ] **Step 1: Write the failing package test.**
Add `publishes the Node flow host entry point`. Read the package manifest and import `../src/index.js`.
```ts
expect(manifest.name).toBe('@mokei/flow-host-node')
expect(manifest.version).toBe('0.14.0')
expect(manifest.type).toBe('module')
expect(manifest.exports).toEqual({ '.': './lib/index.js' })
expect(manifest.types).toBe('lib/index.d.ts')
expect(entry).toBeDefined()
```

- [ ] **Step 2: Verify failure.**
From the new package directory, run `../../node_modules/.bin/vitest run test/package.test.ts`. Expect missing manifest or entry.

- [ ] **Step 3: Declare the manifest and dependencies.**
Copy flow-host's manifest structure, scripts, publishing metadata and licence. Change name, description, keywords and repository directory.
Runtime dependencies, exactly: `@mokei/flow-host`, `@mokei/context-server`, `@sozai/log`, `@sozai/schema`, `@tejika/env`, `@tejika/log`, `@logtape/logtape`, `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/context-async-hooks`, `@opentelemetry/exporter-trace-otlp-http`.
Use `workspace:^` internally and `catalog:` externally.
Dev dependencies: `@types/node`, `@sozai/flow-graph`, `@mokei/session`, `@mokei/decision-flow` with the same respective protocols.
Add `@mokei/flow-host-node` immediately after flow-host in `versioning.fixed`. The controller runs `pnpm install` now.

- [ ] **Step 4: Complete package scaffolding.**
Copy both tsconfigs and Vitest configuration verbatim from `packages/flow-host`. Start `src/index.ts` with `export {}`.
Later tasks add only their completed public exports. Do not create unrelated configuration or packages.

- [ ] **Step 5: Verify the package test and package typecheck.**
Run the Step 2 command. Expected: pass after controller installation and the flow-host rebuild.

- [ ] **Step 6: Controller commit message:** `feat(flow-host-node): scaffold the public node package`

### Task 8: Open SQLite databases with transactional migrations

**Files:**
- Create: `packages/flow-host-node/src/database.ts`, `packages/flow-host-node/src/migrations.ts`
- Modify: `packages/flow-host-node/src/index.ts`
- Test: `packages/flow-host-node/test/database.test.ts`

**Interfaces:**
- Consumes: `DatabaseSync` from `node:sqlite`, `getDataDir` from `@tejika/env`.
- Produces and exports: `openFlowDatabase(params: { path?: string }): { db: DatabaseSync; close(): void }`.
- Produces internally: `migrations: Array<string>` containing the schema-v1 SQL, `migrateFlowDatabase(db: DatabaseSync): void`.

- [ ] **Step 1: Write failing database tests.**
Add `creates parent directories and applies schema once`: open a nested temporary file, inspect tables/indexes, close and reopen.
```ts
expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 })
expect(db.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' })
expect(db.prepare('PRAGMA busy_timeout').get()).toMatchObject({ timeout: 5000 })
expect(db.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 })
```
Assert all four tables, seven named indexes and unique run/task/span keys exist.
Add `uses the mokei data directory by default` with mocked `getDataDir` pointing to a temporary directory.
Add `rejects newer schema versions without changing the database`: set `user_version = 2`, reopen, assert clear newer-version error and unchanged version.
Add `rolls back an unsuccessful migration`: pre-create incompatible `tasks`, trigger failure, assert version zero and no partially created `runs`.
Add `supports an in-memory test database`: open `:memory:` and assert schema, without assuming WAL mode there.

- [ ] **Step 2: Verify failure.**
Run: `../../node_modules/.bin/vitest run test/database.test.ts`. Expect missing export.

- [ ] **Step 3: Implement database ownership and schema v1.**
Use this exact schema for migration one:
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
Create the parent directory, except for `:memory:`. Set all three pragmas before migration.
Apply ordered unapplied steps and `user_version` in one transaction. Roll back and close the handle on open failure.
Reject future versions before modifying schema. Return an owner-controlled close function.

- [ ] **Step 4: Verify database tests and package typecheck.**
Run the Step 2 command. Expected: pass.

- [ ] **Step 5: Controller commit message:** `feat(flow-host-node): open sqlite databases with migrations`

### Task 9: Implement SQLite stores with shared contract suites

**Files:**
- Create: `packages/flow-host-node/src/sqlite-run-store.ts`, `packages/flow-host-node/src/sqlite-task-store.ts`, `packages/flow-host-node/src/sqlite-trace-store.ts`
- Create: `packages/flow-host-node/test/contracts/run-store.ts`, `packages/flow-host-node/test/contracts/task-store.ts`, `packages/flow-host-node/test/contracts/trace-store.ts`
- Create: `packages/flow-host-node/test/support/records.ts`, `packages/flow-host-node/test/store-contracts.test.ts`, `packages/flow-host-node/test/persistence.test.ts`
- Modify: `packages/flow-host-node/src/index.ts`

**Interfaces:**
- Consumes: `DatabaseSync`, `RunStore`, `RunRecord`, `RunStoreConflictError`, `TaskStore`, `TaskRecord`, `TaskStoreConflictError`, `TraceStore`, `StoredSpan`, `StoredLog`.
- Run list signature: `list(filter: { states?: Array<RunState>; limit?: number; updatedBefore?: number }): Promise<Array<RunRecord>>`.
- Task list signature: `list(filter: { status: Array<TaskStatus> }): Promise<Array<TaskRecord>>`.
- Produces and exports: `createSQLiteRunStore(db: DatabaseSync): RunStore`, `createSQLiteTaskStore(db: DatabaseSync): TaskStore`, `createSQLiteTraceStore(db: DatabaseSync): TraceStore`.
- Produces test helpers: `runStoreContract(name: string, create: () => RunStore): void`, `taskStoreContract(name: string, create: () => TaskStore): void`, `traceStoreContract(name: string, create: () => TraceStore): void`.

- [ ] **Step 1: Write failing shared contracts and persistence tests.**
Register each contract against memory and fresh in-memory SQLite stores. Close all handles after each case.
Run cases: duplicate class/message, missing-update message, stale CAS, forced key/revision, concurrent CAS winner, ordering, limits and strict cutoff.
```ts
await expect(runStore.create(run)).rejects.toThrow(`Run already exists: ${run.runID}`)
await expect(runStore.create(run)).rejects.toBeInstanceOf(RunStoreConflictError)
await expect(taskStore.create(task)).rejects.toThrow(`Task already exists: ${task.taskID}`)
await expect(taskStore.update('missing', {}, { revision: 0 })).rejects.toThrow('Task not found: missing')
await expect(runStore.update('missing', {}, { revision: 0 })).rejects.toThrow('Run not found: missing')
```
Assert CAS messages `'Run store revision conflict'` and `'Task revision conflict'` with their exact classes.
Mutate every input, patch and returned nested record boundary. Assert persisted isolation and JSON-domain round-trips, including task inputs and nullable TTL.
Assert empty filters yield empty results, run creation ties preserve insertion, task lists preserve insertion and invalid limits reject `RangeError`.
Trace cases: fractional times, pair upsert preserving seq, ordered ties, strict end-time cutoff, kept traces, counts, missing IDs, empty ID sets.
Add `protects a large keep set`: keep `40000` trace IDs containing one stored trace. Assert it survives without SQL variable-limit failure.
Add `rolls back a failed telemetry deletion transaction`: inject a SQLite trigger failing log deletion. Assert previously deleted spans survive rollback.
Add `persists every store across reopening`: write run/task/span/log records, update indexed fields, close, reopen and assert equality and filtered queries.

- [ ] **Step 2: Verify failure.**
Run: `../../node_modules/.bin/vitest run test/store-contracts.test.ts test/persistence.test.ts`. Expect missing SQLite factories.

- [ ] **Step 3: Implement run and task factories.**
Use parameterised prepared statements and JSON serialisation. Translate duplicate errors into exact memory-store errors.
Synchronously read, verify expected revision, merge, force the stored key and increment revision, then CAS-update every indexed column and JSON.
Zero affected rows produce the relevant conflict class. Missing rows produce the exact messages above.
Run ordering: `created_at DESC, seq ASC`. Task ordering: `seq ASC`. Validate limits before executing SQL.

- [ ] **Step 4: Implement the trace factory.**
Upsert spans using `ON CONFLICT(trace_id, span_id) DO UPDATE`, preserving `seq`. Insert logs with stable sequence.
Order by timestamp then seq. Wrap each deletion method's span/log deletes in one transaction with rollback on failure.
Handle empty collections explicitly. Use bounded ID batches or a transaction-local keep table for large collections.
Return actual SQLite deletion counts. Keep JSON records and indexed columns synchronised.

- [ ] **Step 5: Verify contracts, persistence and package typecheck.**
Run the Step 2 command. Expected: memory and SQLite pass identical cases.

- [ ] **Step 6: Controller commit message:** `feat(flow-host-node): persist flow stores in sqlite`

### Task 10: Own process telemetry setup and exhaustive disposal

**Files:**
- Create: `packages/flow-host-node/src/telemetry.ts`
- Modify: `packages/flow-host-node/src/index.ts`
- Test: `packages/flow-host-node/test/telemetry.test.ts`, `packages/flow-host-node/test/telemetry-failures.test.ts`, `packages/flow-host-node/test/telemetry-otlp.test.ts`

**Interfaces:**
- Consumes: `createTraceStoreSpanExporter(store: TraceStore): SpanExporter`, `createTraceStoreLogSink(store: TraceStore): Sink & { flush(): Promise<void> }` from built `@mokei/flow-host`.
- Produces and exports:
```ts
function setupFlowTelemetry(params: {
  traceStore: TraceStore
  otlp?: { endpoint: string; headers?: Record<string, string> }
  logs?: { level?: LogLevel; file?: boolean }
}): { dispose(): Promise<void> }
```

- [ ] **Step 1: Write failing setup and lifecycle tests.**
Keep real success setup to one lifetime per isolated test file. Run precondition and rollback cases before successful setup.
Add `captures an ordered span tree and logs for one lifetime`: use memory trace storage, `logs.file: false`, root and child spans.
Log outside spans, inside each span and after an await. Dispose and assert two ordered spans and correlated ordered logs only.
Assert capture reports reach stderr at error level without entering storage. Assert default level excludes debug and explicit debug includes it.
Assert a second call throws before disposal and after disposal. Assert repeated disposal returns the same completion and performs cleanup once.
Add `rejects existing logging and telemetry without allocation`: separately preconfigure logging, provider and context manager.
Assert setup throws, constructors/file-sink creation were not called, and existing registrations remain usable.
Add `rolls back failed registration and logging setup`: mock context/provider registration returning false and logging/file-sink creation throwing.
Assert reverse cleanup touches only owned resources and preserves the original thrown error.
Add `attempts all disposal steps after failures`: inject forceFlush, shutdown and sink.flush failures.
```ts
await expect(handle.dispose()).rejects.toBeInstanceOf(AggregateError)
expect(order).toEqual(['forceFlush', 'shutdown', 'sink.flush', 'reset', 'trace.disable', 'context.disable'])
```
Add `exports OTLP spans to a local HTTP receiver`: capture body and headers. Assert configured header and span name arrive at `/v1/traces`.
Bind on loopback with an allocated port. Close receiver after disposal. Mock daily rotating file factory to assert app `mokei` and default enabled behaviour.

- [ ] **Step 2: Verify failure.**
Run: `../../node_modules/.bin/vitest run test/telemetry.test.ts test/telemetry-failures.test.ts test/telemetry-otlp.test.ts`. Expect missing setup.

- [ ] **Step 3: Implement ownership checks and setup.**
Check the process-lifetime latch, `isSetup()` and existing OTel global registrations before allocating anything.
Read the OTel global registry with typed narrowing. Do not probe by registering a temporary provider or obtaining a cached tracer.
Create `BasicTracerProvider({ spanProcessors })` with local batch export and optional OTLP HTTP batch export.
Register an enabled `AsyncLocalStorageContextManager` and the provider. Treat false returns as errors.
Use `@sozai/log` setup, the capture sink at configured/default `info`, and Tejika's daily rotating file sink for app `mokei`.
Inspect installed `@tejika/log` exports after controller installation. Use its supported factory without inventing an alternate file sink.
Route capture-category errors through `getConsoleSink()` at level `error`. Its default error mapping uses stderr.
Disable file output only when `logs.file === false`.
Track owned resources and roll back partial setup in reverse. Set the permanent latch after successful installation.

- [ ] **Step 4: Implement idempotent disposal.**
Attempt forceFlush, shutdown, capture flush, logging reset, trace disable and context disable in that exact order.
Attempt every operation independently. Collect failures and throw `AggregateError` afterwards. Share the disposal promise across calls.
Do not close the database. Callers quiesce hosts, sessions and retention first.

- [ ] **Step 5: Verify telemetry tests and package typecheck.**
Run the Step 2 command. Expected: all pass with isolated process globals.

- [ ] **Step 6: Controller commit message:** `feat(flow-host-node): install process telemetry capture`

### Task 11: Validate configuration and load flow directories

**Files:**
- Create: `packages/flow-host-node/src/config.ts`, `packages/flow-host-node/src/flow-dirs.ts`
- Modify: `packages/flow-host-node/src/index.ts`
- Test: `packages/flow-host-node/test/config.test.ts`, `packages/flow-host-node/test/flow-dirs.test.ts`

**Interfaces:**
- Consumes: `getDataDir` from `@tejika/env`, `createValidator` from `@sozai/schema`, `FlowDefinition` from `@sozai/flow-graph`.
- Produces and exports:
```ts
type FlowConfig = {
  siblings: Record<string, { command: string; args?: Array<string>; env?: Record<string, string> }>
  flowDirs: Array<string>
  approval: { allow: Array<string> }
  tracing: { otlp?: { endpoint: string; headers?: Record<string, string> } }
  logs: { level: LogLevel }
  retention: { days: number }
}
class FlowConfigError extends Error {
  constructor(params: { path: string; issues: Array<string> })
  get path(): string
  get issues(): Array<string>
}
function loadFlowConfig(path?: string): Promise<FlowConfig>
function loadFlowDirs(dirs: Array<string>): Promise<{ files: Array<string>; flows: Array<FlowDefinition> }>
```

- [ ] **Step 1: Write failing configuration and directory tests.**
Add `returns defaults for a missing config`:
```ts
expect(await loadFlowConfig(missingPath)).toEqual({
  siblings: {}, flowDirs: [], approval: { allow: [] }, tracing: {},
  logs: { level: 'info' }, retention: { days: 30 },
})
```
Add `loads the complete config`: use sibling `system-one`, command `node`, args `['./server.mjs']`, env `{ MODE: 'test' }`, allow `['system-one:predict']`, OTLP endpoint `http://localhost:4318/v1/traces`, headers `{}`, retention `30`.
Add `names the file and every invalid field`: invalid `siblings.system-one.command`, `logs.level` and `retention.days` in one file.
Assert `FlowConfigError.path` and all issue paths. Reject top-level `predictor`, unknown fields, invalid JSON and retention `0`, `-1`, `1.5`.
Add `resolves only intended paths`: assert relative flow directories and `./worker.js`, `worker.mjs`, `../worker.cjs` resolve against config directory.
Assert `~/flows` and `~/worker.js` expand to home. Preserve absolute paths, `--inspect`, `--config=settings.js`, `https://example.com/code.js` and ordinary arguments.
Only standalone filesystem path arguments qualify, excluding flags and URI schemes. Preserve directory `~other` without pretending to expand another user's home.
Add `loads JSON files in directory order and name order`: create `b.json`, `a.json`, ignored `note.txt`, and a second directory.
Assert aligned `files` and `flows`, lowercase `*.json` only, empty directories accepted and malformed JSON errors name the file.
Assert missing directories reject. Assert graph-invalid JSON parses here and remains subject to host registration validation.

- [ ] **Step 2: Verify failure.**
Run: `../../node_modules/.bin/vitest run test/config.test.ts test/flow-dirs.test.ts`. Expect missing loaders.

- [ ] **Step 3: Implement configuration types, schema and errors.**
Validate all optional sections and their supplied fields with `@sozai/schema`, collecting every issue path.
Use allowed levels `trace`, `debug`, `info`, `warning`, `error`, `fatal`, positive integer days and top-level `additionalProperties: false`.
Merge defaults after validation. Distinguish missing files from other read errors. Wrap invalid JSON and validation errors with filename-aware `FlowConfigError`.
Resolve eligible paths with the config directory and home expansion. Keep command names, environment values and ordinary arguments unchanged.
Do not add a predictor field. Configuration takes effect on restart.

- [ ] **Step 4: Implement ordered directory loading.**
Read directories in supplied order and JSON filenames lexicographically within each directory.
Return parsed values typed as flow definitions without graph validation. Include the filename in parse failures.

- [ ] **Step 5: Verify loader tests and package typecheck.**
Run the Step 2 command. Expected: pass.

- [ ] **Step 6: Controller commit message:** `feat(flow-host-node): load flow configuration and directories`

### Task 12: Schedule non-overlapping retention passes

**Files:**
- Create: `packages/flow-host-node/src/retention.ts`
- Modify: `packages/flow-host-node/src/index.ts`
- Test: `packages/flow-host-node/test/retention.test.ts`

**Interfaces:**
- Consumes: built `pruneRuns({ runStore, taskStore, traceStore, before }): Promise<{ runs: number; skipped: number; spans: number; logs: number }>` from `@mokei/flow-host`.
- Produces and exports:
```ts
function startRetention(params: {
  runStore: RunStore
  taskStore: TaskStore
  traceStore: TraceStore
  days: number
  intervalMs?: number
}): { stop(): Promise<void> }
```

- [ ] **Step 1: Write failing scheduler tests.**
Add `starts immediately with the configured cutoff`: fake time `3000000000`, days `30`.
```ts
expect(pruneRuns).toHaveBeenCalledWith({ ...stores, before: 408000000 })
```
Add `uses an unref timer with a daily default`: assert interval `86400000`, timer unref and no early second pass.
Add `skips overlapping ticks and resumes after failures`: use interval `100`, hold first pass, advance `300`, assert one call.
Reject the first pass, assert one report, advance `100` and assert another pass.
Add `stop waits for running work and prevents future ticks`: call stop twice while held. Assert both pending until release and no later calls.

- [ ] **Step 2: Verify failure.**
Run: `../../node_modules/.bin/vitest run test/retention.test.ts`. Expect missing scheduler.

- [ ] **Step 3: Implement the scheduler.**
Start the first pass synchronously without awaiting completion. Use `Date.now() - days * 86400000` for every pass.
Keep one in-flight promise. Skip overlapping ticks. Report rejection through the capture reporter, then allow subsequent ticks.
Unref the interval. Stop clears the timer immediately and awaits any running pass. Cache the stop promise.

- [ ] **Step 4: Verify scheduler tests and package typecheck.**
Run the Step 2 command. Expected: pass.

- [ ] **Step 5: Controller commit message:** `feat(flow-host-node): schedule resumable retention passes`

### Task 13: Prove input recovery across a SQLite restart

**Files:**
- Create: `packages/flow-host-node/test/restart.test.ts`, `packages/flow-host-node/test/support/input-flow.ts`

**Interfaces:**
- Consumes: `openFlowDatabase({ path })`, three SQLite factories, `setupFlowTelemetry({ traceStore, logs: { file: false } })`.
- Consumes: `createFlowHost({ session, flows, predictor, runStore, taskStore, pollMs }): Promise<FlowHost>`, `Session` and `Predictor`.
- Produces: restart smoke coverage using public package APIs, a real temporary database and fresh stores/hosts/sessions.

- [ ] **Step 1: Write the restart smoke test first.**
Add `recovers waiting input from a reopened sqlite database`.
Define flow ID `input`, name `Input`, version `1`, start `ask`.
Use input node prompt `{ value: 'Choose' }`, object schema requiring string `value`, next `done`.
Use end node outcome `done`, output `{ answer: { ref: ['results', 'ask'] } }`.
Create a fake predictor whose `predict` throws `'Unexpected prediction'`. Use `new Session({ elicit: true })` and `pollMs: 10`.
Set up telemetry once for the entire test lifetime. Delegate its TraceStore calls to the current SQLite trace store across reopening.
Start a registered flow and wait for input. Save runID, taskID, traceID and stored traceparent.
Dispose host, then session. Read and assert persisted task remains `input_required` with `ttlMs: null`.
Close the database, reopen the same file and create fresh SQLite stores, session and host.
```ts
expect((await secondHost.get(runID))?.traceID).toBe(traceID)
expect(secondHost.inbox.list({ runID })).toHaveLength(1)
await secondHost.inbox.answer(item.id, { value: 'Ada' })
await vi.waitFor(async () => {
  expect(await secondHost.get(runID)).toMatchObject({
    state: 'completed', result: { outcome: 'done', output: { answer: { value: 'Ada' } } },
  })
})
```
Assert recovered taskID is unchanged, no second task was created and inbox is empty after completion.
Dispose second host/session, then telemetry, then close the database. Assert stored `flow.run` and `flow.run.resume` share traceID.
Assert the resumed span parents the saved traceparent and logs from a recovered inbox listener retain traceID.

- [ ] **Step 2: Run the smoke test before changing runtime code.**
Run: `../../node_modules/.bin/vitest run test/restart.test.ts`.
This integration test may already pass because preceding tasks supplied its behaviour. Do not invent a failure or unnecessary production change.
If it fails, retain the failure evidence and fix only the owning implementation files from Tasks 5, 8, 9 or 10.

- [ ] **Step 3: Complete the fixture and resolve demonstrated integration defects.**
Use a real file reopen, not reused database handles or memory stores. Keep the telemetry lifetime singular.
Close, reopen and replace the forwarding TraceStore delegate synchronously, before the next await.
The forwarding delegate sends delayed batch exports to the reopened database, without retaining the closed handle.
Keep the second database open until telemetry disposal completes. Clean temporary files in test teardown.

- [ ] **Step 4: Verify the Node package and portable regressions.**
Run in flow-host-node: `../../node_modules/.bin/vitest run` and package typecheck.
Run in flow-host: `../../node_modules/.bin/vitest run` and package typecheck. Expected: all pass.
The controller rebuilds any package changed by integration fixes before rerunning downstream tests.

- [ ] **Step 5: Controller commit message:** `test(flow-host-node): prove sqlite input recovery after restart`

### Task 14: Document the Node package and record patch release intent

**Files:**
- Create: `packages/flow-host-node/README.md`, `.changeset/flow-host-node.md`
- Modify: `docs/agents/architecture.md`

**Interfaces:**
- Consumes: public database, store, telemetry, configuration and retention signatures from `packages/flow-host-node/src/index.ts`.
- Produces: user-facing lifecycle documentation, architecture package entry and pnpm-native changeset.

- [ ] **Step 1: Check documentation requirements before writing.**
This task changes prose only. Use a content check rather than adding a permanent implementation-mirroring test.
Run from the repository root:
```sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import assert from "node:assert/strict"; const r=readFileSync("packages/flow-host-node/README.md","utf8"); for (const n of ["openFlowDatabase","createSQLiteRunStore","createSQLiteTaskStore","createSQLiteTraceStore","setupFlowTelemetry","loadFlowConfig","loadFlowDirs","startRetention"]) assert(r.includes(n)); const a=readFileSync("docs/agents/architecture.md","utf8"); assert(a.includes("flow-host-node/")); const c=readFileSync(".changeset/flow-host-node.md","utf8"); assert(c.startsWith("---\n\u0027@mokei/flow-host\u0027: patch\n\u0027@mokei/flow-host-node\u0027: patch\n---\n"));'
```
Expected before writing: missing file or assertion failure.

- [ ] **Step 2: Write the package README.**
Describe all eight public factories/loaders, JSON contracts, one-process ownership, defaults, telemetry lifetime, config-on-restart and local-only capture.
Show coherent setup with one database, three stores, telemetry, flow host and retention.
Show shutdown order: stop retention, dispose host/session, dispose telemetry, close database. Explain awaiting pending work.
Include a complete configuration example, path rules, retained live traces and the active-task pruning safeguard.
Reference persistent architecture docs only. Never link persistent docs to `docs/superpowers/`.

- [ ] **Step 3: Update the architecture package list.**
Add `flow-host-node/` beside flow-host, labelled Node-only SQLite stores, telemetry, configuration and retention.
Add its public entry points to the feature/location maps and describe portable trace storage and pruning in the flow runtime section.
Preserve existing package descriptions and protocol documentation.

- [ ] **Step 4: Write the exact patch intent.**
Use the existing `.changeset/flow-host.md` frontmatter format:
```markdown
---
'@mokei/flow-host': patch
'@mokei/flow-host-node': patch
---

Add durable SQLite flow stores, per-run span and log capture, flow configuration and retention in `@mokei/flow-host-node`. Align portable store contracts, isolate run traces and expose trace capture and pruning in `@mokei/flow-host`.
```
Do not list context-server or bump package versions manually. The fixed release group handles lockstep propagation.

- [ ] **Step 5: Verify documentation and final integration.**
Run the Step 1 content check. Expected: exit 0.
Run `../../node_modules/.bin/vitest run` and package typecheck from both flow packages. Expected: all pass.
The controller runs repository lint/build/test and `pnpm change status`. Confirm the new package joins the fixed release plan.

- [ ] **Step 6: Controller commit message:** `docs(flow-host-node): document lifecycle and record release intent`
