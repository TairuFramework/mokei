# Flow Daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose durable flow execution, recovery and an opt-in desktop surface into the existing per-user daemon.

**Architecture:** The CLI owns the application entry. Host-node supplies generic serving and handler composition. Flow-host-node owns one shared flow service and receives injected desktop operations.

**Tech Stack:** TypeScript, pnpm, Vitest, Enkaku, node:sqlite, OpenTelemetry, Sozai and Tejika packages.

**Spec:** [Flow daemon design](../specs/2026-10-02-flow-daemon-design.md)

**Stage:** reviewing
**Mode:** tasks

## Global Constraints

- Desktop notifications are opt-in and default to off.
- Configuration changes take effect on daemon restart.
- Multiple pending items at startup produce one generic notification containing the pending count.
- One pending item at startup produces one item notification.
- Desktop dialogs open only through an explicit inbox request.
- Proxy and monitor services remain available when flow configuration or startup fails.
- Flow service initialization occurs once per daemon process, shared by every connected client.
- No new package is required.
- Events describe live changes, not a durable replay log.
- The flow rig remains available until phase 4.
- Phase 4 delivers user-facing daemon, flow, run and inbox commands and the MCP facade.
- Phase 5 delivers monitor pages.
- Shutdown suspends stored runs and drains telemetry before closing SQLite.
- Use kebab-case filenames, pnpm commands and existing stack packages.
- Change dependency edges when needed, without changing package scripts or build and lint configuration.
- Keep host-protocol portable and host-node free of flow and desktop implementation dependencies.
- Tests use temporary application paths and injected desktop backends.

## Review Focus

1. Shutdown during a delayed sibling connection must clean up its eventual result without publishing ready status. Task 5.
2. An item settling during startup notification delivery must not receive a second live notification. Task 4.
3. A disconnected prompt caller must release dialog ownership while leaving its inbox item pending. Task 4.
4. Flow validation carries internal functions that must never enter protocol results. Tasks 1 and 6.
5. Two connections must share proxy state, runtime state and event delivery without duplicating recovery. Tasks 2 and 8.

## Repository map and task order

Read the spec, `docs/agents/architecture.md` and relevant kigu skills before implementation.
The branch is `feat/flow-daemon`.
Tasks 1–9 are implemented. Focused task checks/reviews and the final lint, build, full test and release-preview checks passed. Whole-branch review and user desktop QA remain open.

| Unit | Files | Responsibility |
|------|-------|----------------|
| Wire contract | `packages/host-protocol/src/{index,flow-schemas}.ts` | Status, flow payloads, errors and event schemas |
| Generic daemon | `packages/host-node/src/{server,daemon,daemon-server,index}.ts` | Shared host state, composition and lifecycle |
| Recovery barrier | `packages/flow-host/src/{watcher,recovery,host}.ts` | Initial task and inbox reconciliation |
| Desktop notification | `packages/host-desktop/src/{notification,dialog-surface,index}.ts` | Reusable native notification delivery |
| Flow desktop policy | `packages/flow-host-node/src/{desktop,config}.ts` | Notification aggregation and explicit prompting |
| Flow service | `packages/flow-host-node/src/{service,index}.ts` | Initialization, availability and resource cleanup |
| Flow handlers | `packages/flow-host-node/src/{handlers,handler-errors,index}.ts` | Public runtime and trace procedures |
| Application entry | `packages/cli/src/{daemon-entry,daemon}.ts` | CLI composition and launch options |
| Daemon fixtures | `integration-tests/support/flow-daemon/*` | Child processes, deterministic flows and desktop evidence |
| Durable guidance | Package READMEs and `docs/agents/architecture.md` | Published ownership and lifecycle contracts |

Tasks 1–3 establish contracts and infrastructure.
Task 4 defines desktop integration before Task 5 composes it.
Task 6 binds service availability to RPC handlers.
Tasks 7–8 exercise the published application entry over real sockets and process replacement.
Task 9 validates the branch and records release intent.

## Shared interface decisions

These types are defined by their owning tasks rather than duplicated across packages.

- `FlowServiceStatus`: `{ state: 'starting' } | { state: 'ready' } | { state: 'failed'; error: { type: string; message: string; path?: string; issues?: Array<string> } }`.
- `FlowProcedure`: the 13 `flows.*`, `runs.*` and `inbox.*` keys listed in Task 1.
- `BaseProtocol`: `Pick<Protocol, 'events' | 'info' | 'shutdown' | 'spawn'>`.
- `FlowHandlers`: `Pick<ProcedureHandlers<Protocol>, FlowProcedure>`.
- `FlowDesktopAdapter`: `{ canPrompt(request: DesktopElicitRequest): boolean; prompt(request: DesktopElicitRequest): Promise<ElicitResult>; notify(message: string): Promise<void>; dispose(): Promise<void> }`.
- `FlowDesktopController`: `{ restored(items: Array<InboxItem>): void; added(item: InboxItem): void; settled(item: InboxItem): void; prompt(id: string, signal: AbortSignal): Promise<{ action: 'accept' | 'decline' | 'cancel' }>; dispose(): Promise<void> }`.
- `FlowResources`: `{ host: FlowHost; traceStore: TraceStore }`.
- `FlowService`: `{ status(): FlowServiceStatus; resources(): FlowResources; run<T>(work: (resources: FlowResources) => T | Promise<T>): Promise<T>; start(): Promise<void>; prompt(id: string, signal: AbortSignal): Promise<{ action: 'accept' | 'decline' | 'cancel' }>; dispose(): Promise<void> }`.
- `FlowServiceParams`: `{ configPath?: string; databasePath?: string; desktop?: FlowDesktopAdapter; onEvent(event: HostEvent): void }`.

`FlowService.resources()` throws an unavailable domain error unless ready.
`run()` gates admission and tracks the complete operation until settlement.
`start()` is idempotent and records initialization failure in status without rejecting the application boot.
Unexpected lifecycle disposal errors still reject disposal after all cleanup attempts.
Functions accepting test dependencies use internal typed options rather than widening public wire schemas.

### Task 1: Define portable wire contracts

**Files:** Create `packages/host-protocol/src/flow-schemas.ts`. Modify `packages/host-protocol/src/index.ts`.
Modify base-protocol type imports in `packages/host-node/src/server.ts` until composition is introduced.
Create `integration-tests/suites/host-protocol.test.ts`.

**Interfaces:** Export `FlowServiceStatus`, `FlowProcedure`, `BaseProtocol`, expanded `HostEvent` and `Protocol`.
Export schemas for run snapshots, inbox items, stored spans, stored logs and public validation results.

- [x] **Step 1: Add failing wire-contract tests.**

```typescript
test('flow events require run identity without context identity', () => {
  expect(validEvent(runEvent)).toBe(true)
  expect(validEvent({ ...runEvent, meta: { ...runEvent.meta, contextID: 'fake' } })).toBe(false)
})
test('validation results contain only public JSON values', () => {
  expect(validCheck({ value: emptyFlow, warnings: [], formatted: '' })).toBe(true)
  expect(validCheck({ value: emptyFlow, warnings: [], formatted: '', graphFor: () => {} })).toBe(false)
})
```

Fixtures use real UUIDs and valid public payloads.
Also assert rejection of invalid states, mixed registered/inline starts, malformed inbox unions and unknown status properties.
Accept all three existing context event forms and their unchanged metadata.

- [x] **Step 2: Run `pnpm --filter mokei-integration-tests exec vitest run suites/host-protocol.test.ts`.**
Expected: tests fail because flow schemas and procedures are absent.

- [x] **Step 3: Implement the schemas and procedure definitions.**

Define `flows.list`, `flows.check`, `runs.start`, `runs.get`, `runs.list`, `runs.cancel`, `runs.trace`.
Define `inbox.list`, `inbox.get`, `inbox.answer`, `inbox.decline`, `inbox.cancel`, `inbox.prompt`.
Add `flowService` to the `info` result.
Use `{ id }` for inbox parameters and `{ runID }` for run parameters.
Use runtime `StartRunParams` field names for start requests and runtime filter names for lists.
Settlement acknowledgements are `{ settled: true }`.
Prompt results are `{ action: 'accept' | 'decline' | 'cancel' }`.
`runs.trace` returns `{ spans, logs }` using the existing stored record shapes.
`flows.check` returns only `value` or `issues`, plus `warnings` and `formatted`.
Validation issue payloads preserve JSON-safe paths, severity, code, message and optional hint.
Do not expose `graphFor` or `lookup`.
Keep schema-valued definitions and requested input schemas extensible as JSON objects.

Add `service:status` with `{ service: 'flow', status }` data.
Flow event data follows `FlowHostEvents` exactly.
Context metadata retains `contextID`, `eventID` and `time`.
Flow and service metadata contains only `eventID` and `time`.
Replace the loose event stream receive schema with the complete discriminated union.
Avoid imports from runtime packages into host-protocol.
Keep existing host server typing against `BaseProtocol` during this preparatory task.

- [x] **Step 4: Run the new tests and `pnpm --filter @mokei/host-protocol test`.**
Expected: schema tests and portable type checks pass.

- [x] **Step 5: Commit as `feat(host-protocol): define flow daemon procedures and events`.**

### Task 2: Compose generic daemon handlers and shared state

**Files:** Create `packages/host-node/src/daemon-server.ts`.
Modify `packages/host-node/src/{server,daemon,index}.ts` and `packages/host-node/test/daemon-server.test.ts`.
Create `packages/host-node/test/daemon-composition.test.ts`.

**Interfaces:** Export `composeHandlers(...sets: Array<Partial<ProcedureHandlers<Protocol>>>): Partial<ProcedureHandlers<Protocol>>`.
Export `serveHostDaemon(params: HostDaemonParams): Promise<DaemonHandle>`.
`HostDaemonParams` has optional `socketPath`, `pidPath`, `signal`, `handleSignals`, `shutdownTimeoutMs`, `handlers`, `flowStatus` and `onShutdown`.
`handlers` is an injected partial handler set.
`flowStatus` returns `FlowServiceStatus`.
`onShutdown` returns `Promise<void>`.
The entry also receives one shared `events: EventTarget`.
Extend `DaemonOptions` with optional `entry: string` while retaining `socketPath`.

- [x] **Step 1: Add composition and two-connection tests.**

```typescript
test('rejects duplicate registrations', () => {
  expect(() => composeHandlers({ info }, { info })).toThrow('Duplicate procedure: info')
})
test('shares context state across client connections', async () => {
  await startProxyThrough(firstClient)
  expect(Object.keys((await secondClient.request('info')).activeContexts)).toHaveLength(1)
})
```

Also assert both event streams receive one context-start event.
Assert disconnecting one stream removes its listeners without affecting the other.
Assert already-aborted event subscriptions settle and do not leak writers.
Assert standalone flow procedures return `FLOW_UNAVAILABLE`.
Mock `ensureDaemon` and assert an explicit `entry` overrides the existing default.

- [x] **Step 2: Run `pnpm --filter @mokei/host-node exec vitest run test/daemon-composition.test.ts test/daemon-server.test.ts`.**
Expected: composition and shared-state assertions fail against existing per-connection state.

- [x] **Step 3: Implement composition and shared daemon serving.**

Allocate context maps, children, event source and start time once before the Tejika `serve` callback.
Compose base handlers, injected flow handlers and unavailable fallbacks in that order without duplicate overrides.
Add fallbacks only for flow keys missing from injected handlers.
Provide standalone failed status with type `FlowUnavailable` and an actionable entry-selection message.
Forward event variants through one cancellation-aware stream implementation.
Keep writer failures local to each subscription.
Return the Tejika daemon handle and delegate socket permissions, pid ownership and process signals to Tejika.
Retain `createHandlers` for existing tests and expose generic serving from the public package entry.
RPC shutdown schedules daemon closure after its acknowledgement rather than awaiting closure inside its own request.
Shutdown calls injected cleanup once and always cleans up tracked proxy children.

- [x] **Step 4: Run focused tests and `pnpm --filter @mokei/host-node test`.**
Expected: existing proxy, elicitation and daemon tests remain green.

- [x] **Step 5: Commit as `feat(host-node): compose daemon handlers with shared process state`.**

### Task 3: Await initial recovery reconciliation

**Files:** Modify `packages/flow-host/src/{watcher,recovery,host}.ts`.
Modify `packages/flow-host/test/recovery.test.ts` and create `packages/flow-host/test/watcher.test.ts`.
Update `packages/flow-host-node/test/restart.test.ts`.

**Interfaces:** `createWatchers().watch(runID: string, taskID: string): Promise<void>` resolves after the first applied task snapshot.
It rejects on initial non-missing task-read failure or interrupted shutdown.
`recoverRuns` awaits these initial promises for recovered task-backed runs.
`createFlowHost(params: FlowHostParams): Promise<FlowHost>` keeps its public signature.
Its resolution now guarantees initial reconciliation for recovered runs.

- [x] **Step 1: Add failing readiness tests.**

```typescript
test('returns recovered inputs before host creation resolves', async () => {
  const recovered = await recreateHostWithWaitingTask()
  expect(recovered.inbox.list()).toHaveLength(1)
  expect(recovered.inbox.list()[0]?.id).toBe(originalItemID)
})
```

Hold the first task read using a deferred promise and assert host creation remains pending.
Resolve the read and assert creation completes without waiting for a user answer.
Missing recovered tasks become failed runs and settle initial reconciliation.
An initial transport error rejects readiness and leaves no watcher or wiring leak.
Later poll errors retain existing retry behaviour.
Stopping a watcher rejects unsettled initial readiness and drains its loop.

- [x] **Step 2: Run `pnpm --filter @mokei/flow-host exec vitest run test/recovery.test.ts test/watcher.test.ts`.**
Expected: immediate inbox readiness assertions fail against asynchronous watcher startup.

- [x] **Step 3: Implement the first-snapshot barrier.**

Associate each watcher with its controller, loop and initial reconciliation promise.
Reuse the promise for duplicate watches.
Resolve only after `apply` or missing-task failure mapping completes.
Register loop promises before cleanup can remove them.
Do not wait for task completion or repeatedly poll before declaring readiness.
Treat initial transport failure as fatal initialization rather than falsely declaring ready.
Keep per-run domain recovery errors mapped to failed runs.
Collect first-snapshot promises during recovery and await them outside the per-run domain-error catch.
Await initial watcher promises before returning the host.
Preserve existing construction failure cleanup.

- [x] **Step 4: Run portable recovery tests and `pnpm --filter @mokei/flow-host-node exec vitest run test/restart.test.ts`.**
Expected: recovered inbox assertions need no polling after host creation resolves.

- [x] **Step 5: Commit as `fix(flow-host): await initial recovered task reconciliation`.**

### Task 4: Add opt-in notification aggregation and explicit prompting

**Files:** Create `packages/host-desktop/src/notification.ts` and `packages/host-desktop/test/notification.test.ts`.
Modify `packages/host-desktop/src/{dialog-surface,index}.ts`.
Create `packages/flow-host-node/src/desktop.ts` and `packages/flow-host-node/test/desktop.test.ts`.
Modify `packages/flow-host-node/src/config.ts` and `packages/flow-host-node/test/config.test.ts`.
Add direct workspace dependency edges required for desktop request types and runtime integration.

**Interfaces:** Export `createDesktopNotifier(options: DesktopElicitOptions = {}): { notify(message: string, options?: { signal?: AbortSignal }): Promise<void>; dispose(): Promise<void> }`.
Factor existing notification delivery through that operation without changing existing input-surface semantics.
Define the shared `FlowDesktopAdapter` and `FlowDesktopController` types in `desktop.ts`.
Export `createFlowDesktopController(params: { adapter?: FlowDesktopAdapter; notifications: boolean; host(): FlowHost; onError(error: unknown): void }): FlowDesktopController`.
Add `desktop: { notifications: boolean }` to normalized `FlowConfig`.

- [x] **Step 1: Add failing configuration and desktop tests.**

```typescript
test('desktop notifications default to off', async () => {
  expect((await loadFlowConfig(missingPath)).desktop).toEqual({ notifications: false })
})
test('aggregates restored prompts without notifying each item', async () => {
  controller.restored([firstItem, secondItem])
  expect(adapter.notify).toHaveBeenCalledExactlyOnceWith('2 pending prompts')
})
```

Assert zero items send nothing and one item sends its kind-specific item notification.
New items send `Flow needs your approval` or `Flow needs your input` without prompt previews.
Represented IDs and duplicate additions do not send again.
Block startup delivery, settle an item and add another item.
Assert the startup message remains one notification and only the new ID receives live delivery.
Disabled notifications make zero backend calls.
Notification failure reports once without retry or inbox mutation.
Reject invalid desktop values and unknown desktop properties in configuration.

Prompt tests assert duplicate ownership fails, unsupported forms remain pending and accepted content passes through runtime validation.
Approval accepts only `content.approve === true`, declines explicit false and cancels dismissed dialogs.
Remote settlement aborts the signal and prevents a late answer.
Caller cancellation leaves the inbox item pending and permits a later prompt request.
Shutdown aborts and drains prompts and notifications.

- [x] **Step 2: Run focused config, desktop and notifier tests.**
Run `pnpm --filter @mokei/flow-host-node exec vitest run test/config.test.ts test/desktop.test.ts`.
Run `pnpm --filter @mokei/host-desktop exec vitest run test/notification.test.ts`.
Expected: new defaults, aggregation and notifier APIs fail until implemented.

- [x] **Step 3: Implement the notifier, controller and configuration extension.**

Use existing detection, backend factories, runner cancellation and the existing 5000ms notification timeout.
Preserve runner ownership when dependencies are injected.
Make startup aggregation synchronous through ID bookkeeping before scheduling asynchronous delivery.
Track represented IDs for the daemon lifetime.
Store prompt ownership before awaiting the run label or desktop operation.
Use the shared desktop input surface for FIFO dialog serialization.
Combine caller, settlement and disposal signals.
Remove ownership in `finally`.
Treat unsupported forms and backend failures as errors rather than human declines.
Pass approval answers to `host.inbox.answer(id)` only after explicit confirmation.
Use runtime inbox cancellation only for an actual desktop cancel result.
Do not settle items on transport or lifecycle abort.

- [x] **Step 4: Run focused tests and existing host-desktop tests.**
Expected: all existing in-process desktop behaviour remains green.

- [x] **Step 5: Commit as `feat(flow-host-node): add opt-in desktop inbox policy`.**

### Task 5: Own shared flow startup and resource lifetime

**Files:** Create `packages/flow-host-node/src/service.ts` and `packages/flow-host-node/test/service.test.ts`.
Modify `packages/flow-host-node/src/index.ts` and `packages/flow-host-node/package.json` dependency edges.

**Interfaces:** Export `createFlowService(params: FlowServiceParams): FlowService` and the shared service types.
The factory creates status and admission state synchronously.
`start()` begins asynchronous resource acquisition.
Domain unavailable errors carry status for Task 6's mapping.

- [x] **Step 1: Add failing service lifecycle tests with injected acquisition functions.**

```typescript
test('publishes ready after restored inbox reconciliation', async () => {
  const service = createTestService({ recovery: delayedRecovery })
  const starting = service.start()
  expect(service.status()).toEqual({ state: 'starting' })
  recovery.resolve(resources)
  await starting
  expect(service.status()).toEqual({ state: 'ready' })
  expect(desktop.restored).toHaveBeenCalledWith(restoredItems)
})
```

Assert every acquisition failure produces failed status and cleanup of earlier resources.
Cover invalid config, malformed flow files, database failure, telemetry failure, sibling failure and registration failure.
Assert telemetry is disposed before database closure.
Assert resources reject access before ready and after shutdown begins.
Hold sibling connection, call dispose and then resolve connection.
Assert no ready event, no retained session and exactly one resource cleanup.
Call start and dispose twice and assert idempotence.
Make one disposer reject and assert all later disposers still run.

- [x] **Step 2: Run `pnpm --filter @mokei/flow-host-node exec vitest run test/service.test.ts`.**
Expected: service APIs are absent.

- [x] **Step 3: Implement service ownership and startup order.**

Load configuration and flow files before consuming global telemetry registration.
Use `NodeSession({ elicit: true })` and existing configured sibling connections.
Register listeners during `createFlowHost` construction.
Bridge runtime events immediately but suppress desktop per-item delivery until `restored` establishes the startup boundary.
Start retention after initial recovery and before publishing ready.
Publish service status events through the injected event callback.
Sanitize failed status to typed message, configuration path and issues without raw environment or credential values.
Install no retry timer and preserve process-lifetime telemetry restrictions.
Check shutdown state after each awaited acquisition and clean up eventual acquired results.
Disposal aborts desktop operations before draining calls and acquired resources.
Cleanup order is retention, runtime, session, telemetry and database.
The adapter is owned by the service after factory handoff and disposed even if configuration fails.
Add direct production dependencies on session-node, host-protocol and other imported types.
Update the pnpm lockfile using pnpm.

- [x] **Step 4: Run service tests and `pnpm --filter @mokei/flow-host-node test`.**
Expected: tests pass without global telemetry reinstallation in a single process.
Use injected telemetry for unit failures and child-process isolation for real registration.

- [x] **Step 5: Commit as `feat(flow-host-node): own daemon flow service lifecycle`.**

### Task 6: Bind flow handlers and public error mapping

**Files:** Create `packages/flow-host-node/src/{handlers,handler-errors}.ts`.
Create `packages/flow-host-node/test/handlers.test.ts`.
Modify `packages/flow-host-node/src/index.ts` and package dependency edges.

**Interfaces:** Export `createFlowHandlers(service: FlowService): FlowHandlers`.
Export `FlowHandlers` from this package.
Define `toHandlerError(error: unknown): HandlerError<string>` in `handler-errors.ts`.

- [x] **Step 1: Add failing handler tests over Enkaku DirectTransports.**

```typescript
test('projects validation without runtime closures', async () => {
  const result = await client.request('flows.check', { definition: emptyFlow })
  expect(result).toEqual({ value: emptyFlow, warnings: [], formatted: '' })
  expect(result).not.toHaveProperty('graphFor')
  expect(result).not.toHaveProperty('lookup')
})
```

Exercise every procedure against a real portable runtime with memory stores.
Assert registered and inline starts have identical approval enforcement.
Assert invalid answers leave items pending.
Assert unknown runs differ from known runs with no trace.
Assert trace reads return only the run's stored trace.
Assert status gating applies to every flow procedure.
Assert unexpected exceptions return a generic error without secret-bearing exception messages.
Assert prompt passes the request cancellation signal to the service.

- [x] **Step 2: Run `pnpm --filter @mokei/flow-host-node exec vitest run test/handlers.test.ts`.**
Expected: handler factory and mapped errors are absent.

- [x] **Step 3: Implement public handlers and errors.**

Use Enkaku `HandlerError({ code, message, data })`.
Map unavailable to `FLOW_UNAVAILABLE`, missing flow to `FLOW_NOT_FOUND` and missing run to `RUN_NOT_FOUND`.
Map missing inbox item to `INBOX_ITEM_NOT_FOUND` and invalid answer to `INBOX_ANSWER_INVALID`.
Map invalid definition to `FLOW_INVALID`, unsupported dialog to `PROMPT_UNSUPPORTED` and duplicate prompt to `PROMPT_IN_PROGRESS`.
Unexpected errors return `INTERNAL_ERROR` with message `Flow request failed` and log the exception locally.
Expose validated issues for invalid answers and definitions through JSON-safe `data.issues`.
Project validation results rather than spreading runtime results.
Perform ready-state checks at admission and track admitted procedure promises for shutdown draining.
Wrap each procedure operation with `service.run` using the interface from Task 5.
Ensure disconnected requests cannot free resources while an admitted mutation is still completing.
Trace lookup first verifies the run and uses only its `traceID`.
Return wire acknowledgements defined in Task 1.

- [x] **Step 4: Run handlers tests and affected package type checks.**
Expected: all wire results satisfy the protocol types and public validation schemas.

- [x] **Step 5: Commit as `feat(flow-host-node): expose flow daemon procedure handlers`.**

### Task 7: Compose the CLI-owned daemon entry

**Files:** Create `packages/cli/src/{daemon,daemon-entry}.ts` and `packages/cli/test/daemon.test.ts`.
Modify `packages/cli/src/commands/{proxy,monitor}.ts`, `packages/cli/package.json` dependency edges and lockfile.
Modify `packages/host-node/src/daemon-server.ts` only for the finalized shutdown hook integration.

**Interfaces:** Export CLI-local `ensureMokeiDaemon(options: { socketPath?: string }): Promise<HostClient>` from `daemon.ts`.
Resolve `./daemon-entry.js` relative to that module and pass its path into host-node `runDaemon`.
Export `startMokeiDaemon(params: { socketPath?: string; pidPath?: string; configPath?: string; databasePath?: string; handleSignals?: boolean; desktop?: FlowDesktopAdapter }): Promise<DaemonHandle>` from `daemon-entry.ts`.
Importing the entry must not start a process.

- [x] **Step 1: Add entry and launch tests.**

```typescript
test('proxy and monitor select the composed entry', async () => {
  await ensureMokeiDaemon({ socketPath: testSocket })
  expect(runDaemon).toHaveBeenCalledWith({ socketPath: testSocket, entry: expectedEntry })
})
```

Assert import has no daemon side effect.
Assert generic serving starts before delayed flow initialization resolves.
Assert initialization failure leaves `info`, `events` and proxy handlers callable.
Assert one entry creates one service for two connections.
Assert configured desktop notifications do not create model-callable notify or ask tools.

- [x] **Step 2: Run `pnpm --filter mokei exec vitest run test/daemon.test.ts`.**
Expected: CLI wrapper and entry composition are absent.

- [x] **Step 3: Implement the composed application entry and launch wrapper.**

Create one shared event target, service and desktop adapter before accepting client connections.
Wrap service events into CustomEvents matching the generic event bridge.
Use `createDesktopInputSurface` for prompts and `createDesktopNotifier` for generic notification messages.
Bind generic serving before calling service start.
If socket boot fails, dispose the unstarted service and adapter.
Shutdown stops admission and disposes the service through the generic lifecycle hook.
Parse explicit `--socket-path`, `--pid-path`, `--config-path` and `--database-path` arguments only in executable mode.
Explicit overrides support test isolation and remain undocumented internal entry options.
Use existing default data paths when absent.
Keep CLI command names and help output unchanged.
Let Tejika own process termination after cleanup rather than adding competing signal handlers.

- [x] **Step 4: Run CLI daemon tests and existing proxy/help integration tests.**
Run `pnpm run build` before process-based tests.
Run `pnpm --filter mokei-integration-tests exec vitest run suites/cli-proxy.test.ts suites/cli-help.test.ts`.
Expected: existing commands launch successfully with the composed entry.

- [x] **Step 5: Commit as `feat(cli): launch the composed flow daemon entry`.**

### Task 8: Prove process restart, shared services and desktop behaviour

**Files:** Create `integration-tests/support/flow-daemon/{driver.ts,entry.mjs,sibling.mjs,flows.ts}`.
Create `integration-tests/suites/flow-daemon.test.ts`.
Add direct test dependency edges in `integration-tests/package.json` and update lockfile.

**Interfaces:** `startFlowDaemonFixture(options?: { notifications?: boolean; invalidConfig?: boolean }): Promise<FlowDaemonFixture>`.
`FlowDaemonFixture` exposes `connect()`, `stop()`, `kill()`, `restart()`, `readDatabase()`, `notifications()` and `dispose()`.
Its application paths, socket, pidfile, database and notification evidence all live in one temporary directory.
The fixture entry imports the built CLI `startMokeiDaemon` and injects a file-recording desktop adapter.

- [x] **Step 1: Add failing process-level tests.**

```typescript
test('resumes waiting input after daemon replacement', async () => {
  const run = await first.request('runs.start', { flow: 'input' })
  const before = await waitForPendingInput(first, run.runID)
  await fixture.stop()
  await fixture.restart()
  const second = await fixture.connect()
  const after = await second.request('inbox.list', { runID: run.runID })
  expect(after[0]?.id).toBe(before.item.id)
  expect((await second.request('runs.get', { runID: run.runID })).traceID).toBe(before.traceID)
  await second.request('inbox.answer', { id: before.item.id, content: { value: 'Ada' } })
  expect(await waitForTerminal(second, run.runID)).toMatchObject({ state: 'completed' })
})
```

Read task IDs from SQLite only when the process has stopped or through an isolated read-only connection.
Assert task identity remains unchanged and no duplicate task appears.
Repeat waiting-input replacement with SIGKILL after a confirmed durable checkpoint.
Recover pending approval, approve it and verify it launches once.
Read stored trace after graceful shutdown and assert correlated capture survived.

With invalid configuration, assert failed status, `FLOW_UNAVAILABLE` and successful proxy echo through a fixture sibling.
Connect a second client and assert shared run listings and single event delivery per subscriber.
Cancel and reconnect one subscriber while the other continues receiving updates.

Notification scenarios cover disabled default, zero restored items, one restored item and multiple restored items.
Assert the multi-item startup produces exactly one count message.
Add one live item and assert exactly one additional notification.
Repeated list requests and client reconnection produce no additional records.
Prompt tests simulate caller cancellation and settlement through another client.
Assert cancellation leaves the item pending and remote settlement prevents a late answer.

- [x] **Step 2: Run `pnpm --filter mokei-integration-tests exec vitest run suites/flow-daemon.test.ts`.**
Expected: fixture or assertions expose missing process-level behaviour.

- [x] **Step 3: Implement the isolated driver and deterministic fixtures.**

Use actual Node child processes and real unix sockets.
Use simple deterministic input, approval and end-node flows without a remote predictor or model.
The sibling serves an echo tool for approval and proxy assertions.
Wait on observable status and committed records instead of fixed sleeps.
Bound fixture waits and include child stderr on timeout.
Dispose clients, process handles and temporary resources in `finally`.
Never use the real per-user pidfile or notification backends.
Fix production failures in their owning units and rerun those focused unit tests.

- [x] **Step 4: Rebuild changed packages and run the daemon integration suite.**
Expected: all scenarios pass with real process replacement and opt-in desktop evidence.
Check no fixture child or socket remains after cleanup.

- [x] **Step 5: Commit as `test: cover flow daemon restart and inbox surfaces`.**

### Task 9: Document, validate and prepare review

**Files:** Modify `packages/flow-host-node/README.md`, `packages/host-node/README.md` and `docs/agents/architecture.md`.
Create `.changeset/flow-daemon.md`.
Update the milestone status without referencing ephemeral spec or plan paths.

**Interfaces:** Published guidance describes service status, configuration, lifecycle and reconnect semantics from the approved spec.
Release intent covers only public packages actually changed.

- [x] **Step 1: Document `desktop.notifications: false`, startup count messages and explicit prompting.**
Document the CLI-owned entry and generic host extension API.
Explain flow failure visibility, restart-only configuration and initial reconciliation guarantees.
Explain trace batching and public error codes.
Describe subscribe-before-query reconciliation without claiming event replay.
State direct sibling elicitation outside task inbox uses the existing decline fallback.

- [x] **Step 2: Record patch intent using the kigu releasing workflow.**
Include host-protocol, host-node, flow-host, flow-host-node, host-desktop and mokei only if each changed.
Do not apply versions or publish packages.

- [x] **Step 3: Run repository validation.**
Run `pnpm run lint`, `pnpm run build` and `pnpm test`.
Expected: all required checks pass, including the new daemon suite.
Run `pnpm change status` and confirm the existing fixed group includes the affected packages.
Do not broaden unrelated declaration dependency work into this phase.

- [x] **Step 4: Commit documentation and intent as `docs: describe composed flow daemon lifecycle`.**

- [x] **Step 5: Update Stage to `reviewing` after all implementation tasks pass.**
Request a whole-branch review through the selected execution workflow.
Address review findings with focused verification.
Provide manual desktop QA steps with notifications explicitly enabled.
Wait for the user's QA result before completing and finishing the branch.
The checkbox records implementation validation and review handoff; whole-branch review and user QA are tracked separately below.

## Plan self-review

Spec ownership and all 13 flow procedures map to Tasks 1, 2, 5, 6 and 7.
Startup, readiness, failure visibility and cleanup map to Tasks 2, 3, 5 and 7.
Desktop policy and concurrency map to Task 4 and process coverage in Task 8.
Events and reconnect behaviour map to Tasks 1, 2 and 8, with consumer guidance in Task 9.
Durable approvals, waiting input and traces map to Tasks 3 and 8.
Every Review Focus condition has a named test in its owning task.
Interface names and wire acknowledgement shapes remain consistent across tasks.
This plan adds no command families, monitor pages, new packages or event persistence.

## Execution handoff

The user approved the written spec and plan and selected subagent-driven execution.
Tasks 1–8 have implementation commits and task-level reviews. Task 9 completed documentation and the repository validation gate.
The controller owns whole-branch review after Task 9; manual desktop QA, completion and branch finishing remain open.

Final validation: lint checked 721 files without fixes; build passed 30 type-build and 29 JS-build tasks.
The first full test attempt overlapped the build and hit nine five-second flow-host-node timeouts.
A clean full rerun passed all package suites, the 13 flow-rig tests, and 133 integration tests (35 integration tests skipped).
Resource contention is an inference; no production or timeout configuration changes were made.
`pnpm change status` passed with the existing 29-package fixed group advancing from 0.14.0 to 0.14.1.
No versions were applied and nothing was published. The upstream Enkaku release/adoption gate remains open.

## Remaining review and QA gates

- [ ] Whole-branch review and any focused fixes.
- [ ] Manual desktop QA with `desktop.notifications: true` and the user's result.
- [ ] Complete the plan lifecycle and finish the branch after accepted QA.
- [ ] Lift the upstream Enkaku publication gate before releasing packages.
