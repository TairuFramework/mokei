# Flow rig phase 3A -- quick fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the small flow rig milestone findings in packages: a cancellable inbox prompt, typed predictor
errors that survive the MCP hop, an optional System One model, and a default `input` for inline flows.

**Architecture:** Each fix lands in the package that owns the behaviour. The rig drops its matching workaround.
Findings that belong to `@sozai/flow-graph` become a backlog doc in the sozai repo.

**Tech Stack:** TypeScript packages with vitest, Node ESM rig script with `node:test`.

**Spec:** none on file. The design was approved in chat on 2026-10-01 and is recorded below.

## Design (approved)

- **A1.** `InputInbox.prompt(id, options?: { signal?: AbortSignal })`. An abort closes the prompt's dialogs and
  rejects with `signal.reason`. The entry stays pending, so it can be prompted again. The rig passes the
  `prompt_input` request signal.
- **A2.** Deferred by design: an elicit handler aborted with `TaskInputWithdrawnError` keeps rejecting. The
  aborting caller owns that rejection. Document it on `createDesktopElicitHandler`.
- **A3.** sozai's `sanitize` keeps only `type`, `code`, `status` and `retryAfterMs`, and `describeDecisionError`
  already reports `error.name` and `status`. The loss is the MCP hop: the system-one server throws a plain
  `Error`, and the predictor rebuilds a plain `SystemOneError`. Fix: the server returns an error result carrying
  the error's identity in `_meta`, and the predictor rebuilds the matching `SystemOneError` subclass.
- **A4.** `model` becomes optional end to end. The HTTP backend omits it, and `laya-serve` picks its default
  (verified on 2026-10-01: a request without `model` answered with `"model": "laya-rl-agent"`).
- **A5.** The `run_flow` tool treats a missing `input` as `{}`.
- **D.** sozai backlog doc: `Invalid flow input` should carry its validation issues, and an `end` node `outcome`
  should accept a `ref`.
- Not in scope: a failed flow reporting `state: completed` (sub-project B, flow runs API).

## Global Constraints

- kigu conventions: `type` not `interface`, `Array<T>`, no `any`, `#private` fields + getters, single params
  object for constructors, `ID` casing (`runID`), `import type`. External wire fields keep their names.
- `_meta` keys use the `dev.mokei/` prefix, never `io.mokei/`.
- Prose: British spelling, ` -- ` dashes. No local paths (`/Users/`, `../sozai`, scratchpad) in committed files.
- Changesets: patch only (0.14.x band).
- `pnpm` only; scripts as `rtk proxy pnpm run <script>`; biome as `rtk proxy pnpm exec biome check --write <paths>`.
  No `sed -i`. Never `--no-verify`.
- Cross-package tests resolve built `lib/`: rebuild a changed dependency (`rtk proxy pnpm --filter <pkg> run build`)
  before running a dependent package's tests.

## Review Focus

1. A prompt aborted before its dialog opens must still reject and leave the entry promptable. Pinned in Task 1.
2. A prompt aborted while the entry is answered elsewhere must resolve with the entry's outcome, not reject.
   Pinned in Task 1.
3. A tool error result without the `dev.mokei/system-one-error` meta (an older server, another predict tool) must
   still become a plain `SystemOneError` with the result text. Pinned in Task 3.
4. An unknown `name` in the meta must fall back to a plain `SystemOneError`, never throw while mapping. Pinned in
   Task 2.
5. `run_flow` with an explicit `input: null` must still be validated as given (only `undefined` defaults).
   Pinned in Task 3.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/host-desktop/src/inbox.ts` | `prompt` takes an abort signal |
| `packages/host-desktop/src/elicit-handler.ts` | Doc comment on withdrawal rejection |
| `scripts/flow-rig/serve.mjs` | `prompt_input` passes its request signal |
| `packages/system-one-client/src/{backend,client,http}.ts` | Optional model |
| `packages/system-one-client/src/errors.ts` | `SystemOneErrorInfo`, `systemOneErrorInfo`, `systemOneErrorFromInfo` |
| `mcp-servers/system-one/src/config.ts` | Error result with meta instead of a thrown `Error` |
| `packages/decision-flow-server/src/predictor.ts` | Rebuild typed errors |
| `packages/decision-flow-server/src/server.ts` | `run_flow` input default |
| `.changeset/flow-rig-quick-fixes.md`, milestone, rig README | Docs |

---

### Task 1: Cancellable inbox prompt

**Files:**
- Modify: `packages/host-desktop/src/inbox.ts` (`InputInbox.prompt` type at line 47, `prompt` at line 166)
- Modify: `packages/host-desktop/src/elicit-handler.ts` (doc comment on `createDesktopElicitHandler`)
- Modify: `scripts/flow-rig/serve.mjs` (`prompt_input` handler, line 172)
- Test: `packages/host-desktop/test/inbox.test.ts`; `scripts/flow-rig/test/` for the rig

**Interfaces:**
- Produces: `prompt(id: string, options?: { signal?: AbortSignal }): Promise<ElicitResult>`.

- [ ] **Step 1: Write the failing tests** in `inbox.test.ts`:
  - `prompt rejects with the signal reason and leaves the entry pending`: an entry whose prompt never settles
    until its own signal aborts; abort the caller signal with `new Error('stop')`; `prompt` rejects with that
    error; the prompt's signal is aborted; `list()` still holds the entry; a second `prompt(id)` calls the
    entry's prompt again.
  - `prompt with an already aborted signal rejects without opening a dialog` (Review Focus 1): the entry's prompt
    function is never called; the entry stays listed.
  - `an abort after the entry settles elsewhere resolves with the outcome` (Review Focus 2): prompt, then
    `answer(id, content)`, then abort; `prompt` resolves `{ action: 'accept', content }`.
  - A second concurrent `prompt(id)` with its own signal shares the first run (existing `promptResult` reuse);
    aborting the second caller's signal does not abort the first caller. Assert the first still resolves when the
    dialog answers.
- [ ] **Step 2: Run** `rtk proxy pnpm --filter @mokei/host-desktop exec vitest run test/inbox.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.** The caller signal aborts the shared prompt controller only when no other caller is
  waiting on the same run; each caller's promise races its own signal (use the existing `untilAbort` from
  `elicit-handler.ts` or an equivalent local helper). Keep the entry pending on abort, as the existing catch path
  does.
- [ ] **Step 4: Doc comment.** On `createDesktopElicitHandler`: an abort whose reason is a
  `TaskInputWithdrawnError` records the inbox entry as `withdrawn`, and the returned promise still rejects with
  that reason; the caller that aborted owns the rejection.
- [ ] **Step 5: Rig.** `prompt_input` passes `{ signal }` from the tool request to `inbox.prompt`. Build
  host-desktop, then run `rtk proxy pnpm run test:flow-rig`. Expected: PASS.
- [ ] **Step 6: Run** the host-desktop suite. Expected: PASS. Lint and commit:

```bash
rtk proxy pnpm exec biome check --write packages/host-desktop scripts/flow-rig
git add packages/host-desktop scripts/flow-rig
git commit -m "feat(host-desktop): cancel an inbox prompt with an abort signal"
```

---

### Task 2: System One client -- optional model and portable error info

**Files:**
- Modify: `packages/system-one-client/src/backend.ts` (`model: string` at lines 9 and 17 becomes `model?: string`)
- Modify: `packages/system-one-client/src/client.ts` (`#resolveModel`)
- Modify: `packages/system-one-client/src/http.ts` (`#post` body, line 205)
- Modify: `packages/system-one-client/src/errors.ts`, `src/index.ts` (exports)
- Modify: `mcp-servers/system-one/src/config.ts` (predict handler catch, lines 92-97; `model` description)
- Test: `packages/system-one-client/test/{client,http,errors}.test.ts`, `mcp-servers/system-one/test/config.test.ts`

**Interfaces:**
- Produces, from `@mokei/system-one-client`:

```ts
export const SYSTEM_ONE_ERROR_META = 'dev.mokei/system-one-error'
export type SystemOneErrorInfo = { name: string; status?: number; retryAfterMs?: number }
export function systemOneErrorInfo(error: SystemOneError): SystemOneErrorInfo
export function systemOneErrorFromInfo(info: SystemOneErrorInfo, message: string): SystemOneError
```

- [ ] **Step 1: Write the failing tests.**
  - Client: `predict without a model or default sends no model field`: a fake backend records its params;
    `params.model` is `undefined`; no error is thrown.
  - HTTP: `the request body omits model when none is given`: with a stub `fetch`, the posted JSON has no `model`
    key. With a model, the key is present.
  - Errors: `systemOneErrorFromInfo` round-trips every exported subclass name to an instance of that class with
    the same `name`, `message`, and `status` (connection errors) and `retryAfterMs` (rate limit, overloaded).
  - `systemOneErrorFromInfo({ name: 'Nope' }, 'm')` returns a plain `SystemOneError` with message `m`
    (Review Focus 4).
  - Server: `a client failure returns an error result with the error meta`: the predict tool with a client that
    throws `new SystemOneModelError({ message: 'unknown model' })` returns `isError: true`, text
    `unknown model`, and `_meta['dev.mokei/system-one-error']` equal to `{ name: 'SystemOneModelError' }`.
    An aborted request still throws.
- [ ] **Step 2: Run** both packages' tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Remove the model-required error; pass `model` through possibly `undefined`.
  `systemOneErrorFromInfo` maps by a name-to-constructor table; validation subclasses get `issues: []`.
  The server builds its error result from `systemOneErrorInfo` when the error is a `SystemOneError`, otherwise
  `{ name: 'SystemOneError' }`. Update the `model` input description: optional, the backend picks its default.
- [ ] **Step 4: Run** the tests. Expected: PASS. Build `@mokei/system-one-client` (Task 3 depends on its lib).
- [ ] **Step 5: Lint and commit.**

```bash
rtk proxy pnpm exec biome check --write packages/system-one-client mcp-servers/system-one
git add packages/system-one-client mcp-servers/system-one
git commit -m "feat(system-one-client): optional model and portable error info"
```

---

### Task 3: Decision flow server -- typed predictor errors and inline input default

**Files:**
- Modify: `packages/decision-flow-server/src/predictor.ts` (the `isError` branch, line 65)
- Modify: `packages/decision-flow-server/src/server.ts` (`run_flow` handler, line 101)
- Test: `packages/decision-flow-server/test/`

**Interfaces:**
- Consumes: `SYSTEM_ONE_ERROR_META`, `SystemOneErrorInfo`, `systemOneErrorFromInfo` from Task 2.

- [ ] **Step 1: Write the failing tests.**
  - Predictor: `an error result with system-one meta rebuilds the typed error`: tool result
    `{ isError: true, content: [{ type: 'text', text: 'unknown model' }], _meta: { 'dev.mokei/system-one-error':
    { name: 'SystemOneModelError' } } }`; `predict` rejects with an instance of `SystemOneModelError`, message
    `unknown model`.
  - `an error result without meta stays a plain SystemOneError` (Review Focus 3): same result without `_meta`;
    the rejection's `name` is `SystemOneError`.
  - Flow level: a decide flow whose predictor tool returns the model-error result fails with
    `lastFailure.type === 'SystemOneModelError'`.
  - `run_flow` without `input` runs a definition whose input schema is `{ type: 'object' }` to completion.
  - `run_flow` with `input: null` still fails with `Invalid flow input` (Review Focus 5).
- [ ] **Step 2: Run** `rtk proxy pnpm --filter @mokei/decision-flow-server exec vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read the meta only when it is an object with a string `name`; otherwise fall back.
  In `run_flow`, pass `request.input.input ?? {}` only when the value is `undefined` (not `null`).
- [ ] **Step 4: Run** the package tests, then `rtk proxy pnpm run test:integration`. Expected: PASS.
- [ ] **Step 5: Lint and commit.**

```bash
rtk proxy pnpm exec biome check --write packages/decision-flow-server
git add packages/decision-flow-server
git commit -m "fix(decision-flow-server): keep predictor error types and default inline input"
```

---

### Task 4: Changeset and docs

**Files:**
- Create: `.changeset/flow-rig-quick-fixes.md`
- Modify: `docs/agents/plans/milestones/2026-09-30-flow-rig-milestone.md` (Findings)
- Modify: `scripts/flow-rig/README.md` (config: `SYSTEM_ONE_MODEL` optional; `start_flow` row: `input` defaults to
  `{}` for inline flows)
- Sibling repo (controller writes it, outside this repo): a backlog doc in the sozai repo's
  `docs/agents/plans/backlog/`

- [ ] **Step 1: Changeset**, patch for `@mokei/host-desktop`, `@mokei/system-one-client`, `@mokei/mcp-system-one`,
  `@mokei/decision-flow-server`. One paragraph each: `InputInbox.prompt` takes `{ signal }`; `model` is optional
  and omitted when unset; tool error results carry `_meta['dev.mokei/system-one-error']` and the predictor
  rebuilds the typed error; `run_flow` defaults a missing `input` to `{}`.
- [ ] **Step 2: Milestone findings.** Append a status to each finding: shipped (prompt signal, typed predictor
  error, optional model, inline input default), deferred by design (withdrawal rejection, with the reason),
  requested upstream (`end` outcome literal, `Invalid flow input` detail), sub-project B (the remaining run and
  approval findings, `state: completed`).
- [ ] **Step 3: README.** Update the two rows. Remove the inline `input` note added in phase 2.
- [ ] **Step 4: Verify.** `rtk proxy pnpm run lint` clean; `rtk proxy pnpm change status` lists the four packages
  at patch.
- [ ] **Step 5: Commit.**

```bash
git add .changeset docs/agents/plans/milestones scripts/flow-rig/README.md
git commit -m "docs: record flow rig quick fixes"
```

- [ ] **Step 6 (controller): sozai backlog doc** with two asks, each with the observed behaviour, the wanted
  behaviour and why: `Invalid flow input` carries the validation issues; an `end` node `outcome` accepts a `ref`
  so a nested flow's outcome can pass through. No mokei paths in it beyond package names.
