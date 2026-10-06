# flow-host-node on hozon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@mokei/flow-host-node`'s hand-rolled SQLite layer with hozon stores opened through `@tejika/db`'s `openLocalDatabase`.

**Architecture:** Runs and tasks become hozon store definitions (`mokei-flow-runs`, `mokei-flow-tasks`) written with Kysely. Spans and logs move to `@hozon/store-telemetry` and `@hozon/store-log`. A `TraceStore` facade over those two stores keeps `@mokei/flow-host`'s contract. Telemetry writes through `@hozon/otel`'s exporter and `@hozon/logtape`'s sink. One `openFlowDatabase` helper opens `flow.db` in mokei's data dir with all four stores registered and migrated.

**Tech Stack:** TypeScript, Kysely 0.29, hozon 0.1 (`@hozon/db`, `@hozon/adapter`, `@hozon/store-log`, `@hozon/store-telemetry`, `@hozon/otel`, `@hozon/logtape`), `@tejika/db` 0.1, node:sqlite, vitest, pnpm 12 workspace catalogs.

**Spec:** `/Users/paul/dev/yulsi/kigu/docs/superpowers/specs/2026-10-06-hozon-design.md` (section "mokei `flow-host-node`", implementation order step 3).

## Global Constraints

- No legacy handling: mokei's SQLite database has not shipped, so hozon's schema is its first. No migration from `mokei.db`, no reading the old `runs`/`tasks`/`spans`/`logs` tables.
- The default file is `flow.db` in mokei's data dir: `openLocalDatabase({ app: 'mokei', name: 'flow', stores })`. `--database-path` (`FlowServiceParams.databasePath`) still overrides.
- Store names and tables: `mokei-flow-runs` → table `mokei_flow_runs`; `mokei-flow-tasks` → table `mokei_flow_tasks`. The default `tablePrefix` (`hozon`) is kept.
- Port the current semantics exactly. Insert `ON CONFLICT DO NOTHING` → conflict error. Revision-guarded `UPDATE … WHERE revision = ?`. JSON `data` plus indexed columns. Same indexes.
- `deleteTraces` and `deleteBefore` run inside `db.withTransaction(async (tx) => …)`, getting both stores from `tx`.
- Sink options: `tracedOnly: true`, `excludeCategories: [['mokei', 'flow-host', 'capture']]`.
- New catalog entries are pinned in `pnpm-workspace.yaml` (`catalogMode: manual`). Add `'@hozon/*'` to `minimumReleaseAgeExclude`.
- Release intents are `patch` (every existing mokei intent is patch, and the user asked for patch bumps in this stack). The `fixed` versioning group moves all published packages together.
- Run repo scripts as `rtk proxy pnpm run <script>`; grep is shimmed (use `rg`); no `sed -i`.
- Never stage the user's uncommitted root `package.json` / `pnpm-lock.yaml` `packageManager` bump unless a task's own install changes the lockfile. In that case stage `pnpm-lock.yaml` and say so in the report.

## Rulings made while planning

- **`@mokei/flow-host`'s own `createTraceStoreSpanExporter` / `createTraceStoreLogSink` stay unchanged** (spec left this open). They are published API, tested in `flow-host`, and serve the in-memory `TraceStore` path. `flow-host-node` simply stops importing them. Cost if wrong: one follow-up deprecation.
- **Public API of `flow-host-node` after the change:**
  - Added: `openFlowDatabase`, `flowStoreDefinitions`, `runStoreDefinition`, `taskStoreDefinition`, `FLOW_RUN_STORE`, `FLOW_TASK_STORE`, `getFlowRunStore`, `getFlowTaskStore`, `createFlowTraceStore`.
  - Removed: `createSQLiteRunStore`, `createSQLiteTaskStore`, `createSQLiteTraceStore`.
  - `openFlowDatabase` keeps its name but becomes async and returns `HozonDB`.
- **`setupFlowTelemetry` takes `{ logStore, telemetryStore, otlp?, logs? }`** instead of `{ traceStore }`. The hozon exporter and sink are typed against those stores.
- **Integration-test driver reads the database with raw read-only SQL**, never by opening it through hozon. It keeps the driver's "never migrates or writes" property.

## Review Focus

1. **Hyphenated store names in migration table names.** `hozon_mokei-flow-runs_migration` must create, reopen and migrate cleanly on a real file, not only `:memory:`. Pinned by Task 2's "reopens a file database without re-running migrations".
2. **`MOKEI_DATABASE_PATH` env override.** It is now honoured through `getDatabasePath`, while an explicit `path` must still win over it. Pinned by Task 2's default-path tests.
3. **Cross-store rollback.** When the second delete in `deleteTraces` / `deleteBefore` fails, the first must be rolled back. Pinned by Task 2's trigger-based rollback test.
4. **Storage failures during telemetry.** A failing `addLogs` / `addSpans` must be reported on the console `errors` sink and must never be captured back into the log store (no feedback loop). Pinned by Task 4's "reports a log store failure on the errors sink without capturing it".
5. **Shutdown ordering.** Telemetry is disposed before the database closes, so no span or log write lands on a closed `HozonDB` (`HozonDBClosedError`). Pinned by the retained `service.test.ts` ordering tests and the CLI `daemon-shutdown` test (Task 3), re-run after the telemetry switch (Task 4).

---

### Task 1: Dependencies and run/task store definitions

**Files:**
- Modify: `pnpm-workspace.yaml`. Catalog: `'@hozon/adapter'`, `'@hozon/db'`, `'@hozon/logtape'`, `'@hozon/otel'`, `'@hozon/store-log'`, `'@hozon/store-telemetry'` at `^0.1.0`; `'@tejika/db': ^0.1.0`; `'@tejika/env': ^0.5.3`; `kysely: ^0.29.6`. Add `'@hozon/*'` to `minimumReleaseAgeExclude`.
- Modify: `packages/flow-host-node/package.json`. Add every catalog entry above (`catalog:`) to `dependencies`.
- Create: `packages/flow-host-node/src/run-store.ts`, `packages/flow-host-node/src/task-store.ts`
- Modify: `packages/flow-host-node/src/index.ts` (add new exports; keep old ones until Task 4)
- Modify: `packages/flow-host-node/test/contracts/run-store.ts`, `test/contracts/task-store.ts`, `test/contracts/trace-store.ts`. `create` becomes `() => T | Promise<T>`, and every `const store = create()` becomes `await create()`.
- Modify: `packages/flow-host-node/test/store-contracts.test.ts`

**Interfaces:**
- Produces, in `src/run-store.ts`:
  - `FLOW_RUN_STORE = 'mokei-flow-runs'`
  - `type FlowRunTables = { mokei_flow_runs: { seq: Generated<number>; run_id: string; state: string; revision: number; created_at: number; updated_at: number; trace_id: string | null; task_id: string | null; data: ColumnType<RunRecord, unknown, unknown> } }`
  - `runStoreDefinition: StoreDefinition<FlowRunTables, RunStore>`
  - `getFlowRunStore(provider: StoreProvider): Promise<RunStore>`
- Produces, in `src/task-store.ts`:
  - `FLOW_TASK_STORE = 'mokei-flow-tasks'`
  - `type FlowTaskTables = { mokei_flow_tasks: { seq; task_id; status; revision; data } }`
  - `taskStoreDefinition: StoreDefinition<FlowTaskTables, TaskStore>`
  - `getFlowTaskStore(provider: StoreProvider): Promise<TaskStore>`
- Pattern to follow: `/Users/paul/dev/yulsi/hozon/packages/store-telemetry/src/{definition,migrations,tables,api}.ts`. Migrations are a `(ctx: MigrationContext) => Record<string, Migration>` with key `'0-init'`. `seq` is `ctx.types.serial` primary key, `autoIncrement()` on sqlite. `data` is `ctx.types.json`, written with `adapter.encodeJSON(record)`.
- Schema, ported from the deleted `src/migrations.ts`:
  - `mokei_flow_runs`:
    - columns: `run_id` text not null unique, `state` text not null, `revision` `'integer'` not null, `created_at`/`updated_at` `ctx.types.bigint` not null, `trace_id`/`task_id` text nullable, `data` json not null;
    - indexes: `mokei_flow_runs_state (state, updated_at)`, `mokei_flow_runs_created (created_at desc, seq)`.
  - `mokei_flow_tasks`:
    - columns: `task_id` text not null unique, `status` text not null, `revision` `'integer'` not null, `data` json not null;
    - index: `mokei_flow_tasks_status (status, seq)`.

- [ ] **Step 1: Install dependencies.** Edit the catalog and package.json, then run `pnpm install`. Expected: lockfile updated, no peer warnings for `@opentelemetry/*`.
- [ ] **Step 2: Point the run/task contracts at hozon (failing).** In `store-contracts.test.ts`, add `runStoreContract('hozon runs', …)` and `taskStoreContract('hozon tasks', …)`. Each factory runs `openLocalDatabase({ app: 'mokei', path: ':memory:', stores: [runStoreDefinition] })` (or `taskStoreDefinition`), pushes the db to a list closed in `afterEach`, and returns the getter's result. Keep the memory and old SQLite rows for now.
- [ ] **Step 3: Run** `rtk proxy pnpm --filter @mokei/flow-host-node exec vitest run test/store-contracts.test.ts`. Expected: FAIL (modules not found).
- [ ] **Step 4: Implement `run-store.ts` and `task-store.ts`**, porting `sqlite-run-store.ts` / `sqlite-task-store.ts` behaviour exactly:
  - Error messages must match verbatim: `Run already exists: <id>` as a `RunStoreConflictError`; `Task already exists: <id>` as a plain `Error`; `Run not found: <id>`; `Task not found: <id>`.
  - Read the record, check the revision, then run the guarded update. Zero updated rows → conflict error.
  - The data round-trips through `JSON.parse(JSON.stringify(...))` before writing, as today.
  - `list` validation and ordering: `RangeError('Run list limit must be a non-negative integer')`; empty `states` or `limit === 0` → `[]`; `ORDER BY created_at DESC, seq ASC`; limit clamped to `Number.MAX_SAFE_INTEGER`.
  - Task `list`: empty `status` → `[]`, ordered by `seq`.
- [ ] **Step 5: Run the contracts again.** Expected: PASS for memory, SQLite and hozon rows. Then run `rtk proxy pnpm --filter @mokei/flow-host-node run test:types`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(flow-host-node): add hozon run and task store definitions`.

### Task 2: Trace store facade and `openFlowDatabase`

**Files:**
- Create: `packages/flow-host-node/src/trace-store.ts`, `packages/flow-host-node/src/stores.ts`
- Modify: `packages/flow-host-node/test/store-contracts.test.ts` (add the `hozon traces` row, plus the rollback test in a new `describe`)
- Rewrite: `packages/flow-host-node/test/database.test.ts`

**Interfaces:**
- Consumes: Task 1 definitions and getters.
- Produces, in `src/trace-store.ts`: `createFlowTraceStore(provider: StoreProvider): TraceStore`.
  - `addSpans` / `addLogs` / `getTrace` use `getTelemetryStore(provider)` / `getLogStore(provider)`. `getTrace` returns `{ spans: getSpans(id), logs: (await getTraceLogs(id)).filter(isTracedLog) }`.
  - `deleteTraces(ids)`:
    - empty → `{ spans: 0, logs: 0 }`;
    - otherwise `provider.withTransaction(async (tx) => …)`: spans `deleteByTrace` first, then logs.
  - `deleteBefore(time, keep)`: same transaction shape, using `deleteBefore(time, { keepTraceIDs: keep })` on each store.
- Produces, in `src/stores.ts`:
  - `flowStoreDefinitions` = `[runStoreDefinition, taskStoreDefinition, telemetryStoreDefinition, logStoreDefinition]`;
  - `openFlowDatabase(params: { path?: string }): Promise<HozonDB>`, which returns `openLocalDatabase({ app: 'mokei', name: 'flow', path: params.path, stores: flowStoreDefinitions })`.
- Type note: mokei's `StoredSpan` / `StoredLog` (`@mokei/host-protocol`) must be assignable to hozon's types. If one is not, convert at the facade boundary and record why in the report. Do not cast to `any`.

- [ ] **Step 1: Write failing tests.**
  - `store-contracts.test.ts`: add `traceStoreContract('hozon traces', async () => createFlowTraceStore(await open()))`, where `open()` is `openFlowDatabase({ path: ':memory:' })` tracked for `afterEach` close.
  - Rollback test `rolls back span deletion when log deletion fails`, on a temp-file database (spans first, then logs):
    - open with `openFlowDatabase({ path })`;
    - add one span and one log for `trace-one`;
    - with a separate `new DatabaseSync(path)`, `CREATE TRIGGER fail_log_delete BEFORE DELETE ON hozon_logs BEGIN SELECT RAISE(ABORT, 'log delete failed'); END`, then close it;
    - `await expect(store.deleteTraces(['trace-one'])).rejects.toThrow('log delete failed')`;
    - `expect((await store.getTrace('trace-one')).spans).toHaveLength(1)`.
    - Repeat the assertion for `deleteBefore(Number.MAX_SAFE_INTEGER, [])`.
  - `database.test.ts` (replace the whole file). Use `vi.stubEnv` for env vars and `vi.unstubAllEnvs()` in `afterEach`; do not `vi.mock('@tejika/env')`.
    - `creates parent directories and registers every flow store`: path `<tmp>/nested/flow.db`. Tables include `mokei_flow_runs`, `mokei_flow_tasks`, `hozon_spans`, `hozon_logs`. Indexes include `mokei_flow_runs_state`, `mokei_flow_runs_created`, `mokei_flow_tasks_status`. `PRAGMA journal_mode` is `wal`. Inspect with a separate read-only `DatabaseSync` after `db.close()`.
    - `uses flow.db in the mokei data directory by default`: with `MOKEI_DATA_DIR=<tmp>`, `openFlowDatabase({})` creates `<tmp>/flow.db`.
    - `honours MOKEI_DATABASE_PATH and lets an explicit path win`: env `MOKEI_DATABASE_PATH=<tmp>/env.db`. `{}` creates `env.db`. `{ path: <tmp>/explicit.db }` creates `explicit.db` and not a second `env.db` write.
    - `reopens a file database without re-running migrations`: open, create a run, close, reopen, `get` returns it.
    - `rejects a database whose schema is newer than supported`: open and close, then insert a row `('9-future', <iso timestamp>)` into `"hozon_mokei-flow-runs_migration"` via `DatabaseSync`. Reopening rejects with `SchemaVersionError` (from `@hozon/db`).
    - `supports an in-memory database`: `:memory:` opens and closes, and creates no file.
- [ ] **Step 2: Run** `rtk proxy pnpm --filter @mokei/flow-host-node exec vitest run test/store-contracts.test.ts test/database.test.ts`. Expected: FAIL (missing modules).
- [ ] **Step 3: Implement `trace-store.ts` and `stores.ts`.** Do not touch `index.ts`: it still exports the old sync `openFlowDatabase` from `./database.js` until Task 3 switches it over. Tests in this task import from `../src/stores.js` and `../src/trace-store.js` directly.
- [ ] **Step 4: Run** the same tests. Expected: PASS. Run `test:types`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(flow-host-node): add hozon trace store facade and openFlowDatabase`.

### Task 3: Service adoption, old storage removal, callers

**Files:**
- Modify: `packages/flow-host-node/src/service.ts`, `src/index.ts` (export Task 1–2 symbols; drop the removed ones)
- Delete: `src/database.ts`, `src/migrations.ts`, `src/transaction.ts`, `src/sqlite-run-store.ts`, `src/sqlite-task-store.ts`, `src/sqlite-trace-store.ts`
- Modify: `test/service.test.ts`, `test/restart.test.ts`, `test/persistence.test.ts`, `test/handlers.test.ts` (only if it imports removed exports), `test/store-contracts.test.ts` (drop the old `SQLite …` rows)
- Modify: `packages/cli/test/daemon-shutdown.test.ts` and `packages/cli/src/daemon-entry.ts` (only if they touch removed exports)
- Modify: `integration-tests/support/flow-daemon/driver.ts`, plus any `integration-tests/dts-consumer` / `scripts/check-packed-consumer.mjs` reference to removed exports

**Interfaces:**
- Consumes: Tasks 1–2. Telemetry keeps its current `{ traceStore }` signature in this task; pass it the `createFlowTraceStore(database)` facade (Task 4 switches telemetry).
- `FlowServiceDependencies.openDatabase: typeof openFlowDatabase` (now `(params: { path?: string }) => Promise<HozonDB>`). In `initialize`:
  - `database = await dependencies.openDatabase({ path: params.databasePath })`;
  - then `runStore = await getFlowRunStore(database)`, `taskStore = await getFlowTaskStore(database)`, `traceStore = createFlowTraceStore(database)`;
  - then `setupTelemetry({ logStore: await getLogStore(database), telemetryStore: await getTelemetryStore(database), otlp, logs })`.
  - Keep the `if (stopping) return` check right after the await.
  - Cleanup still ends with `database?.close()`.

- [ ] **Step 1: Update tests (failing).**
  - `service.test.ts`'s fake `openDatabase` becomes async. It wraps the real `openFlowDatabase({ path: ':memory:' })` and records `'database'` in `order` when `close` is called (`vi.spyOn(db, 'close')` or a wrapper). All existing ordering expectations stay as written.
  - Add `stops before opening telemetry when disposed while the database opens`: `openDatabase` resolves only after `service.dispose()` is called. Assert `setupTelemetry` was never called and the opened database was closed.
  - `restart.test.ts` and `persistence.test.ts` use `openFlowDatabase({ path })` (awaited), the getters and `createFlowTraceStore`. Their forwarding telemetry wrapper keeps forwarding the trace store. Assertions stay unchanged.
  - Drop the `SQLite …` contract rows.
- [ ] **Step 2: Run** `rtk proxy pnpm --filter @mokei/flow-host-node exec vitest run`. Expected: FAIL in service/restart/persistence.
- [ ] **Step 3: Implement `service.ts`, delete the six files, and drop their exports from `index.ts`.** Then fix the CLI and integration callers:
  - Driver `readDatabase()` keeps its read-only `DatabaseSync` transaction and selects `data` from `mokei_flow_runs` / `mokei_flow_tasks` ordered by `seq`.
  - `readTrace(id)` uses the same read-only connection: spans `SELECT data FROM hozon_spans WHERE trace_id = ? ORDER BY start_time, seq`; logs `SELECT data FROM hozon_logs WHERE trace_id = ? ORDER BY timestamp, seq`, JSON-parsed.
  - The driver file name stays `flows.db` (explicit path).
- [ ] **Step 4: Verify.**
  - `rtk proxy pnpm run build` passes.
  - `rtk proxy pnpm run test` passes. It is unit-only, so it includes `packages/cli`.
  - `rtk proxy pnpm run lint` passes.
  - `rg -n "createSQLite(Run|Task|Trace)Store|sqlite-(run|task|trace)-store|migrations\.js|transaction\.js" packages integration-tests scripts -g '!**/lib/**' -g '!**/node_modules/**' -g '!**/CHANGELOG.md'` returns nothing.
  - Run the flow integration suites the repo's CI runs (`integration-tests`, as in `.github/workflows`). Expected: PASS.
- [ ] **Step 5: Commit** `refactor(flow-host-node): run the flow service on hozon and drop the hand-rolled SQLite layer`.

### Task 4: Telemetry on `@hozon/otel` and `@hozon/logtape`

**Files:**
- Modify: `packages/flow-host-node/src/telemetry.ts`, `src/service.ts` (call site: `setupTelemetry({ logStore: await getLogStore(database), telemetryStore: await getTelemetryStore(database), otlp, logs })`)
- Modify: `test/restart.test.ts`, `test/persistence.test.ts` (forwarding wrapper forwards `logStore` / `telemetryStore`), `test/service.test.ts` if its fake `setupTelemetry` asserts params
- Create: `packages/flow-host-node/test/support/stores.ts`
- Modify: `test/telemetry.test.ts`, `test/telemetry-failures.test.ts`, `test/telemetry-drain.test.ts`, `test/telemetry-otlp.test.ts`, `test/telemetry-registration.test.ts`

**Interfaces:**
- Consumes: `openFlowDatabase`, `createFlowTraceStore` (Task 2); service wiring (Task 3).
- Produces: `setupFlowTelemetry(params: { logStore: LogStore; telemetryStore: TelemetryStore; otlp?: { endpoint: string; headers?: Record<string, string> }; logs?: { level?: LogLevel; file?: boolean } }): { dispose(): Promise<void> }`.
- Produces, in `test/support/stores.ts`: `openTestStores(): Promise<{ db: HozonDB; logStore: LogStore; telemetryStore: TelemetryStore; traceStore: TraceStore }>`, backed by `openFlowDatabase({ path: ':memory:' })`. Callers close `db`.

- [ ] **Step 1: Update the tests to the new signature (failing).**
  - Replace every `setupFlowTelemetry({ traceStore: … })` with `{ logStore, telemetryStore }` from `openTestStores()`.
  - Assertions that read captured data keep reading through `traceStore.getTrace`.
  - Tests that spy on failures replace `createTraceStoreLogSink` / `createTraceStoreSpanExporter` mocks with `vi.mock('@hozon/logtape')` / `vi.mock('@hozon/otel')` equivalents.
  - Add `reports a log store failure on the errors sink without capturing it` to `telemetry-failures.test.ts`:
    - pass a `logStore` whose `addLogs` rejects with `new Error('log write failed')`;
    - log one record inside an active span;
    - await `dispose()`;
    - assert the console errors sink received a record whose rendered message contains `Failed to store log batch`;
    - assert `addLogs` was never called with a record in category `['hozon', 'logtape']`.
- [ ] **Step 2: Run** `rtk proxy pnpm --filter @mokei/flow-host-node exec vitest run test/telemetry*.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Swap the local exporter to `createTelemetrySpanExporter(params.telemetryStore)` and the sink to `createLogStoreSink(params.logStore, { tracedOnly: true, excludeCategories: [['mokei', 'flow-host', 'capture']] })`.
  - Add the logger entry `{ category: ['hozon'], lowestLevel: 'error', sinks: ['errors'] }` beside the existing `['mokei', 'flow-host', 'capture']` entry.
  - Keep everything else (registration guards, rollback, dispose order) unchanged.
- [ ] **Step 4: Run** `rtk proxy pnpm run build`, `rtk proxy pnpm run test`, `rtk proxy pnpm run lint`, and the flow integration suites. Expected: PASS.
- [ ] **Step 5: Commit** `feat(flow-host-node): capture telemetry through hozon exporter and sink`.

### Task 5: Docs and release intent

**Files:**
- Modify: `packages/flow-host-node/README.md`:
  - API table: `openFlowDatabase`, the getters, `createFlowTraceStore`, `flowStoreDefinitions`;
  - default path is `flow.db` via `getDatabasePath('mokei', 'flow')`, `MOKEI_DATABASE_PATH` override, `:memory:`;
  - the example at lines ~150–175 rewritten for the async API.
- Modify: `docs/agents/architecture.md`: rows at ~222 and ~301; the paragraph at ~343 says the stores are hozon stores in one `HozonDB` owned by one process.
- Create: `.changeset/flow-host-hozon.md` with front matter `'@mokei/flow-host-node': patch`. Body: "Store flow runs, tasks, spans and logs through hozon in `flow.db`; `openFlowDatabase` is now async and returns a `HozonDB`, and the `createSQLite*Store` helpers are replaced by hozon store definitions and getters."

- [ ] **Step 1: Edit the docs.** Then run `rg -n "mokei\.db|createSQLite|\{ db, close \}" packages/flow-host-node/README.md docs/agents/architecture.md`. Expected: nothing.
- [ ] **Step 2: Run** `pnpm change status`. Expected: the new intent is listed, with a patch for the fixed group.
- [ ] **Step 3: Commit** `docs(flow-host-node): document hozon storage` (README, architecture, changeset).

## Release (only on the user's approval, after merge)

1. `pnpm change status`, then `pnpm version -r`. Commit versions, changelogs and ledger.
2. The user publishes (`pnpm run release`), as for hozon and tejika.
