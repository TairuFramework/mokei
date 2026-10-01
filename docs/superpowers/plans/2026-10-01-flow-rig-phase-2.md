# Flow rig phase 2 -- integration harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the flow rig's facade scenarios in CI, over stdio, without a desktop or System One.

**Architecture:** `serve.mjs` exports `createRig` with an optional injected desktop. A test entry,
`integration-tests/support/flow-rig/stub-rig.mjs`, runs the rig with a stub desktop and serves the rig tools plus
test-only stub tools. A vitest suite spawns that entry through `NodeContextHost` and drives the facade.

**Tech Stack:** Node ESM (`.mjs`) for the rig and stub entry, TypeScript + vitest for the suite, `node:test` for
rig unit tests.

**Spec:** `docs/superpowers/specs/2026-10-01-flow-rig-phase-2-design.md`

## Global Constraints

- No package changes and no new package. The rig stays under `scripts/flow-rig/`.
- The rig config gains no test-only fields.
- Names follow kigu conventions: `runID`, `inputID`, never `runId`. External wire fields (`taskId`) keep `Id`.
- Prose in docs and comments: British spelling, ` -- ` for dashes.
- Run scripts as `rtk proxy pnpm run <script>`, biome as `rtk proxy pnpm exec biome check --write <paths>`.
- `pnpm` only. Never `npm` or `npx`. No `sed -i`.
- The suite and stub never run a real dialog or notification command.
- Committed files contain no local paths (`/Users/`, scratchpad, worktrees).
- Build before suite runs: the suite spawns built `lib/` code (`pnpm build` once at the start).

## Review Focus

1. A stub `ask` abandoned by an aborted request must settle, or the next dialog in the same rig never opens.
   Pinned by Task 3's `cancelling a run withdraws its open dialog` test.
2. A test failing mid-dialog must not leak a blocked call into the next test. Pinned by Task 3's
   `cleanup aborts an outstanding blocking call` test.
3. `stub_answer` on a settled or unknown index returns an error result, not a crash. Pinned in Task 2.
4. Teardown must finish before the host's 5-second `SIGKILL`. Pinned by Task 2's `afterAll` calling
   `stub_shutdown` and asserting it resolves.
5. A rig that fails to start must fail `beforeAll` with a visible reason. Pinned by Task 2's
   `startRig rejects for an invalid config` test.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/flow-rig/serve.mjs` (modify) | `createRig` factory and the CLI entry |
| `scripts/flow-rig/test/create-rig.test.mjs` (create) | `node:test` checks of `createRig` |
| `integration-tests/support/flow-rig/stub-desktop.mjs` (create) | Stub backends, rejecting runner, fake executables, stub tools |
| `integration-tests/support/flow-rig/stub-rig.mjs` (create) | Test entry: `createRig` + stub desktop + `serveProcess`, lifecycle |
| `integration-tests/support/flow-rig/rig-driver.ts` (create) | Spawn, config, call/wait helpers, blocking-call tracking |
| `integration-tests/suites/flow-rig.test.ts` (create) | The 11 scenarios |
| `scripts/flow-rig/smoke.mjs` (delete) | Superseded |
| `package.json` (modify) | Drop `smoke:flow-rig`, add `test:flow-rig` to `test` |
| `scripts/flow-rig/README.md`, milestone, plan docs (modify) | Docs |

---

### Task 1: `createRig` factory

**Files:**
- Modify: `scripts/flow-rig/serve.mjs` (`main` at about line 228, CLI entry at the end)
- Create: `scripts/flow-rig/test/create-rig.test.mjs`

**Interfaces:**
- Produces: `export async function createRig({ configPath, desktop }): Promise<{ tools, shutdown }>`.
  `desktop` is optional: `{ createBackend, runner, platform, env }`. `tools` is the facade tool map passed to
  `serveProcess`. `shutdown()` is idempotent and returns a promise.

- [ ] **Step 1: Write the failing tests** in `create-rig.test.mjs`. Config written to a temp dir: no siblings,
  `flowsDir` absolute path to `scripts/flow-rig/flows`, `predictor: 'fake'`, `input: 'inbox'`, `confirm: 'deny'`.

```js
test('createRig returns the facade tools without serving stdio', async () => {
  const rig = await createRig({ configPath })
  assert.deepEqual(Object.keys(rig.tools).sort(), [
    'answer_input', 'cancel_flow', 'check_flow', 'decline_input',
    'flow_status', 'list_flows', 'prompt_input', 'start_flow',
  ])
  await rig.shutdown()
  await rig.shutdown() // idempotent
})

test('createRig passes the injected desktop to both elicit handlers', async () => {
  // createBackend records every backend name it is asked for; nothing is asked yet,
  // so assert the rig accepted the option and starts; the stub path is exercised in Task 2.
  const rig = await createRig({ configPath, desktop: { createBackend, runner, platform: 'linux', env: {} } })
  await rig.shutdown()
  assert.equal(runner.calls, 0)
})
```

- [ ] **Step 2: Run** `node --test scripts/flow-rig/test/create-rig.test.mjs`. Expected: FAIL, `createRig` is not exported.

- [ ] **Step 3: Implement.** Rename `main` to `createRig({ configPath, desktop })`. Spread `desktop` (when
  defined) into both `createDesktopElicitHandler` option objects (inputs and confirm). Remove the `stdio`
  parameter and the `serveProcess` call from the factory. The CLI entry block calls `createRig`, then
  `serveProcess({ name: 'flow-rig', version: '0.1.0', protocolVersions: ['2026-07-28', '2025-11-25'], tools })`,
  logs `Facade serving on stdio`, and keeps its signal and stdin-end handling unchanged.

- [ ] **Step 4: Verify.** `rtk proxy pnpm run test:flow-rig` passes (45 tests). `rtk proxy pnpm run smoke:flow-rig`
  still passes (the CLI path is unchanged).

- [ ] **Step 5: Lint and commit.**

```bash
rtk proxy pnpm exec biome check --write scripts/flow-rig
git add scripts/flow-rig/serve.mjs scripts/flow-rig/test/create-rig.test.mjs
git commit -m "refactor(flow-rig): export createRig with an injectable desktop"
```

---

### Task 2: Stub rig entry, driver and the non-dialog scenarios

**Files:**
- Create: `integration-tests/support/flow-rig/stub-desktop.mjs`
- Create: `integration-tests/support/flow-rig/stub-rig.mjs`
- Create: `integration-tests/support/flow-rig/rig-driver.ts`
- Create: `integration-tests/suites/flow-rig.test.ts`

**Interfaces:**
- Consumes: `createRig` from Task 1, imported as `../../../scripts/flow-rig/serve.mjs`. `createTool` and
  `serveProcess` from `../../../packages/context-server/lib/index.js` and
  `../../../packages/context-server-node/lib/index.js`.
- Produces, `stub-desktop.mjs`:
  `export function createStubDesktop(): { desktop, tools: { stub_dialogs, stub_answer }, dispose(): Promise<void> }`.
  - `desktop` is `{ createBackend, runner, platform: 'linux', env }`. `env` is
    `{ PATH: <tmp bin dir>, DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/stub' }`. The tmp dir holds
    executable `zenity` and `notify-send` files containing `#!/bin/sh\nexit 0\n`, mode `0o755`.
  - `runner.run` increments a counter and rejects with `Error('stub runner does not run')`.
  - Recorded call: `{ index, backend, type: 'ask' | 'notify', kind?, title, text, pending }`. `index` starts at 0
    and never resets. An `ask` stays pending until `stub_answer` or until `options.signal` aborts. On abort it
    rejects with `signal.reason`, removes its listener and sets `pending: false`. `notify` records with
    `pending: false` and resolves.
  - `stub_dialogs` result: `{ calls, runnerCalls }`. `stub_answer({ index, result })` settles the pending ask and
    returns `{ index }`. Unknown or settled index: error result `No pending dialog at <index>`.
  - `dispose()` removes the tmp dir.
- Produces, `stub-rig.mjs`: reads `FLOW_RIG_CONFIG`, calls `createRig`, serves rig tools + stub tools +
  `stub_shutdown` through `serveProcess` (name `flow-rig-stub`). One idempotent `stop()` awaits
  `rig.shutdown()` then `stub.dispose()`. `stub_shutdown` awaits `stop()` and returns `{}`. `SIGINT`, `SIGTERM`
  and stdin end await `stop()`, then `process.exit(0)`. A `createRig` failure logs to stderr, disposes the stub
  and exits 1.
- Produces, `rig-driver.ts`:

```ts
export type RigConfig = { input: 'inbox' | 'dialog'; fakeAnswers?: Record<string, unknown> }
export type RigDriver = {
  call(name: string, args?: Record<string, unknown>, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<CallToolResult>
  data<T = Record<string, unknown>>(result: CallToolResult): T // throws on isError
  waitFor(runID: string, predicate: (status: FlowStatus) => boolean, what: string): Promise<FlowStatus>
  watermark(): Promise<number> // highest dialog index, -1 when none
  waitForDialog(after: number, predicate: (call: StubCall) => boolean, what: string): Promise<StubCall>
  startBlocking(name: string, args: Record<string, unknown>): BlockingCall // { promise, abort() }
  cleanup(runIDs: Array<string>): Promise<void> // aborts and joins blocking calls, then cancel_flow each run
  dispose(): Promise<void> // stub_shutdown (10 s), host.dispose(), remove temp config dir
}
export function startRig(config: RigConfig): Promise<RigDriver>
```

  - `startRig` writes a temp config: siblings `{ sqlite: { command: process.execPath, args: [<abs
    mcp-servers/sqlite/lib/serve.js>] } }`, absolute `flowsDir`, `allow: ['system-one:predict',
    'sqlite:sqlite_get']`, `predictor: 'fake'`, `fakeAnswers` (default: `label` choice `question`, as in the
    current smoke run), `confirm: 'desktop'`, the given `input`. It spawns `process.execPath` with the absolute
    `stub-rig.mjs`, `env: { ...process.env, FLOW_RIG_CONFIG }`, `stderr: 'inherit'`, then `host.setup`.
  - Paths derive from `import.meta.url`. Wait deadline 10 s, poll 100 ms. Every `call` inside a wait gets the
    remaining time as `timeout`.
  - `startBlocking` attaches a no-op rejection handler at once and keeps the call in a set until it settles.

- [ ] **Step 1: Write the suite skeleton and the inbox scenarios** without dialogs, in `flow-rig.test.ts`:
  one `describe('inbox rig')` with `beforeAll(startRig({ input: 'inbox' }), 60_000)` and
  `afterAll(rig.dispose, 30_000)`. Each test collects its run IDs and calls `rig.cleanup(runIDs)` in `finally`.
  Tests, with assertions from the spec's Scenarios section:
  - `lists the sample flows` (scenario 1): `list_flows` text contains `demo/ask`, `demo/nested`, `demo/triage`.
  - `check_flow reports issues` (2): `{ id: 'bad', nodes: {} }` gives `ok: false` and non-empty `issues`.
  - `answers demo/ask through answer_input` (3): outcome `answered`, output `{ value: 'hi' }`.
  - `declines demo/ask through decline_input` (4): outcome `declined`, output `{}`.
  - `answers the inner input of demo/nested` (5): pending entry on the outer run; outcome `answered`, output
    `{ output: { value: 'hi' } }`.
  - `triages with the fake label` (8): outcome `triaged`, output `{ row: { label: 'question' } }`.
  - `reports node_failed for a missing fake answer` (9): inline `decide` flow with `input: {}`, question key
    `missing`, no matching fake answer. `state: 'completed'`, `result.isError: true`,
    `result.structuredContent.error.code: 'node_failed'`.
  - `cancel_flow clears the pending input` (10): `cancel_flow` returns `{ state: 'cancelled' }`, status has
    `pending: []`, `answer_input` on the old id is an error result `Unknown input: <id>`.
  - Plus a separate `describe('startRig')` test, `startRig rejects for an invalid config`: a config whose
    `flowsDir` does not exist makes `startRig` reject (Review Focus 5). `startRig` takes an optional
    `configOverrides` for this.

- [ ] **Step 2: Run** `rtk proxy pnpm --filter mokei-integration-tests exec vitest run suites/flow-rig.test.ts`.
  Expected: FAIL, support modules missing.

- [ ] **Step 3: Implement** `stub-desktop.mjs`, `stub-rig.mjs` and `rig-driver.ts` per the Interfaces block.

- [ ] **Step 4: Add `stub_answer` error test** `stub_answer rejects an unknown index` (Review Focus 3): result
  `isError: true` with text `No pending dialog at 999`. Add `teardown finishes before the kill grace` as an
  assertion inside `dispose`: `stub_shutdown` resolves (not an error result) within 10 s (Review Focus 4).

- [ ] **Step 5: Run** the suite again. Expected: all tests PASS, and `stub_dialogs.runnerCalls` is 0 in an
  `afterAll` check before `dispose`.

- [ ] **Step 6: Lint, typecheck and commit.**

```bash
rtk proxy pnpm exec biome check --write integration-tests
rtk proxy pnpm --filter mokei-integration-tests run test:types
git add integration-tests/support/flow-rig integration-tests/suites/flow-rig.test.ts
git commit -m "test(flow-rig): integration suite with a stub desktop"
```

---

### Task 3: Dialog scenarios

**Files:**
- Modify: `integration-tests/suites/flow-rig.test.ts`

**Interfaces:**
- Consumes: `RigDriver` from Task 2 (`watermark`, `startBlocking`, `waitForDialog`, `cleanup`).

- [ ] **Step 1: Write the tests.** All follow the spec's five-step blocking sequence.
  - Inbox rig, `prompts demo/ask through a dialog` (6): watermark `w1` before `start_flow`; expect a new `notify`
    after `w1`. Watermark `w2` before `startBlocking('prompt_input', { id })`; expect one new pending `ask` after
    `w2`. `stub_answer` with `{ status: 'answered', value: 'hi' }`. `prompt_input` returns
    `{ id, action: 'accept' }`. The run completes with outcome `answered`, output `{ value: 'hi' }`.
  - Inbox rig, `confirms a flow outside the allowlist` (7): inline flow with `input: {}`, tool node
    `sqlite:sqlite_all` with `sql: { value: 'SELECT 1 AS one' }`, end output `{ rows: { ref: ['results', 'q'] } }`.
    Yes: `start_flow` via `startBlocking`, answer the confirm ask `{ status: 'answered', value: true }`, the run
    completes with output `{ rows: [{ one: 1 }] }`. No: answer `{ status: 'answered', value: false }`,
    `start_flow` resolves to an error result whose text starts with `Flow denied`.
  - Inbox rig, `cleanup aborts an outstanding blocking call` (Review Focus 2): start a confirm `start_flow`, wait
    for its pending ask, call `rig.cleanup([])` without answering. The blocking promise settles, and the ask
    shows `pending: false`. A following `start_flow` of `demo/ask` still reaches `input_required`.
  - New `describe('dialog rig')` with `startRig({ input: 'dialog' })`:
    - `opens a dialog directly for demo/ask` (11): watermark, `start_flow`, wait for a new pending ask, status is
      `input_required` with `pending: []`, answer `'hi'`, run completes as in scenario 3.
    - `cancelling a run withdraws its open dialog` (Review Focus 1): start `demo/ask`, wait for the ask,
      `cancel_flow`. The ask shows `pending: false`. A second `demo/ask` opens a new pending ask.
  - Both describes assert `runnerCalls: 0` before teardown.

- [ ] **Step 2: Run** the suite. Expected: the new tests fail only if behaviour is wrong; fix the stub or the
  driver, never the assertions taken from the spec.

- [ ] **Step 3: Run** `rtk proxy pnpm run test:integration`. Expected: the whole integration suite PASSES.

- [ ] **Step 4: Lint and commit.**

```bash
rtk proxy pnpm exec biome check --write integration-tests
git add integration-tests/suites/flow-rig.test.ts
git commit -m "test(flow-rig): cover dialog, confirm and prompt scenarios"
```

---

### Task 4: Retire the smoke run, CI wiring and docs

**Files:**
- Delete: `scripts/flow-rig/smoke.mjs`
- Modify: `package.json` (root scripts)
- Modify: `scripts/flow-rig/README.md` (Tests section, `start_flow` row)

- [ ] **Step 1: Edit root scripts.** Remove `smoke:flow-rig`. Set `test` to
  `pnpm run --filter './packages/**' --filter './mcp-servers/**' test && pnpm run test:flow-rig && pnpm run test:integration`.

- [ ] **Step 2: Delete** `scripts/flow-rig/smoke.mjs`. Confirm nothing references it:
  `grep -rn "smoke" scripts/flow-rig package.json docs/agents` shows no live reference (completed-plan history
  may mention it).

- [ ] **Step 3: Update the README Tests section.** Unit tests: `pnpm run test:flow-rig`. Integration:
  `pnpm run test:integration` runs `integration-tests/suites/flow-rig.test.ts` against a stub desktop and the fake
  predictor, with no System One or desktop needed. Keep the manual QA checklist, and say it covers the real
  desktop and real System One. In the `start_flow` row, note that an inline flow declaring an `input` schema
  needs `input` passed (at least `{}`).

- [ ] **Step 4: Verify.** `rtk proxy pnpm run lint` clean. `rtk proxy pnpm run test:flow-rig` passes.
  `rtk proxy pnpm run test:integration` passes.

- [ ] **Step 5: Commit.**

```bash
git add -A scripts/flow-rig package.json
git commit -m "chore(flow-rig): replace the smoke run with the integration suite"
```

Milestone and completed-summary updates happen in the kigu:complete step after the final review, not here.
