# Task Input Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task input requests correct under withdrawal, cancellation, concurrent answers and crash recovery. The persisted input history becomes the only source of truth.

**Architecture:**
- `TaskRecord.inputs` replaces `inputRequests`, `inputResponses` and `issuedInputKeys`.
- Each transition (ask, answer, withdraw, terminal) is one CAS `#mutate` write.
- Waiters observe committed records through a per-task listener set. No pending deferred remains.
- The client `TaskWaiter` aborts a dispatch when the key it answers leaves the snapshot, and detects expiry.
- The decision-flow driver drops the `inputSeq` re-ask and replays expired deadlines through `requestInput`.

**Tech Stack:** TypeScript, vitest, pnpm workspace. Packages: `@mokei/context-server`, `@mokei/context-client`, `@mokei/decision-flow-server`.

**Spec:** `docs/superpowers/specs/2026-09-29-task-input-lifecycle-design.md`

## Global Constraints

- Base: branch `feat/task-input-lifecycle`, created from `feat/decision-flow-server` (PR #62).
- No migration and no legacy handling. Records in the old shape do not exist (tasks extension unreleased, no persistent store ships).
- At most one open input request per task. Input keys are unique per task.
- Error text, verbatim:
  - `Input is already outstanding`
  - `No input is outstanding`
  - `Input requests must not be empty`
  - PR #62 update rejection: code `-32602`, message `Task is not awaiting input for <key>`, `data: { key }`
- Error classes take a single params object and expose state through read-only getters. See `TaskCancelledError` in `packages/context-client/src/errors.ts`.
- Cross-package tests resolve the built `lib/` of dependencies. After changing `context-server` or `context-client`, run `pnpm --filter <pkg> build` before testing a dependent package.
- Lint: `rtk proxy pnpm exec biome check <paths>`. pnpm only.
- Changeset: patch only (0.14.x band).
- Kebab-case file names.

## Review Focus

1. **Manager disposal while a waiter is pending.** `dispose()` writes nothing, so the spec's steps 1–3 never fire. Expected: the waiter rejects with the dispose reason. Pinned in Task 1 (`dispose rejects pending waiters`).
2. **Withdraw write fails transiently.** Expected: the retry commits `withdrawn` and the waiter rejects with `InputRequestWithdrawnError`, never hangs. Pinned in Task 1 (`withdraw retries a failing store write`).
3. **Two concurrent `requestInput` calls with the same new request.** Expected: one `ask` commits; the other matches the same entry and waits on it. There is no `Input is already outstanding` and no key-reuse error. Pinned in Task 2 (the scheduler includes a duplicate `requestInput`).
4. **A multi-key `tasks/update` with one stale key.** Expected: the whole update is rejected, nothing is written, and no event is emitted. Pinned in Task 1's transition table.
5. **Client dispatch resolves after the wait is released.** Expected: no `tasks/update` is sent and no error surfaces. Pinned in Task 3 (`releasing the wait aborts the handler`).

---

### Task 1: Server input record, transitions and waiting

**Files:**
- Modify: `packages/context-server/src/task-store.ts` (the `TaskRecord` type)
- Modify: `packages/context-server/src/task-manager.ts` (rewrite the input paths, `#mutate`, `#expire`, `detailed`, `update`, `cancel`, `#cancelFromHandle`, `dispose`)
- Modify: `packages/context-server/src/index.ts` (export the new types and error)
- Test: `packages/context-server/test/task-manager.test.ts`, `test/task-store.test.ts`, `test/tasks-methods.test.ts`. Rewrite the fixtures that use the old fields.

**Interfaces:**
- Produces, from `task-store.ts`:
  ```ts
  export type InputRecord = {
    id: number
    requests: Record<string, InputRequest>
    responses: Record<string, InputResponse>
    outcome?: 'answered' | 'withdrawn'
  }
  // TaskRecord: remove inputRequests, inputResponses, issuedInputKeys; add
  inputs: Array<InputRecord>
  ```
- Produces, from `task-manager.ts`:
  ```ts
  export class InputRequestWithdrawnError extends Error {
    constructor(params: { taskID: string; id: number })
    get taskID(): string
    get id(): number
  }
  // message: `Input request ${id} for task ${taskID} was withdrawn`
  ```
  - `TaskHandle.requestInput` and `awaitInput` keep their signatures.
  - `TaskInputKeyReusedError` is unchanged.
- Exports: `InputRecord` and `InputRequestWithdrawnError` from `@mokei/context-server`.

**Rules the tests pin (from the spec, with this plan's rulings):**
- Latest request = `inputs.at(-1)`. It is open when `status === 'input_required'` and it has no `outcome`.
- `create` writes `inputs: []`.
- `#mutate` writes `lastUpdatedAt` as `max(now, Date.parse(stored) + 1)`, as ISO.
- After every committed write, `#mutate` fires `taskStatus` and calls the task's listeners with the committed record.
- `#expire` deletes the record, calls the listeners with `undefined`, then aborts.
- `detailed()`: with an open request, `inputRequests` is the unanswered keys of the latest entry. Otherwise there is no `inputRequests`.
- Cancel and other terminal writes leave `inputs` unchanged. Remove every `inputRequests: undefined` / `inputResponses: undefined` patch.
- `requestInput` does the lookup and `ask` inside one `#mutate` change callback, so a re-read reruns the lookup.
  - Same request: an entry whose key set equals `Object.keys(requests)` and `equalJSON(entry.requests, requests)`, whether open or settled.
  - Changed request: any key issued in any entry, with no same-request match. Throw `TaskInputKeyReusedError(key)`.
  - New request, with other checks in this order:
    - the signal is already aborted: throw `signal.reason` without writing;
    - the latest request is open: `Input is already outstanding`;
    - a missing client capability: the existing RPCError;
    - otherwise: ask.
- Withdraw on abort: withdraw is a no-op once the entry has an outcome.
  - A store error (not a conflict) triggers a retry with a backoff of 10 ms, doubling, capped at 1,000 ms.
  - Each failure fires `taskError`.
  - Stop when the entry settles, the task is terminal or deleted, or the manager is disposed.
- `waitForOutcome(taskID, id)` registers its listener before a single `store.get`, then checks the entry. Order:
  1. `answered`: resolve with `responses`.
  2. `withdrawn`: reject with `InputRequestWithdrawnError`.
  3. Terminal: reject with the worker controller's `signal.reason` if it is aborted, else `new Error('Task is no longer active')`.
  4. `undefined` (deleted): reject with `new Error('Task expired')`.
  - Ruling: the waiter also rejects when the worker's controller aborts. The reason is `signal.reason` (covers `dispose`).
- `awaitInput`: if a request is open, run `requestInput(latest.requests, options)`. Otherwise throw `No input is outstanding`.
- `update`: apply all keys in one write.
  - Each key needs: the latest request open, the key in its `requests`, the key not in its `responses`. Otherwise throw the PR #62 error for the first failing key.
  - A response of the wrong kind keeps the existing `Input response kind does not match <key>`.
  - When every key is answered, the same patch sets `outcome: 'answered'` and `status: 'working'`.
  - Empty `responses` write nothing.
- Delete `PendingInput`, `#pending`, `#attachInput`, `#listenForInputAbort` and `#resolveInput`, and the input-rejection branch of `#abort`.

- [ ] **Step 1: Write failing transition-table tests** in a new `describe('input transitions')` block in `test/task-manager.test.ts`. Each passing row asserts the committed record and one `taskStatus` event. Each failing row asserts the rejection, an unchanged `revision` and zero events.
  - `ask`:
    - passes: `inputs` is `[{ id: 1, requests: { ask: rootsRequest }, responses: {} }]` and the status is `input_required`;
    - fails when a request is open (`Input is already outstanding`);
    - fails when the key is issued with different contents (`TaskInputKeyReusedError`);
    - fails with an aborted signal (rejects with `signal.reason`, and `store.get` shows `inputs: []`).
  - `answer`:
    - a partial answer of a two-key request keeps the status `input_required`; `detailed().inputRequests` lists only the unanswered key;
    - the final answer sets `outcome: 'answered'` and the status `working`;
    - fails for an unknown key, an already answered key, a withdrawn request, a terminal task, and a multi-key update with one stale key. Each rejects with `-32602` and `data.key`, and writes nothing.
  - `withdraw`:
    - passes: aborting the signal gives `outcome: 'withdrawn'` and the status `working`, and the promise rejects with `InputRequestWithdrawnError` (`taskID`, `id: 1`);
    - no-op after `answered`.
  - `terminal`: cancelling with a request open leaves `inputs` unchanged, and the waiter rejects.
- [ ] **Step 2: Write failing waiting and lifecycle tests.**
  - `answer committed before a waiter registers still resolves it`: answer via `update`, then call `requestInput` with the same request. It resolves with the stored responses.
  - `requestInput replays a withdrawn request`: rejects with `InputRequestWithdrawnError`.
  - `lastUpdatedAt strictly increases under a frozen clock`: pass `now: () => fixed`. Three writes give three distinct increasing timestamps.
  - `expiry rejects an open waiter with Task expired`: a fake `now` passes TTL, then `get` triggers `#expire`.
  - `dispose rejects pending waiters`.
  - `withdraw retries a failing store write`: the store's `update` throws `new Error('Store unavailable')` twice on the withdraw patch. Assert that the waiter rejects with `InputRequestWithdrawnError`, `taskError` fires twice, and the final entry is `withdrawn`.
  - `awaitInput with no open request throws No input is outstanding`.
- [ ] **Step 3: Run and confirm the new tests fail.** Run `pnpm --filter @mokei/context-server exec vitest run test/task-manager.test.ts`. Expect FAIL, with type errors on `inputs`.
- [ ] **Step 4: Implement the record, transitions and waiting** as specified above. Rewrite the old-field fixtures in `task-manager.test.ts`, `task-store.test.ts` and `tasks-methods.test.ts` to the `inputs` shape, keeping each test's intent. Delete tests that assert behaviour the spec removes (pending-deferred ownership, the `Task input failed` path).
- [ ] **Step 5: Run the package tests.** Run `pnpm --filter @mokei/context-server test`. Expect all PASS, including `test:types`.
- [ ] **Step 6: Lint and commit.** Run `rtk proxy pnpm exec biome check packages/context-server`, then `git commit -m "feat(context-server): persisted task input lifecycle"`.

### Task 2: Interleaving scheduler and recovery tests

**Files:**
- Create: `packages/context-server/test/support/scheduled-store.ts`
- Create: `packages/context-server/test/task-input-interleavings.test.ts`
- Create: `packages/context-server/test/task-input-recovery.test.ts`
- Modify: `packages/context-server/src/task-manager.ts`, only to fix defects these tests expose

**Interfaces:**
- Consumes: Task 1's `InputRecord`, `InputRequestWithdrawnError` and `TaskHandle.requestInput`.
- Produces (test-only):
  ```ts
  export function createScheduledStore(seed: number): {
    store: TaskStore
    commits: Array<TaskRecord>        // every committed update, in commit order
    drain(): Promise<void>            // release queued ops in seeded random order until idle
  }
  ```
  - Every `get`, `update` and `delete` call queues until `drain` releases it.
  - The release order comes from a seeded PRNG (mulberry32).
  - Conflicts come from the reordering itself.

- [ ] **Step 1: Write the scheduler test** `task input invariants hold for seed %i`, over `SEEDS = Number(process.env.TASK_INPUT_SEEDS ?? 500)` seeds.
  - Operations per seed, started concurrently:
    - a worker `requestInput({ a, b })` with a signal;
    - a duplicate `requestInput` of the same request;
    - `update` of `a`;
    - `update` of `b`;
    - an abort of the signal;
    - `cancel`.
  - The seeded PRNG decides which of the last four run.
  - After each entry of `commits`:
    - `status === 'input_required'` exactly when the latest entry is open;
    - `detailed(record).inputRequests`, when present, is non-empty.
  - After `drain`:
    - every `requestInput` promise has settled;
    - each promise resolves with `responses` only when the final entry is `answered`;
    - it rejects with `InputRequestWithdrawnError` only when the entry is `withdrawn`;
    - otherwise the task is terminal.
  - On failure, the message includes the seed.
- [ ] **Step 2: Write the recovery tests.** Each test shares one `createMemoryTaskStore()` between two `createTaskManager({ store, recover })` instances. The first instance is disposed before the second calls `recover(tools)`, and the recovered worker calls `requestInput` with the same request. Tests:
  - `answered before restart replays the stored responses`;
  - `withdrawn before restart replays InputRequestWithdrawnError`;
  - `open at restart re-attaches and resolves on a later update`;
  - `changed request under an issued key throws TaskInputKeyReusedError`.
- [ ] **Step 3: Run.** `pnpm --filter @mokei/context-server exec vitest run test/task-input-interleavings.test.ts test/task-input-recovery.test.ts`. Fix any defect in `task-manager.ts` that a seed exposes. Record the seed and the fix in the commit body.
- [ ] **Step 4: Run the package suite and check the time.** Run `pnpm --filter @mokei/context-server test`; expect PASS. The 500-seed test must finish in under 30 s. If it does not, reduce per-seed work, not the seed count.
- [ ] **Step 5: Lint and commit.** Run `git commit -m "test(context-server): task input interleavings and recovery"`.

### Task 3: Client `TaskWaiter` withdrawal and expiry

**Files:**
- Modify: `packages/context-client/src/errors.ts`
- Modify: `packages/context-client/src/task-waiter.ts`
- Modify: `packages/context-client/src/index.ts`
- Test: `packages/context-client/test/task-waiter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class TaskInputWithdrawnError extends Error {
    constructor(params: { taskID: string; key: string; cause?: unknown })
    get taskID(): string
    get key(): string
  } // message: `Input request "${key}" for task ${taskID} was withdrawn`
  export class TaskExpiredError extends Error {
    constructor(params: { taskID: string; cause?: unknown })
    get taskID(): string
  } // message: `Task ${taskID} expired`
  // TaskWaiterParams gains: now?: () => number   (default Date.now)
  ```
  Both errors are exported from `@mokei/context-client`.

**Rules:**
- `TaskEntry` gains:
  - `taskID`;
  - `inFlight: Map<string, AbortController>`, one per dispatched key. The key's `fulfil` receives `AbortSignal.any([entry.controller.signal, own.signal])`.
- `#observe` returns `boolean`, true when the snapshot is accepted. On acceptance, abort each `inFlight` key missing from the new `entry.inputs` with `new TaskInputWithdrawnError({ taskID, key })`.
- A notification calls the status listeners only when `#observe` returned true. The `fromGet` path in `wait` calls `notifyStatus` only when it accepted the snapshot.
- Before `tasks/update`, submit only if the dispatch signal is not aborted and `Object.hasOwn(entry.inputs, key)`.
- In `.catch`, return without setting `inputError` when the dispatch signal is aborted. Delete the `inFlight` entry when the dispatch settles.
- Expiry, when the snapshot has a finite `ttlMs`:
  - The deadline is `Date.parse(createdAt) + ttlMs`.
  - Each wait stretch (`#waitForChange` or the poll delay) races a timer at `max(0, deadline - now())`.
  - When the timer wins, do `#get`.
  - A `tasks/get` rejection of `RPCError` code `-32602` with message `Task not found`, when `now() >= deadline`, throws `new TaskExpiredError({ taskID, cause })`.
  - A not-found before the deadline rethrows the original error.
  - This applies to every `#get` in the loop, not only the timer's.

- [ ] **Step 1: Write the failing tests** in `test/task-waiter.test.ts`:
  - `withdrawal aborts the handler with TaskInputWithdrawnError`:
    - `fulfil` holds until its signal aborts, and records `signal.reason`;
    - a newer `working` notification arrives;
    - expect the reason to be a `TaskInputWithdrawnError` with `key: 'ask'`, no `tasks/update`, and the wait still pending until `completed`.
  - `a late answer keeps the wait alive`:
    - `tasks/update` rejects with PR #62's `-32602` and `data.key`;
    - the re-read shows `working`, then `completed`;
    - the wait resolves.
  - `reversed snapshot delivery leaves a withdrawn dialog closed`:
    - deliver `working` (t2), then the older `input_required` (t1);
    - `fulfil` is called at most once, and its dispatch stays aborted;
    - `onStatus` never receives the t1 snapshot.
  - `expiry while subscribed fails with TaskExpiredError`: fake `now` and timers; after the deadline `tasks/get` rejects `Task not found`.
  - `expiry while polling fails with TaskExpiredError`: acknowledgement rejected, so the waiter polls.
  - `not found before the deadline keeps the original error`.
  - `releasing the wait aborts the handler`: aborting the wait's signal aborts `fulfil`'s signal, and no `tasks/update` is sent after `fulfil` resolves.
- [ ] **Step 2: Run and confirm failure.** `pnpm --filter @mokei/context-client exec vitest run test/task-waiter.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the rules above.
- [ ] **Step 4: Run the package tests.** `pnpm --filter @mokei/context-client test`; expect PASS. `tasks-client.test.ts` and `lib.test.ts` stay green.
- [ ] **Step 5: Lint and commit.** `git commit -m "feat(context-client): withdraw task input dispatches and detect expiry"`.

### Task 4: Decision-flow driver input recovery

**Files:**
- Modify: `packages/decision-flow-server/src/driver.ts`
- Modify: `packages/decision-flow-server/src/recovery.ts`
- Test: `packages/decision-flow-server/test/driver-input.test.ts`, `test/recovery.test.ts`

**Interfaces:**
- Consumes:
  - `InputRequestWithdrawnError` and `TaskInputKeyReusedError` from `@mokei/context-server`;
  - `TaskRecord.inputs` in test fixtures.
- Produces:
  - `startRun` loses its `outstandingInputRequests` parameter;
  - `recovery.ts` stops passing it;
  - `ResumeDataV1.inputSeq` stays optional and is read only.

**Rules:**
- Build the input request once per suspension, with the key `${runID}:${invocationID}:input:${resumeData.inputSeq ?? 0}` and the existing elicitation body. Both the live path and the replay path use it.
- **Deadline already passed** (`Date.now() >= deadline`): call `requestInput(request, { signal: AbortSignal.abort(expired) })`, where `expired = new Error('Input deadline expired')`.
  - Resolved: handle the responses as on the live path (`accept` gives the value; `decline` and `cancel` clean up, cancel the task and stop).
  - Rejected with `InputRequestWithdrawnError` or `expired`: event `timeout`.
  - Anything else: rethrow.
- **Live path:** remove the `TaskInputKeyReusedError` catch and the `inputSeq` increment. A reuse error propagates and fails the run.
  - On rejection:
    - `handle.signal.aborted`: `StopRun`, as today;
    - `deadlineController.signal.aborted` and the error is the deadline reason or an `InputRequestWithdrawnError`: `timeout`;
    - otherwise rethrow.
- Share the response handling between the two paths through one local function. Do not duplicate it.

- [ ] **Step 1: Rebuild the server.** Run `pnpm --filter @mokei/context-server build`.
- [ ] **Step 2: Write the failing tests** in `test/driver-input.test.ts`, one per driver change:
  - `expired deadline replays a stored answer`:
    - seed the record with an `answered` entry for the key;
    - `startRun` with the deadline in the past;
    - expect the flow to take the value edge.
  - `expired deadline with a request never issued takes the timeout edge`: expect no write to `inputs`.
  - `expired deadline with an open request withdraws it and takes the timeout edge`: the entry ends `withdrawn`.
  - `a reused key with changed contents fails the run`: the existing entry under the key has a different message; expect the task `failed`.
  - `a non-deadline rejection propagates`: the worker `requestInput` rejects with `new Error('boom')` before the deadline; expect the task `failed` with `boom`.
  - Replace `recovery reissues an already consumed input key with a checkpointed sequence`, which covers removed behaviour. Delete it.
  - Keep `real input deadline withdraws the request and a late answer cannot change the outcome`, updating its fixture read from `record.inputRequests` to `record.inputs.at(-1).requests`.
- [ ] **Step 3: Update `test/recovery.test.ts`** fixtures to the `inputs` shape. Remove the `incremented-outstanding` window cases, which covered the re-ask. Keep the open-request re-attach case and the stale-deadline case.
- [ ] **Step 4: Run and confirm failure, then implement.** Run `pnpm --filter @mokei/decision-flow-server exec vitest run test/driver-input.test.ts test/recovery.test.ts`: FAIL before the change, PASS after.
- [ ] **Step 5: Run the package tests.** `pnpm --filter @mokei/decision-flow-server test`; expect PASS.
- [ ] **Step 6: Lint and commit.** `git commit -m "feat(decision-flow-server): replay input outcomes on recovery"`.

### Task 5: Docs, changeset, full verification

**Files:**
- Create: `.changeset/task-input-lifecycle.md`
- Modify: `docs/agents/architecture.md` (the `### MCP Tasks` section)
- Modify: `docs/agents/plans/backlog/2026-09-29-decision-flow-server-follow-ons.md`

- [ ] **Step 1: Write the changeset.**
  ```md
  ---
  "@mokei/context-server": patch
  "@mokei/context-client": patch
  "@mokei/decision-flow-server": patch
  ---
  ```
  The body is 2–4 sentences:
  - task input history is persisted in `TaskRecord.inputs`;
  - a withdrawn request rejects with `InputRequestWithdrawnError`;
  - the client aborts a withdrawn dispatch with `TaskInputWithdrawnError` and fails an expired wait with `TaskExpiredError`;
  - decision-flow recovery replays stored input outcomes.
- [ ] **Step 2: Add one architecture paragraph** after the CAS paragraph in `### MCP Tasks`. It covers:
  - the `inputs` history and the definition of "open";
  - the four transitions, each one CAS write;
  - settled entries never change;
  - waiters register, then read, and resolve from committed records only;
  - expiry notifies them.
- [ ] **Step 3: Update the follow-ons backlog.** Delete the item "Input recovery changes planned with host desktop interaction", since this branch implements it. Keep the other items.
- [ ] **Step 4: Run full verification.** Run `pnpm build && pnpm test` from the worktree root, then `rtk proxy pnpm run lint`. Expect all green. A known flaky test may fail under full concurrency: the context-client `SubscriptionDriver` `ackTimeoutMs` test. If it does, rerun it alone and record the result.
- [ ] **Step 5: Commit.** `git commit -m "docs: task input lifecycle architecture and release intent"`.
