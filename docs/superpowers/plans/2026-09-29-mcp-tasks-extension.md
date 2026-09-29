# MCP Tasks Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable `2026-07-28` MCP Tasks to mokei while preserving the final-result behaviour of ordinary `callTool` callers.

**Architecture:** A process-owned `TaskManager` persists task records and workers beyond an HTTP request. The server exposes task methods and subscription events. The client offers automatic waiting and an explicit handle, using separate task listens with polling fallback.

**Tech Stack:** TypeScript, `@sozai/schema`, `@sozai/event`, Vitest, pnpm, Streamable HTTP, MCP SDK 2.1.0 and `@modelcontextprotocol/ext-tasks` 0.1.0.

**Spec:** `docs/superpowers/specs/2026-09-29-mcp-tasks-extension-design.md`

## Global Constraints

- Implement only revision `2026-07-28`. Keep `2025-11-25` behaviour and local host tools unchanged.
- Use `type`, `Array<T>`, specific types or `unknown`, and discriminated unions. Never use `interface` or `any`.
- Use `#field` and getters for class state. Never add `private`, `protected`, or `readonly` modifiers.
- Use one `ClassNameParams` object for constructors. Capitalise mokei-owned `ID`, `HTTP`, `DID`, and `JWT` identifiers.
- Preserve extension wire spelling, including `taskId`, `inputRequests`, and `inputResponses`. Map it at the store boundary to `taskID`.
- Use module-level `import type`, named imports, 2-space indentation, single quotes, 100-character lines, and trailing commas.
- Wrap multi-line function bodies in braces. Use terse comments only for surprising reasons. Never add placeholder values.
- Use kebab-case file names. Use `test` in Vitest. Keep plan labels out of code, comments, and test names.
- Change only requested code. Do not alter package scripts, lint configuration, `.npmrc`, generated `lib/`, or create a package.
- Use British spelling in documentation prose. Use ` -- ` for parenthetical breaks. Keep procedural sentences short.
- Use pnpm only. Use `catalog:` for shared dependencies and `workspace:^` for internal packages.
- Run `rtk proxy pnpm run lint` at the repository root before each implementation commit.
- Build changed producer packages before consumer tests. Run integration suites only after `pnpm build`.
- Before every implementation commit, run `pnpm build` then `pnpm test`. Expected: both exit 0.
- The extension schema is supplied by the spec. Fetch nothing for schema design.
- `pnpm-workspace.yaml` has no `@modelcontextprotocol/ext-tasks` catalog entry. Add exact `0.1.0` before interop installation.
- `pnpm-workspace.yaml` fixes all public packages in one `versioning.fixed` group. One minor intent moves them together.

## Spec deviations

- `TaskRecord.taskId` in the spec is a mokei-owned field. Name it `taskID` under repository conventions. Wire schemas and request params remain `taskId`.
- `procedure.ts` currently returns only `CallToolResult` for `tools/call`. Widening it makes `context-client/src/client.ts` fail type checking before the waiting task. Add a temporary task-result error guard in the protocol task, then replace it with waiting.
- The HTTP bearer gate already returns `{ authInfo, response }`. Pass that existing value through `serveHTTP` and `HTTPHandler`, rather than introducing another verification path.
- `AuthInfo.expiresAt` is in JWT seconds. Convert to milliseconds when arming a listen expiry timer.
- `.changeset/` already has pending intents. `pnpm change status` may show other changes; verify this intent contributes a minor fixed-group bump.

## File map

| Area | Files and responsibility |
| --- | --- |
| Protocol | `packages/context-protocol/src/versions/2026-07-28.ts`, `versions/index.ts`, `procedure.ts`, `server.ts`, `subscriptions.ts`, `index.ts` -- task schemas, exports, revision guards |
| Store | `packages/context-server/src/task-store.ts` -- JSON record, CAS contract, memory implementation |
| Manager | `packages/context-server/src/task-manager.ts` -- workers, input, expiry, recovery and status events |
| Server | `packages/context-server/src/definitions.ts`, `types.ts`, `server.ts`, `mrtr.ts`, `discover.ts`, `subscriptions.ts`, `index.ts` -- handler context, finalisation, methods, listeners |
| HTTP server | `packages/http-server/src/serve.ts`, `handler.ts`, `stateless.ts`, `subscriptions.ts`, `auth/{verifier,jwks-verifier,did-verifier}.ts` -- verified identity threading |
| Client | `packages/context-client/src/client.ts`, `task-waiter.ts`, `errors.ts`, `index.ts` -- waits, handles and errors |
| HTTP client | `packages/http-client/src/transport.ts` -- `Mcp-Name` task routing |
| Evidence | Existing package `test/` directories and `integration-tests/{support/interop,suites}/` -- unit and cross-stack tests |
| Records | `docs/agents/architecture.md`, migration milestone, two READMEs, `.changeset/*.md` |

## Review Focus

- Duplicate or stale input keys -- the server must ignore stale updates and reject reused issued keys. Exercise in Task 6.
- Concurrent partial updates and settlement -- every accepted response must survive CAS retries and a terminal state must win. Exercise in Tasks 2 and 4.
- A listen accepted just before token expiry -- it must close before a later task event. Exercise in Task 8.
- A notification for another task -- the waiter must ignore it and still finish its own task. Exercise in Task 9.
- A completed task with no cached output schema -- waiting must return its result without fetching `tools/list`. Exercise in Task 9.

---

### Task 1: Protocol schema and typed routing

**Files:** Modify `packages/context-protocol/src/versions/2026-07-28.ts`, `src/versions/index.ts`, `src/procedure.ts`, `src/server.ts`, `src/subscriptions.ts`, `src/index.ts`; test `packages/context-protocol/test/versions.test.ts`; modify `packages/context-client/src/client.ts` for the temporary guard.

**Interfaces:** Consumes existing MRTR `inputRequest`, `inputResponses`, `withProtocolMeta`, `forbidRetryParams`, `ClientRequests`, and `PROTOCOL.wrapResult`. Produces `TASKS_EXTENSION`, `TaskStatus`, `Task`, `DetailedTask`, `CreateTaskResult`, `TasksGetRequest`, `TasksUpdateRequest`, `TasksCancelRequest`, `TasksGetResult`, `TasksAcknowledgement`, `TaskNotification`, `isCreateTaskResult(value: unknown): value is CreateTaskResult`, and `declaresTasksExtension(capabilities: ClientCapabilities | undefined): boolean`.

Use these discriminants and payload shapes. Derive full requests from JSON-RPC schemas:

```ts
type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled'
type TasksGetParams = { taskId: string }
type TasksUpdateParams = { taskId: string; inputResponses: Record<string, InputResponse> }
type TasksCancelParams = { taskId: string }
type CreateTaskResult = Task & { resultType: 'task' }
type TasksGetResult = DetailedTask & { resultType: 'complete' }
type TasksAcknowledgement = { resultType: 'complete' }
```

- [ ] **Step 1: Write failing protocol tests.** In `versions.test.ts`, assert every detailed status shape, required timestamps and `ttlMs`, the three request shapes, `tasks/update` rejecting `requestState`, closed task results, notification shape, subscription `taskIds`, and revision-specific rejection. Assert `clientMethods` and `wrapResult` preserve `'task'`. Add compile-time assignments for all three `ClientRequests` entries.

Add this complete discriminant test alongside the status and request cases:

```ts
test('preserves a task result on 2026-07-28 only', () => {
  const frame = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      taskId: crypto.randomUUID(),
      status: 'working',
      createdAt: '2026-09-29T12:00:00.000Z',
      lastUpdatedAt: '2026-09-29T12:00:00.000Z',
      ttlMs: 3_600_000,
      resultType: 'task',
    },
  }
  const current = createValidator(PROTOCOLS['2026-07-28'].serverMessage)
  const previous = createValidator(PROTOCOLS['2025-11-25'].serverMessage)
  expect(current(frame).issues).toBeUndefined()
  expect(previous(frame).issues).toBeDefined()
  expect(
    PROTOCOLS['2026-07-28'].wrapResult(frame.result, {
      serverInfo: { name: 'test', version: '1.0.0' },
    }).resultType,
  ).toBe('task')
})
```
- [ ] **Step 2: Run the red test.** Run: `pnpm --filter @mokei/context-protocol test`. Expected: failing task-schema assertions.
- [ ] **Step 3: Implement the schemas and exports.** Use `rpc.ts`'s existing `error` schema for failed tasks and MRTR schemas for input maps. Define each task request beside `clientRequest`. For `tasks/update`, use `withProtocolMeta` with a `not: { required: ['requestState'], type: 'object' }` params branch. Add `createTaskResult` as a closed result member; keep `subscriptionsListenResult`'s special unwrapped result. Widen `tools/call` in `ClientRequests` and both cross-revision server aggregates. Include the task method only for `2026-07-28`.
- [ ] **Step 4: Keep the client compiling during staged work.** In `callTool`, detect `isCreateTaskResult(result)` and throw `RPCError({ code: INTERNAL_ERROR, message: 'Task waiting is unavailable' })`. Replace this guard in Task 10.
- [ ] **Step 5: Verify.** Run: `pnpm --filter @mokei/context-protocol build` then `pnpm --filter @mokei/context-protocol test` then `pnpm --filter @mokei/context-client test`. Expected: all commands exit 0; `2025-11-25` task frames fail validation.
- [ ] **Step 6: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/context-protocol packages/context-client/src/client.ts && git commit -m "feat: define MCP task protocol"`.

### Task 2: Task store and compare-and-swap

**Files:** Create `packages/context-server/src/task-store.ts`, `packages/context-server/test/task-store.test.ts`; modify `packages/context-server/src/index.ts`.

**Interfaces:** Consumes protocol `TaskStatus`, `InputRequest`, `InputResponse`, `CallToolResult`, `ClientCapabilities`. Produces `TaskRecord` with `taskID`, integer `revision`, wire state, `owner?: TaskOwner`, `toolName`, capabilities, optional JSON `resumeData`, `issuedInputKeys`; `TaskStore` with `create`, `get(taskID)`, `update(taskID, patch, { revision })`, `delete`, `list({ status })`; `TaskStoreConflictError`; `createMemoryTaskStore(): TaskStore`.

Define the store boundary exactly:

```ts
type JSONValue = null | boolean | number | string | Array<JSONValue> | { [key: string]: JSONValue }
type TaskOwner = { issuer?: string; subject: string; scopes: Array<string> }
type TaskRecord = {
  taskID: string
  revision: number
  status: TaskStatus
  statusMessage?: string
  createdAt: string
  lastUpdatedAt: string
  ttlMs: number | null
  pollIntervalMs?: number
  owner?: TaskOwner
  toolName: string
  clientCapabilities: ClientCapabilities
  resumeData?: JSONValue
  result?: CallToolResult & { resultType: 'complete' }
  error?: { code: number; message: string; data?: unknown }
  inputRequests?: Record<string, InputRequest>
  inputResponses?: Record<string, InputResponse>
  issuedInputKeys: Array<string>
}
type TaskStore = {
  create(record: TaskRecord): Promise<void>
  get(taskID: string): Promise<TaskRecord | undefined>
  update(
    taskID: string,
    patch: Partial<TaskRecord>,
    expected: { revision: number },
  ): Promise<TaskRecord>
  delete(taskID: string): Promise<void>
  list(filter: { status: Array<TaskStatus> }): Promise<Array<TaskRecord>>
}
```

- [ ] **Step 1: Write failing store tests.** Test creation, JSON round-trip, status-filtered list, deletion, a stale revision rejecting with `TaskStoreConflictError`, and successful update returning `revision + 1`. Test two writes from revision 0: exactly one succeeds.

Use this complete CAS test in `task-store.test.ts`:

```ts
test('rejects an update based on a stale revision', async () => {
  const store = createMemoryTaskStore()
  await store.create({
    taskID: crypto.randomUUID(),
    revision: 0,
    status: 'working',
    createdAt: '2026-09-29T12:00:00.000Z',
    lastUpdatedAt: '2026-09-29T12:00:00.000Z',
    ttlMs: 3_600_000,
    toolName: 'echo',
    clientCapabilities: {},
    issuedInputKeys: [],
  })
  const [record] = await store.list({ status: ['working'] })
  const changed = await store.update(record.taskID, { statusMessage: 'running' }, { revision: 0 })
  expect(changed.revision).toBe(1)
  await expect(
    store.update(record.taskID, { statusMessage: 'stale' }, { revision: 0 }),
  ).rejects.toBeInstanceOf(TaskStoreConflictError)
})
```
- [ ] **Step 2: Run red.** Run: `pnpm --filter @mokei/context-server test`. Expected: missing store exports or failing assertions.
- [ ] **Step 3: Implement the store.** Use a `Map<string, TaskRecord>` and copy records at the boundary so callers cannot bypass CAS by mutation. Reject duplicate IDs and missing update targets with explicit errors. Store records as JSON-compatible values. Define `TaskOwner = { issuer?: string; subject: string; scopes: Array<string> }`.
- [ ] **Step 4: Verify.** Run: `pnpm --filter @mokei/context-server test`. Expected: all tests pass, including a stale write conflict.
- [ ] **Step 5: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/context-server/src/task-store.ts packages/context-server/src/index.ts packages/context-server/test/task-store.test.ts && git commit -m "feat: add task store with atomic updates"`.

### Task 3: Shared tool finalisation

**Files:** Create `packages/context-server/src/tool-outcome.ts`, `packages/context-server/test/tool-outcome.test.ts`; modify `packages/context-server/src/definitions.ts`, `src/server.ts`, `src/index.ts`.

**Interfaces:** Consumes `GenericToolDefinition`, `CallToolResult`, `RPCError` and existing `ToolOutputValidationError`. Produces `settleToolOutcome(tool: GenericToolDefinition, outcome: { result: CallToolResult } | { error: unknown }): { result: CallToolResult } | { error: { code: number; message: string; data?: unknown } }`. Task 4 uses this for detached and recovered workers.

- [ ] **Step 1: Write failing seam tests.** Assert valid structured output, missing or invalid structured output, ordinary thrown tool errors, and thrown `RPCError({ code: -32021, message: 'Missing capability', data: { requiredCapabilities: {} } })` retain their correct result or error category.
- [ ] **Step 2: Run red.** Run: `pnpm --filter @mokei/context-server test`. Expected: missing seam export or failing assertions.
- [ ] **Step 3: Move finalisation.** Move `finalizeResult` out of `createTool` into `settleToolOutcome`. Keep input validation in `createTool`. Retain raw tool definitions in `ContextServer` so both normal and recovered calls use the output schema. Preserve the synchronous path's current error behaviour; a protocol `RPCError` is always a JSON-RPC error.
- [ ] **Step 4: Verify.** Run: `pnpm --filter @mokei/context-server test`. Expected: seam tests and existing tool tests pass.
- [ ] **Step 5: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/context-server/src packages/context-server/test/tool-outcome.test.ts && git commit -m "refactor: share tool outcome finalisation"`.

### Task 4: Manager lifecycle, expiry and recovery

**Files:** Create `packages/context-server/src/task-manager.ts`, `packages/context-server/test/task-manager.test.ts`; modify `packages/context-server/src/index.ts`.

**Interfaces:** Consumes Task 2's store and owner types, Task 3's `settleToolOutcome`, protocol task types and `missingInputCapabilities`. Produces `TaskManagerParams = { store?: TaskStore; ttlMs?: number; pollIntervalMs?: number; recover?: (record: TaskRecord, resume: TaskResume) => Promise<void> | void; now?: () => number }`, `TaskHandle` (`taskID`, `signal`, `setStatus`, `requestInput`, `awaitInput`), `TaskContext.run(work, options?)`, `TaskManager` (`events`, `create`, `get`, `update`, `cancel`, `canAccess`, `recover(tools)`, `dispose`), and `createTaskManager(params?: TaskManagerParams): TaskManager`. The optional clock is internal test injection; document the public defaults as 3,600,000 and 1,000 ms.

Use one contract for live and recovered workers:

```ts
type TaskWork = (handle: TaskHandle) => CallToolResult | Promise<CallToolResult>
type TaskHandle = {
  taskID: string
  signal: AbortSignal
  setStatus(message: string): Promise<void>
  requestInput(requests: Record<string, InputRequest>): Promise<Record<string, InputResponse>>
  awaitInput(): Promise<Record<string, InputResponse>>
}
type TaskResume = (work: TaskWork) => Promise<void>
type TaskContext = {
  run(work: TaskWork, options?: { resumeData?: JSONValue }): Promise<CreateTaskResult>
}
type TaskManager = {
  events: EventsSource<{ taskStatus: DetailedTask }>
  create(params: {
    toolName: string
    tool: GenericToolDefinition
    clientCapabilities: ClientCapabilities
    owner?: TaskOwner
    work: TaskWork
    resumeData?: JSONValue
  }): Promise<CreateTaskResult>
  get(taskID: string, owner?: TaskOwner): Promise<DetailedTask>
  update(
    taskID: string,
    responses: Record<string, InputResponse>,
    owner?: TaskOwner,
  ): Promise<void>
  cancel(taskID: string, owner?: TaskOwner): Promise<void>
  canAccess(taskID: string, owner?: TaskOwner): Promise<boolean>
  recover(tools: ToolDefinitions): Promise<void>
  dispose(): Promise<void>
}
```

- [ ] **Step 1: Write failing lifecycle tests.** Use a controlled clock and deferred workers. Assert durable create precedes handle return; UUID format; status event and timestamps; cancel aborts signal; TTL expires from `createdAt` on access and sweep; pending input rejects on abort; dispose leaves records for recovery. Assert `setStatus` racing completion and two partial updates converge after conflicts.
- [ ] **Step 2: Run red.** Run: `pnpm --filter @mokei/context-server test`. Expected: missing manager API or failing transitions.
- [ ] **Step 3: Implement worker and CAS state machine.** Keep controllers and pending-input deferred values in the manager. Retry mutations after `TaskStoreConflictError`. Stop only when the latest record is terminal or missing. Emit detailed snapshots after committed transitions. Use an `unref` sweep timer in Node where supported. Ignore detached work results after cancel, expiry or dispose.
- [ ] **Step 4: Write failing restart tests.** Seed a persistent test store with `working` and `input_required` records. Assert hidden records before `recover(tools)`, successful `resume(work)`, `awaitInput()` on preserved requests, missing tool, missing/throwing callback and the exact `-32603` interrupted error. Assert a manager without a callback fails persisted records during its startup work.
- [ ] **Step 5: Implement recovery.** Await initial store scan through a manager readiness promise before every public access. Keep records inaccessible until recovery callback returns with a resumed worker. Settle unrecovered records to `{ code: -32603, message: 'Task interrupted by server restart' }`. The recovered worker uses its named tool and the same outcome seam as a live worker.
- [ ] **Step 6: Verify.** Run: `pnpm --filter @mokei/context-server test`. Expected: all task manager and existing server tests pass.
- [ ] **Step 7: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/context-server/src/task-manager.ts packages/context-server/src/index.ts packages/context-server/test/task-manager.test.ts && git commit -m "feat: manage durable task workers and recovery"`.

### Task 5: Tool task context and server wiring

**Files:** Modify `packages/context-server/src/types.ts`, `src/definitions.ts`, `src/server.ts`, `src/index.ts`, `test/mrtr.test.ts`; create `packages/context-server/test/tasks-context.test.ts`.

**Interfaces:** Consumes `TaskContext` and manager from Task 4, and the outcome seam from Task 3. Produces `HandlerRequest.task?: TaskContext`. `ContextServer` accepts `tasks?: TaskManager` and supplies task context only for a declared `tools/call` on `2026-07-28`.

- [ ] **Step 1: Write failing tests.** Assert task context presence requires manager, task declaration and `tools/call`. Assert a task result without context fails `-32603`. Exercise normal result, output-schema failure, thrown tool error and thrown `RPCError` through the same seam for inline and detached work. Assert stored successful results carry `resultType: 'complete'` and task creation skips cache hints. Assert `server/discover` advertises the extension exactly when `tasks` is configured.
- [ ] **Step 2: Run red.** Run: `pnpm --filter @mokei/context-server test`. Expected: failing context and outcome assertions.
- [ ] **Step 3: Wire handler types.** Pass `InputRequiredResult` and `CreateTaskResult` through `createTool` unchanged. Add `HandlerRequest.task`. Keep the tool definition map established in Task 3 so detached work uses its output schema. Advertise `capabilities.extensions[TASKS_EXTENSION] = {}` when a manager exists.
- [ ] **Step 4: Wire task creation.** In `_handleRequest`, add a task branch beside MRTR with method/capability guards, `wrapResult`, and no `applyCacheHints`. Pass task context into `#callTool`. Keep the manager-owned worker signal independent of the request signal. Prevent `liftRetryParams` for `tasks/update` in `mrtr.ts` or its call site.
- [ ] **Step 5: Verify.** Run: `pnpm --filter @mokei/context-server test`. Expected: existing MRTR tests and new settlement tests pass.
- [ ] **Step 6: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/context-server/src packages/context-server/test && git commit -m "feat: settle task and inline tool outcomes consistently"`.

### Task 6: Task methods and input responses

**Files:** Modify `packages/context-server/src/server.ts`, `src/task-manager.ts`, `src/mrtr.ts`; create `packages/context-server/test/tasks-methods.test.ts`.

**Interfaces:** Consumes manager access and task context from Tasks 4-5. Produces dispatch for `tasks/get`, `tasks/update`, `tasks/cancel`; `requireTasksExtension(capabilities)` raising `-32021` with `data.requiredCapabilities.extensions[TASKS_EXTENSION] = {}`; task access failure `RPCError({ code: -32602, message: 'Task not found' })`.

- [ ] **Step 1: Write failing request tests.** Drive real `_handleRequest` frames with decorated `2026-07-28` metadata. Assert `-32601` without manager; `-32021` before lookup without declaration; `-32602` for missing IDs; `tasks/get` detailed result; update and cancel empty acknowledgements. Prove `tasks/update.inputResponses` reaches its handler and `requestState` fails schema validation.
- [ ] **Step 2: Run red.** Run: `pnpm --filter @mokei/context-server test`. Expected: task methods fail.
- [ ] **Step 3: Implement dispatch and input handling.** Map wire `taskId` to manager `taskID`. Validate each currently outstanding response against its request method. Ignore unknown, stale and already satisfied keys. Merge partial maps with CAS. On every `requestInput`, reject lifetime key reuse, apply MRTR capability checks before persistence, and restore `working` only after every key arrives. Treat terminal updates and cancels as acknowledged no-ops.
- [ ] **Step 4: Add race and failure tests.** Assert two partial updates both land, wrong response kind is `-32602`, stale keys are ignored, reused keys reject, undeclared input capability stores `failed.error.code === -32021`, and cancel versus completion follows first committed transition.
- [ ] **Step 5: Verify.** Run: `pnpm --filter @mokei/context-server test`. Expected: all new and existing tests pass.
- [ ] **Step 6: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/context-server/src packages/context-server/test/tasks-methods.test.ts && git commit -m "feat: serve task status input and cancellation"`.

### Task 7: Owner binding and HTTP auth threading

**Files:** Modify `packages/context-server/src/server.ts`, `src/task-manager.ts`, `src/types.ts`; `packages/http-server/src/serve.ts`, `src/handler.ts`, `src/stateless.ts`, `src/subscriptions.ts`, `src/auth/verifier.ts`, `src/auth/jwks-verifier.ts`, `src/auth/did-verifier.ts`; tests `packages/context-server/test/tasks-methods.test.ts`, `packages/http-server/test/serve-auth.test.ts`, `test/handler.test.ts`.

**Interfaces:** Consumes Task 2's `TaskOwner`. Produces `AuthInfo.issuer?: string`, `HTTPHandler.handleRequest(request, options?: { auth?: AuthInfo })`, and `HTTPHandlerParams.createServer({ transport, subscriptionHub?, connectionID?, tasks?, auth? })`. Server handler requests gain `auth?: { issuer?: string; subject: string; scopes: Array<string> }`.

- [ ] **Step 1: Write failing identity tests.** Assert creating auth is stored; subject mismatch, issuer mismatch and reduced scopes each yield `Task not found`; owned and ownerless tasks never cross-access. Assert JWKS and DID verifiers expose the verified `iss` as `issuer` and custom verifiers without it remain supported.
- [ ] **Step 2: Run red.** Run: `pnpm --filter @mokei/context-server test` then `pnpm --filter @mokei/http-server test`. Expected: identity assertions fail.
- [ ] **Step 3: Thread verified auth.** Pass the bearer gate's `authInfo` into `handler.handleRequest`. Thread `auth` and `tasks` through stateless and listen server factories. Keep the manager and hub caller-owned. Attach auth only after verification; never read identity from unverified request headers. Require same issuer and subject and a superset of creating scopes.
- [ ] **Step 4: Verify.** Run: `pnpm --filter @mokei/context-server build` then `pnpm --filter @mokei/context-server test` then `pnpm --filter @mokei/http-server test`. Expected: all tests pass.
- [ ] **Step 5: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/context-server packages/http-server && git commit -m "feat: bind task access to verified HTTP identity"`.

### Task 8: Task notifications and subscription hub

**Files:** Modify `packages/context-server/src/subscriptions.ts`, `src/server.ts`, `src/task-manager.ts`; create `packages/context-server/test/tasks-subscriptions.test.ts`; modify `packages/http-server/test/handler-subscriptions.test.ts`.

**Interfaces:** Consumes manager `events.taskStatus`, `canAccess`, listener auth and protocol `taskIds`. Produces `createSubscriptionHub({ events, tasks? })`, accepted-ID acknowledgements and `notifications/tasks` for accepted IDs only.

- [ ] **Step 1: Write failing listen tests.** Assert missing task capability gives `-32021` before acknowledgement. Assert a mixed filter acknowledges only accessible IDs. Assert no notification leaks for rejected IDs, accepted IDs receive detailed snapshots, and the acknowledgement precedes delivery. Use fake time to prove a verified listen closes at `auth.expiresAt` before later status changes.
- [ ] **Step 2: Run red.** Run: `pnpm --filter @mokei/context-server test`. Expected: task listen assertions fail.
- [ ] **Step 3: Implement hub routing.** Record accepted IDs and auth in `SubscriptionEntry`. Check access before writing the acknowledgement. Subscribe once to manager `taskStatus` and fan out through existing `SubscriptionWriter`. Close authenticated entries at JWT-second expiry, clear timers on every teardown, and keep unrelated resource subscriptions intact.
- [ ] **Step 4: Verify.** Run: `pnpm --filter @mokei/context-server build` then `pnpm --filter @mokei/context-server test` then `pnpm --filter @mokei/http-server test`. Expected: all tests pass; no task event reaches an unauthorised listen.
- [ ] **Step 5: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/context-server packages/http-server/test/handler-subscriptions.test.ts && git commit -m "feat: stream authorised task status notifications"`.

### Task 9: Client task waiting

**Files:** Create `packages/context-client/src/task-waiter.ts`, `packages/context-client/test/task-waiter.test.ts`; modify `packages/context-client/src/client.ts`, `src/errors.ts`, `src/index.ts`.

**Interfaces:** Consumes `ContextClient.request`, `#openListen` via an injected `OpenListen`, existing `#fulfilInputRequest`, `RPCError`, and protocol task types. Produces `TaskCancelledError`, `TaskInputUnavailableError`, `waitForTask({ taskID, signal?, onStatus?, toolName?, cancelOnAbort }) : Promise<CallToolResult>` and a reference-counted per-task listen registry. The waiter accepts request, listen, fulfil and validator callbacks from `ContextClient`; it does not reuse the resource `SubscriptionDriver`.

- [ ] **Step 1: Write failing waiter tests.** Test polling terminal completion, accepted listen plus immediate `tasks/get`, unavailable or omitted-ID listen fallback, dropped accepted listen fallback, concurrent waits sharing one listen, 250 ms polling floor, and foreign `taskId` snapshots ignored.
- [ ] **Step 2: Run red.** Run: `pnpm --filter @mokei/context-client test`. Expected: waiter tests fail.
- [ ] **Step 3: Implement listen and polling state.** Open `subscriptions/listen` with `taskIds: [taskID]` through `_registerStreamExchange`. Keep it separate from resource subscriptions. Reference-count same-ID waiters and close on last release. Poll with abortable delays; retain the latest observed input requests.
- [ ] **Step 4: Add outcome and input tests.** Assert `completed` returns result, `failed` throws `RPCError` with code/data, `cancelled` throws `TaskCancelledError`, missing handler throws `TaskInputUnavailableError`, and duplicate key snapshots invoke a handler once. Assert `tasks/update` sends only latest outstanding keys and `onStatus` receives accepted snapshots. Assert cached tool validation runs only with a known `toolName`, and no schema fetch occurs when uncached.
- [ ] **Step 5: Implement outcomes.** Delegate input fulfilment to the existing MRTR handler method. Deduplicate `(taskID, key)` across polls, notifications and waiters, including in-flight keys. Reuse `callTool`'s cached output validator. Convert stored errors with `new RPCError({ code, message, data })`.
- [ ] **Step 6: Verify.** Run: `pnpm --filter @mokei/context-client test`. Expected: all waiter and existing MRTR/subscription tests pass.
- [ ] **Step 7: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/context-client && git commit -m "feat: wait for tasks by listen or polling"`.

### Task 10: Client handle API and automatic call waiting

**Files:** Modify `packages/context-client/src/client.ts`, `src/index.ts`, `src/errors.ts`; create `packages/context-client/test/tasks-client.test.ts`; modify `test/mrtr.test.ts`.

**Interfaces:** Consumes Task 9's waiter. Produces `client.tasks.get(taskID)`, `update(taskID, inputResponses)`, `cancel(taskID)`, `wait(taskID, { signal?, onStatus?, toolName? })`; `callTool` overloads for default, `task: 'handle'`, `allowInputRequired: true`, and both flags.

- [ ] **Step 1: Write failing API tests.** Assert `2026-07-28` requests declare `extensions[TASKS_EXTENSION] = {}` while `2025-11-25` requests do not. Assert `task` is removed from wire params, all overload combinations compile, MRTR can precede task creation, and default `callTool` returns only a final result. Assert explicit handle mode returns `CreateTaskResult`.
- [ ] **Step 2: Run red.** Run: `pnpm --filter @mokei/context-client test`. Expected: API tests fail.
- [ ] **Step 3: Implement the API.** Add the extension declaration only after revision resolution, including setup discovery and per-request decoration. Remove `task` before `splitRequestOptions` so `context-rpc` remains unchanged. Replace Task 1's temporary guard with automatic wait after the existing MRTR loop. Keep `allowInputRequired` behaviour unchanged. Expose `tasks` through a getter backed by one stable handle object.
- [ ] **Step 4: Write abort and validation tests.** Assert automatic wait cancels the server task on caller abort and missing input handler. Assert `tasks.wait` abort only stops the waiter. Assert output validation runs when `tools/list` cached a validator and skips it otherwise, with and without explicit `toolName`.
- [ ] **Step 5: Verify.** Run: `pnpm --filter @mokei/context-client test`. Expected: all client tests pass and the default overload remains `Promise<CallToolResult>`.
- [ ] **Step 6: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/context-client && git commit -m "feat: expose task handles and automatic tool waiting"`.

### Task 11: HTTP client task name header

**Files:** Modify `packages/http-client/src/transport.ts`, `packages/http-client/test/transport.test.ts`.

**Interfaces:** Consumes protocol `tasks/*` request methods and existing `MCP_NAME_HEADER_SOURCE`. Produces `Mcp-Name` from wire `params.taskId` for get, update and cancel.

- [ ] **Step 1: Write failing transport tests.** For each task method, send a request with `taskId: 'task-1'` and assert `Mcp-Name: task-1`. Assert no name is inherited for an unrelated method.
- [ ] **Step 2: Run red.** Run: `pnpm --filter @mokei/http-client test`. Expected: the three task headers are absent.
- [ ] **Step 3: Implement the map entries.** Add the three `['tasks/...', 'taskId']` entries; retain `encodeHeaderValue`.
- [ ] **Step 4: Verify.** Run: `pnpm --filter @mokei/http-client test`. Expected: all header and transport tests pass.
- [ ] **Step 5: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/http-client && git commit -m "feat: route HTTP task requests by task ID"`.

### Task 12: Mokei integration over stdio and HTTP

**Files:** Create `integration-tests/support/interop/tasks-fixture.ts`, `integration-tests/support/interop/mokei-stdio-server-tasks.ts`, `integration-tests/suites/tasks.test.ts`; modify `integration-tests/support/interop/servers.ts`.

**Interfaces:** Consumes all prior task APIs and existing MRTR/HTTP fixture helpers. Produces executable mokei-to-mokei coverage over both transports.

- [ ] **Step 1: Write failing integration tests.** Use one fixture for completion, elicitation input and cancellation. Assert default `callTool` returns final content; handle mode exposes `taskId`; a listen receives `notifications/tasks`; `tasks/get` succeeds after the creating HTTP POST server has been disposed. Add bearer-auth assertions for another subject's `Task not found` and omitted listen ID.
- [ ] **Step 2: Build and run red.** Run: `pnpm build` then `pnpm --filter mokei-integration-tests test -- tasks.test.ts`. Expected: fixture or behaviour tests fail.
- [ ] **Step 3: Implement fixtures and resolve integration defects.** Reuse `servers.ts` patterns and existing auth test fixtures. Create the process-owned manager before `createServer`, pass it to every POST server, and dispose it after the HTTP handler. Keep the tool's work controlled with deferred promises so POST disposal is asserted before completion.
- [ ] **Step 4: Verify.** Run: `pnpm build` then `pnpm --filter mokei-integration-tests test -- tasks.test.ts`. Expected: all new stdio, HTTP and auth cases pass.
- [ ] **Step 5: Commit.** Run `rtk proxy pnpm run lint`, then `git add integration-tests && git commit -m "test: cover tasks across mokei transports"`.

### Task 13: SDK Tasks adapter interoperability

**Controller pre-step:** Install pinned `@modelcontextprotocol/ext-tasks@0.1.0` before this task. Add `@modelcontextprotocol/ext-tasks: 0.1.0` to `pnpm-workspace.yaml` and `"@modelcontextprotocol/ext-tasks": "catalog:"` to `integration-tests/package.json`; update the lockfile with pnpm. The catalog entry is absent today. Keep SDK packages at 2.1.0.

**Files:** Create `integration-tests/support/interop/sdk-tasks-fixture.ts`, `integration-tests/suites/interop-tasks.test.ts`; modify `integration-tests/support/interop/servers.ts` and, if required by the inspected adapter, create `integration-tests/support/interop/sdk-stdio-server-tasks.ts`.

**Interfaces:** Consumes the installed adapter API and Task 12's mokei fixture. Produces SDK client to mokei server tests over stdio and HTTP.

- [ ] **Step 1: Inspect the installed adapter API.** Run `rg -n 'export|task|dispatch|request' node_modules/.pnpm/@modelcontextprotocol+ext-tasks@0.1.0*/node_modules/@modelcontextprotocol/ext-tasks -g '*.d.ts' -g '*.md'`. Expected: concrete 0.1.0 adapter entry points and V2 raw-dispatch/request-framing guidance. Build the fixture from those signatures before writing calls; do not guess them or fetch schema material.
- [ ] **Step 2: Write failing interop tests.** Register the SDK client's task extension with the inspected adapter API and its declared capability. Assert task creation, status, final result, elicitation input, cancellation and task listen against the same mokei fixture over stdio and HTTP.
- [ ] **Step 3: Build and run red.** Run: `pnpm build` then `pnpm --filter mokei-integration-tests test -- interop-tasks.test.ts`. Expected: new interop tests fail on a diagnosed adapter or mokei behaviour.
- [ ] **Step 4: Implement the fixture and fix actual defects.** Use the adapter's raw dispatch and request framing if its 0.1.0 declarations require them. Diagnose failures with captured wire frames. Fix mokei behaviour where it violates the spec; correct fixture usage where the adapter contract was misread.
- [ ] **Step 5: Verify.** Run: `pnpm build` then `pnpm --filter mokei-integration-tests test -- interop-tasks.test.ts`. Expected: all SDK stdio and HTTP cases pass.
- [ ] **Step 6: Commit.** Run `rtk proxy pnpm run lint`, then `git add pnpm-workspace.yaml pnpm-lock.yaml integration-tests && git commit -m "test: verify SDK Tasks extension interoperability"`.

### Task 14: Architecture and package documentation

**Files:** Modify `docs/agents/architecture.md`, `docs/agents/plans/completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md`, `packages/context-server/README.md`, `packages/context-client/README.md`.

**Interfaces:** Consumes implemented manager, store, handler, wait and recovery APIs. Produces durable usage guidance without links to ephemeral `docs/superpowers/` files.

- [ ] **Step 1: Write documentation.** Add a tasks section to architecture covering application ownership, CAS, owner rules and client waiting. Correct the milestone's “mokei never implemented them” statement with a dated extension update. Show server manager creation, `await tasks.recover(tools)` before serving, stdio and HTTP ownership, `req.task.run`, automatic waiting, and `task: 'handle'` in the two READMEs.
- [ ] **Step 2: Verify examples against exports.** Run `rg -n 'createTaskManager|recover\(|task: .handle.|Task not found' docs/agents/architecture.md packages/context-{server,client}/README.md` and `pnpm build`. Expected: named APIs appear, and build exits 0. Check every example against the final declarations.
- [ ] **Step 3: Commit.** Run `rtk proxy pnpm run lint`, then `git add docs/agents/architecture.md docs/agents/plans/completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md packages/context-server/README.md packages/context-client/README.md && git commit -m "docs: explain MCP task ownership and waiting"`.

### Task 15: Minor release intent and full verification

**Files:** Create `.changeset/mcp-tasks-extension.md`.

**Interfaces:** Consumes all verified implementation and documentation. Produces one minor release intent for the fixed public package group.

- [ ] **Step 1: Create the intent.** Write `.changeset/mcp-tasks-extension.md` with the exact content below. Do not run `pnpm version -r`.

```markdown
---
'@mokei/context-protocol': minor
'@mokei/context-server': minor
'@mokei/context-client': minor
'@mokei/http-server': minor
'@mokei/http-client': minor
---

Add the MCP Tasks extension for 2026-07-28 with durable server tasks, task input and cancellation, authorised subscriptions, automatic client waiting, and HTTP routing.
```
- [ ] **Step 2: Check the release plan.** Run `pnpm change status`. Expected: this intent contributes a minor bump to the fixed public group; the private integration package is absent. Existing unrelated intents may also appear.
- [ ] **Step 3: Run final verification.** Run `rtk proxy pnpm run lint`, `pnpm build`, then `pnpm test`. Expected: every command exits 0. Check `git diff --check` and `git status --short` for unintended files.
- [ ] **Step 4: Commit.** Run `git add .changeset/mcp-tasks-extension.md && git commit -m "chore: record MCP Tasks minor release"`.

## Execution note

The controller commits during implementation. This planning turn creates only this plan file and makes no source changes or commits.
