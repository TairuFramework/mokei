# mokei app-node (single database, daemon-owned telemetry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give mokei one database (`mokei.db`) and one telemetry installation owned by the daemon, configured from a new generic `mokei.json`. Flows contribute their stores to that database instead of owning it.

**Architecture:** A new package, `@mokei/app-node`, provides:
- `loadMokeiConfig`, which reads `mokei.json` with its `logs` and `tracing` sections;
- `openMokeiDatabase`, which always registers the hozon log and telemetry stores and accepts extra store definitions;
- `setupMokeiTelemetry`, moved from flow-host-node.

The CLI daemon loads `mokei.json`, then opens the database with `flowStoreDefinitions`, then installs telemetry, and only then creates the flow service. The flow service receives the database as a `StoreProvider`. It no longer opens or closes the database and no longer installs telemetry. On shutdown, the daemon disposes in reverse order.

**Tech Stack:** TypeScript, hozon 0.1, `@tejika/db` 0.1, `@tejika/env`, `@sozai/schema`, logtape, OpenTelemetry, vitest, pnpm 12 catalogs.

**Spec:** `/Users/paul/dev/yulsi/kigu/docs/superpowers/specs/2026-10-06-hozon-design.md` (section "mokei `flow-host-node`"). The user's decisions in this session:
- logs and traces are independent of flows, so the database and telemetry move out of flow-host-node;
- a new generic `mokei.json` replaces the `tracing`/`logs` sections of `flows.json`;
- the work lands on the same PR (#76, branch `feat/hozon`).

The predecessor plan is `docs/superpowers/plans/2026-10-06-flow-host-hozon.md`, already executed on this branch.

## Global Constraints

- One database per app. The default is `getDatabasePath('mokei')` (`mokei.db` in mokei's data dir): call `openLocalDatabase({ app: 'mokei', path, stores })` with no `name`. `MOKEI_DATABASE_PATH` overrides the default, an explicit path wins over both, and `:memory:` is supported.
- `flows.json` and the flow-host-node SQLite layer have never shipped (`mokei@0.14.0` on npm does not depend on `@mokei/flow-host-node`). There is no compatibility code for the moved `tracing`/`logs` keys or for `flow.db`.
- Store names and tables are unchanged: `mokei-flow-runs`/`mokei_flow_runs` and `mokei-flow-tasks`/`mokei_flow_tasks`, plus hozon's `hozon_logs`/`hozon_spans`.
- Telemetry behaviour is unchanged apart from the category parameter:
  - the sink is created with `tracedOnly: true`;
  - storage failures are reported on the console `errors` sink and never captured;
  - the dispose order is unchanged.
- The new package joins the `versioning.fixed` group in `pnpm-workspace.yaml`, and its version is `0.14.0` like its siblings.
- Release intents are `patch`.
- Run repo scripts as `rtk proxy pnpm run <script>`. Use `rg` (grep is shimmed). Never use `sed -i`.
- In prose, say "Kigu stack", never "TairuFramework".

## Rulings made while planning

- **Tasks 2 and 3 are one dispatch and one commit.** The pre-commit hook runs `turbo run test:types` over every package, and Task 2 alone breaks `packages/cli`.

- **Package name: `@mokei/app-node`.** It holds the node app foundation (config, database, telemetry), not just stores. The user may rename it at plan review.
- **Telemetry report categories become a parameter.** `setupMokeiTelemetry({ …, reportCategories })` routes each category to `errors` at `error` level and excludes it from the log store. The `['hozon']` route stays built in. flow-host-node exports `FLOW_REPORT_CATEGORY = ['mokei', 'flow-host', 'capture']` and the daemon passes it. Existing reporter call sites keep their category.
- **CLI flag names:**
  - `--config-path` / `configPath` now points at `mokei.json`, matching `MOKEI_CONFIG_PATH`;
  - `flows.json` moves to a new `--flows-config-path` / `flowsConfigPath`. The daemon passes it to `createFlowService({ configPath })`, whose own param name is unchanged;
  - the daemon flags have never shipped, so the rename needs no compatibility code;
  - `--database-path` / `databasePath` moves to the daemon.
- **A bad `mokei.json` fails daemon boot** with `MokeiConfigError`, whose message names the path and the issues. A bad `flows.json` still only fails the flow service (`status: failed`), and the daemon stays up with telemetry installed.
- **`mokei.json` schema:** `{ logs?: { level?: LogLevel; file?: boolean }, tracing?: { otlp?: { endpoint: string; headers?: Record<string, string> } } }`, with `additionalProperties: false` at every level. Defaults are `{ logs: { level: 'info', file: true }, tracing: {} }`. A missing file yields the defaults.
- **flow-host-node keeps** `flowStoreDefinitions` (now runs and tasks only), the getters, `createFlowTraceStore` and retention. It loses `openFlowDatabase`, `setupFlowTelemetry` and the `tracing`/`logs` sections of `FlowConfig`.

## Review Focus

1. **Bad `mokei.json`.** Invalid JSON or an unknown key must reject daemon boot with `MokeiConfigError` before any database file is created. Pinned by Task 3's "rejects an invalid mokei.json before opening the database".
2. **Daemon shutdown order.** The flow service is disposed, then telemetry, then the database is closed, so no write lands on a closed `HozonDB`. Pinned by Task 3's `daemon-shutdown.test.ts`.
3. **Partial boot cleanup.** If telemetry setup or `serveHostDaemon` throws, everything acquired so far is released in reverse order and the original error propagates. Pinned by Task 3's "releases the database when telemetry setup fails" and the existing boot-failure test.
4. **Telemetry independent of flows.** With an invalid `flows.json`, the daemon still boots, the flow status is `failed`, and spans and logs are still stored in `mokei.db`. Pinned by Task 3's "captures telemetry while the flow service is failed".
5. **Moved `flows.json` keys.** A `flows.json` that still has `tracing` or `logs` gets a `FlowConfigError` whose sanitized issue names the key (`tracing` / `logs`), not `*`. Pinned by Task 2's config test.

---

### Task 1: `@mokei/app-node` package

**Files:**
- Create the package skeleton in `packages/app-node/`: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `LICENSE`, `README.md`. Copy the shape of `packages/flow-host-node`: scripts, exports, `files`, version `0.14.0`, description "Mokei Node app foundation: configuration, database and telemetry".
- Create `packages/app-node/src/config.ts`, `src/database.ts`, `src/telemetry.ts` and `src/index.ts`.
- Move these tests into `packages/app-node/test/`, adapting them to the new API:
  - from `packages/flow-host-node/test/`: `telemetry.test.ts`, `telemetry-failures.test.ts`, `telemetry-drain.test.ts`, `telemetry-otlp.test.ts`, `telemetry-registration.test.ts`;
  - `support/stores.ts`.
- The flow-host-node originals stay in place until Task 2 deletes them. The move is a copy now and a delete in Task 2.
- Create `packages/app-node/test/config.test.ts` and `test/database.test.ts`. Port the env and path cases from `packages/flow-host-node/test/database.test.ts`.
- Modify `pnpm-workspace.yaml`: add `'@mokei/app-node'` to `versioning.fixed`, in alphabetical order.

**Interfaces:**
- **Produces, from `@mokei/app-node`:**
  - `type MokeiConfig = { logs: { level: LogLevel; file: boolean }; tracing: { otlp?: { endpoint: string; headers?: Record<string, string> } } }`
  - `class MokeiConfigError extends Error`, with `name: 'MokeiConfigError'`, getters `path` and `issues: Array<string>`, and message `Invalid mokei configuration <path>: <issues joined by ', '>`
  - `getMokeiConfigPath(): string`, which returns `getAppEnvVar('mokei', 'CONFIG_PATH') ?? join(getDataDir('mokei'), 'mokei.json')`
  - `loadMokeiConfig(path = getMokeiConfigPath()): Promise<MokeiConfig>`. Precedence: explicit path, then `MOKEI_CONFIG_PATH`, then the data dir.
  - `mokeiStoreDefinitions = [logStoreDefinition, telemetryStoreDefinition]`
  - `openMokeiDatabase(params?: { path?: string; stores?: ReadonlyArray<StoreDefinition<any, any>> }): Promise<HozonDB>`. It registers `[...mokeiStoreDefinitions, ...stores]`; match the element type `openLocalDatabase` accepts.
  - `setupMokeiTelemetry(params: { logStore: LogStore; telemetryStore: TelemetryStore; otlp?: …; logs?: { level?: LogLevel; file?: boolean }; reportCategories?: ReadonlyArray<ReadonlyArray<string>> }): { dispose(): Promise<void> }`
- **Pattern:**
  - `loadMokeiConfig` follows `packages/flow-host-node/src/config.ts`: `readJSONFile` with defaults, a `SyntaxError` wrapped as the issue `JSON: <message>`, a `@sozai/schema` validator, and an issue path built the same way.
  - `setupMokeiTelemetry` is `packages/flow-host-node/src/telemetry.ts` verbatim, except that the hardcoded `['mokei', 'flow-host', 'capture']` (sink `excludeCategories` and logger route) becomes `reportCategories` (default `[]`), and the dispose error message is `'Failed to dispose mokei telemetry'`.
- **Dependencies:** move telemetry's runtime deps from flow-host-node's `package.json`:
  - `@hozon/*`, `@tejika/db`, `@tejika/env`, `@tejika/log`;
  - `@logtape/logtape`, `@opentelemetry/*`;
  - `@sozai/async`, `@sozai/log`, `@sozai/schema`.
  Add only what `src` imports.

- [ ] **Step 1: Scaffold the package and run `pnpm install`.** Expected: the lockfile gains the `packages/app-node` importer.
- [ ] **Step 2: Write the failing tests.**
  - `config.test.ts`:
    - `honours MOKEI_CONFIG_PATH and lets an explicit path win`: `vi.stubEnv('MOKEI_CONFIG_PATH', <tmp>/env.json)` with `{ logs: { level: 'debug' } }`. `loadMokeiConfig()` reads it. `loadMokeiConfig(<tmp>/explicit.json)` reads the explicit file;
    - `returns defaults when mokei.json is missing`: equals `{ logs: { level: 'info', file: true }, tracing: {} }`;
    - `reads logs and tracing`: `{ logs: { level: 'debug', file: false }, tracing: { otlp: { endpoint: 'http://x' } } }` round-trips;
    - `rejects unknown keys`: `{ flowDirs: [] }` rejects with `MokeiConfigError`, and `issues` contains `'flowDirs'`;
    - `rejects invalid JSON`: `issues[0]` starts with `'JSON:'`, and `cause` is a `SyntaxError`.
  - `database.test.ts`:
    - `uses mokei.db in the mokei data directory by default` (`vi.stubEnv('MOKEI_DATA_DIR', tmp)`);
    - `honours MOKEI_DATABASE_PATH and lets an explicit path win`;
    - `registers log and telemetry stores and extra stores`: pass a tiny test `StoreDefinition` with table `test_items`; after `close()`, a read-only `DatabaseSync` shows `hozon_logs`, `hozon_spans` and `test_items`;
    - `supports an in-memory database`.
  - Telemetry tests:
    - `@mokei/app-node` must not depend on any `@mokei/flow-*` package: flow-host-node devDepends on it, so that would be a cycle. `test/support/stores.ts` therefore returns `{ db, logStore, telemetryStore }` from `openMokeiDatabase({ path: ':memory:' })`. Assertions that read through `traceStore.getTrace(id)` now read `telemetryStore.getSpans(id)` and `logStore.getTraceLogs(id)` instead;
    - copied tests call `setupMokeiTelemetry`, and the ones that exercised the capture-category exclusion pass `reportCategories: [['mokei', 'flow-host', 'capture']]`;
    - add `routes report categories to the errors sink without storing them`: a record logged under `['test', 'report']` with `reportCategories: [['test', 'report']]` reaches the console errors sink and never reaches `addLogs`.
- [ ] **Step 3: Run** `rtk proxy pnpm --filter @mokei/app-node exec vitest run`. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** `config.ts`, `database.ts`, `telemetry.ts` and `index.ts`.
- [ ] **Step 5: Run** the package's `vitest run`, `test:types` and `build`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(app-node): add mokei config, database and telemetry package`.

### Task 2: flow-host-node consumes a provided database

**Files:**
- Modify:
  - `packages/flow-host-node/src/service.ts`
  - `src/config.ts`
  - `src/stores.ts` (keep only `flowStoreDefinitions = [runStoreDefinition, taskStoreDefinition]`)
  - `src/index.ts`
  - `package.json` (drop deps only telemetry used; add `@mokei/app-node` as a devDependency for tests)
- Delete:
  - `src/telemetry.ts`
  - the five `test/telemetry*.test.ts` files
  - `test/support/stores.ts`, if nothing else uses it
  - `test/database.test.ts`: its file-level cases now live in app-node. First move the flow-specific cases into `store-contracts.test.ts` or a new `test/flow-stores.test.ts`: "reopens a file database without re-running migrations", "rejects a database whose schema is newer than supported" (table `"hozon_mokei-flow-runs_migration"`), and the rollback test if it lives there.
- Modify tests: `service.test.ts`, `restart.test.ts`, `persistence.test.ts`, `store-contracts.test.ts`, `config.test.ts`. They open the database with `openMokeiDatabase({ path, stores: flowStoreDefinitions })` from `@mokei/app-node`.

**Interfaces:**
- Consumes Task 1: `openMokeiDatabase`, `setupMokeiTelemetry` (tests only).
- **Produces:**
  - `FlowServiceParams` drops `databasePath` and gains `database: StoreProvider` (from `@hozon/db`).
  - `FlowServiceDependencies` drops `openDatabase` and `setupTelemetry`.
  - `initialize` gets the stores from `params.database`. Its cleanup no longer disposes telemetry or closes the database.
  - `FLOW_REPORT_CATEGORY: ReadonlyArray<string> = ['mokei', 'flow-host', 'capture']`, exported from `src/service.ts` (or a small `src/report.ts`) and from `index.ts`. `service.ts` and `retention.ts` use it.
  - `FlowConfig` drops `tracing` and `logs`; the schema drops them too. Keep `'tracing'`, `'otlp'`, `'endpoint'`, `'headers'`, `'logs'` and `'level'` in `failedStatus`'s field allow-list, so a stale key is named in the issue.

- [ ] **Step 1: Update the tests (failing).**
  - `service.test.ts`:
    - fakes pass `database` (an `openMokeiDatabase({ path: ':memory:', stores: flowStoreDefinitions })` instance closed in `afterEach`);
    - ordering expectations drop `'telemetry'` and `'database'`;
    - the "stops before opening telemetry when disposed while the database opens" test is deleted (the service no longer opens it);
    - add `does not close the provided database on dispose`: after `dispose()`, `getFlowRunStore(database)` still works.
  - `config.test.ts`: add `rejects the moved tracing and logs keys`, where `{ tracing: {} }` rejects with `FlowConfigError` and `issues` contains `'tracing'`; the same for `logs`.
  - Defaults tests drop `tracing`/`logs`.
  - The `restart.test.ts` / `persistence.test.ts` forwarding telemetry wrapper goes away. Each service instance gets the database opened by the test and closed by the test after `dispose()`.
- [ ] **Step 2: Run** `rtk proxy pnpm --filter @mokei/flow-host-node exec vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the telemetry stage and the database stage, plus the stage strings `'open the flow database'` and `'install flow telemetry'`.
- [ ] **Step 4: Run** the package's `vitest run` and `test:types`. Expected: PASS. `packages/cli` and `integration-tests` still fail type-checking at this point.
- [ ] **Step 5: Do not commit yet.** The pre-commit hook type-checks the whole workspace, so Tasks 2 and 3 run as one dispatch and land as one commit (Task 3 Step 5).

### Task 3: Daemon owns config, database and telemetry

**Files:**
- Modify:
  - `packages/cli/src/daemon-entry.ts`
  - `packages/cli/package.json` (add `@mokei/app-node`)
  - `packages/cli/test/daemon-shutdown.test.ts`
  - `packages/cli/test/daemon.test.ts`
  - any other cli caller of `databasePath`
- Modify integration callers:
  - `integration-tests/support/flow-daemon/entry.mjs`
  - `integration-tests/support/flow-monitor-entry.mjs`
  - `integration-tests/support/flow-daemon/driver.ts`
  - `integration-tests/suites/flow-cli.test.ts`
  - `integration-tests/suites/flow-daemon-telemetry.test.ts`
  - `integration-tests/dts-consumer`, if it references removed exports
- In the integration callers:
  - the database file becomes `mokei.db` (the driver's `flows.db` → `mokei.db`, the `-wal` check included);
  - `flow-cli.test.ts`'s pinned `MOKEI_DATABASE_PATH` → `<dir>/mokei.db`;
  - the driver writes `logs`/`tracing` to a `mokei.json` (passed via `configPath` / `--config-path`) instead of `flows.json`.

**Interfaces:**
- Consumes: Task 1 (`loadMokeiConfig`, `openMokeiDatabase`, `setupMokeiTelemetry`) and Task 2 (`flowStoreDefinitions`, `FLOW_REPORT_CATEGORY`, `createFlowService({ database, … })`).
- `startMokeiDaemon(params)`:
  - `configPath?: string` now means `mokei.json`;
  - it gains `flowsConfigPath?: string`, which is forwarded as `createFlowService({ configPath: params.flowsConfigPath })`;
  - it keeps `databasePath`.
- CLI flags: `--config-path` (`mokei.json`), `--flows-config-path` (`flows.json`), `--database-path`.
- Update every caller that passed `configPath` / `--config-path` meaning `flows.json`, so it uses the flows variant: `integration-tests/support/flow-daemon/entry.mjs`, `flow-monitor-entry.mjs`, `driver.ts` (`'--config-path'` at ~183), and the cli tests.
- **Boot order:**
  1. `config = await loadMokeiConfig(params.configPath)`
  2. `database = await openMokeiDatabase({ path: params.databasePath, stores: flowStoreDefinitions })`
  3. `telemetry = setupMokeiTelemetry({ logStore: await getLogStore(database), telemetryStore: await getTelemetryStore(database), otlp: config.tracing.otlp, logs: config.logs, reportCategories: [FLOW_REPORT_CATEGORY] })`
  4. `createFlowService({ database, … })`
  5. `serveHostDaemon(…)`
- **Shutdown** (`onShutdown` and the boot-failure path): `presence.dispose()`, `await service.dispose()`, `await telemetry.dispose()`, `await database.close()`. Each step is attempted even if an earlier one throws. Errors are aggregated as today: `AggregateError` on boot failure plus cleanup failure.
- For tests, `startMokeiDaemon` may take an internal dependencies object (as `createFlowServiceWithDependencies` does). It must not be exported from the package entry.

- [ ] **Step 1: Write the failing tests** in `packages/cli/test/daemon-shutdown.test.ts`, or a new `daemon-boot.test.ts`:
  - `rejects an invalid mokei.json before opening the database`: write `mokei.json` with `{ "bogus": 1 }`; `startMokeiDaemon({ configPath, databasePath })` rejects with `MokeiConfigError`; `existsSync(databasePath)` is `false`.
  - `disposes the flow service, then telemetry, then the database`: record the order through spies or dependency fakes; expect `['service', 'telemetry', 'database']`.
  - `releases the database when telemetry setup fails`: `setupMokeiTelemetry` throws `new Error('telemetry failed')`; the boot rejects with that error and `database.close` was called.
  - `captures telemetry while the flow service is failed`:
    - write an invalid `flows.json` (`{ "bogus": 1 }`) and start the daemon;
    - the flow status reaches `failed`;
    - emit a span through `trace.getTracer('test').startActiveSpan` that logs one record;
    - stop the daemon;
    - a read-only `DatabaseSync` on `mokei.db` finds ≥1 row in `hozon_spans` and in `hozon_logs`.
- [ ] **Step 2: Run** `rtk proxy pnpm --filter mokei exec vitest run test/daemon-shutdown.test.ts` (plus the new file). Expected: FAIL.
- [ ] **Step 3: Implement `daemon-entry.ts`,** then update the remaining cli tests and the integration callers.
- [ ] **Step 4: Verify.**
  - `rtk proxy pnpm run build` passes.
  - `rtk proxy pnpm run test` passes (packages and integration).
  - `rtk proxy pnpm run lint` passes.
  - `rg -n "openFlowDatabase|setupFlowTelemetry|flows\.db|flow\.db" packages integration-tests scripts -g '!**/lib/**' -g '!**/node_modules/**' -g '!**/CHANGELOG.md'` returns only README hits, which Task 4 fixes.
- [ ] **Step 5: Commit** Tasks 2 and 3 together as `refactor: own the mokei database and telemetry in the daemon`.

### Task 4: Docs and release intent

**Files:**
- Modify:
  - `packages/app-node/README.md`: API table, `mokei.json` schema and defaults, database path rules, `reportCategories`;
  - `packages/flow-host-node/README.md`: the service takes `database`; `flowStoreDefinitions`; no telemetry; config keys; rewrite the example for the daemon-style wiring;
  - `packages/cli/README.md`: `mokei.json`, `MOKEI_CONFIG_PATH`, `--config-path` / `--flows-config-path`, `mokei.db`;
  - `docs/agents/architecture.md`: new package row; the paragraph at ~343 now says the daemon owns one `HozonDB` (`mokei.db`) and telemetry, and flows register their stores;
  - `.changeset/flow-host-hozon.md`.
- Changeset front matter: `'@mokei/app-node': patch`, `'@mokei/flow-host-node': patch`, `'@mokei/flow-host': patch`, `mokei: patch`. Body: "Add `@mokei/app-node`: `mokei.json` configuration, the single `mokei.db` hozon database (`openMokeiDatabase`) and telemetry (`setupMokeiTelemetry`), owned by the daemon. Flow runs and tasks are hozon stores registered in that database; `createFlowService` takes the database instead of opening one, and logging/tracing settings move from `flows.json` to `mokei.json`. `@mokei/flow-host` drops `createTraceStoreSpanExporter` and `createTraceStoreLogSink` in favour of `@hozon/otel` and `@hozon/logtape`."

- [ ] **Step 1: Edit the docs.** Then run `rg -n "openFlowDatabase|setupFlowTelemetry|flow\.db|flows\.db|createSQLite" packages/*/README.md docs/agents/architecture.md`. Expected: nothing.
- [ ] **Step 2: Run** `pnpm change status`. Expected: patch for the fixed group, with `@mokei/app-node` 0.14.0 → 0.14.1.
- [ ] **Step 3: Commit** `docs: document mokei app-node, mokei.json and mokei.db`.

## Release (only on the user's approval, after merge)

As in the predecessor plan: `pnpm change status`, then `pnpm version -r`, commit, and the user publishes.
