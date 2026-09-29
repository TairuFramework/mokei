# Decision Flow Laya and Retries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test decision flows against one real laya server, add opt-in HTTP retries, and remove the decision-flow test script's rebuild.

**Architecture:** Move System One retry classification into the client while preserving the decision-flow delegate. Wrap each HTTP attempt with the existing error mapper, then map retry exhaustion separately. Run both laya suites in one Vitest project with a shared server, and move the built-entry smoke check into integration tests.

**Tech Stack:** TypeScript 6, pnpm, Vitest 5, ky 2, `@sozai/async`, `@sozai/flow-graph`, `@sozai/schema`, Biome.

**Spec:** `docs/superpowers/specs/2026-09-29-decision-flow-laya-and-retries-design.md`

## Global Constraints

- Create no new package. Use kebab-case filenames, single quotes, no semicolons, and `Array<T>` types.
- Use `pnpm` and `pnpm exec` only. Run lint from the root with `rtk proxy pnpm run lint`.
- Use `catalog:` for added dependencies. `@sozai/async`, `@sozai/schema`, and `@sozai/flow-graph` already appear in `pnpm-workspace.yaml`.
- Use `pnpm --filter <pkg> test` for package tests. Rebuild `@mokei/system-one-client` before decision-flow or integration tests consume its built `lib/`.
- Run `pnpm build` before integration tests or root `pnpm test`. Keep `MOKEI_LAYA_SERVE_BIN` optional.
- Preserve the spec's exact route, timeout, error, and request-count assertions. Run the laya decision suite three times before retaining pinned routes.
- Each code task ends green in an environment without `MOKEI_LAYA_SERVE_BIN`. Commit each implementation task when executing this plan; the controller commits this plan file.

## Spec deviations

- The spec locates Sozai at `../sozai` from this worktree. The checked-out source is at `../../sozai`; all engine and retry semantics below use that actual sibling source.
- `kigu:conventions` prefers `type`, but Vitest 5's `ProvidedContext` is an interface. The required `declare module 'vitest' { interface ProvidedContext ... }` is necessary for module augmentation.
- The proposed `confidence greaterThan 1` case fails `checkDecide`: probability operands must be within `[0, 1]`. Task 6 uses `not(confidence >= 0)`, which cannot match a valid answer and passes the checker.

## Review Focus

- A 503 without a retry option must make exactly one request and retain its mapped status. Task 2 tests this.
- A non-retryable 401 under a retry policy must make one request and remain an auth error. Task 2 tests this.
- A caller abort during a pending request or backoff must retain the exact reason and stop requests. Task 2 tests both points.
- A targeted non-laya suite must not start the laya server. Task 4 verifies project isolation.
- A recovered in-flight checkpoint must execute the prediction once and preserve increasing revisions. Task 6 tests this.

## File map

| File | Responsibility |
|---|---|
| `packages/system-one-client/src/retryable-error.ts` | Export System One retry classification. |
| `packages/system-one-client/src/http.ts` | Accept the policy, retry mapped attempts, and map exhausted retries. |
| `packages/system-one-client/src/index.ts`, `package.json`, `test/retryable-error.test.ts`, `test/http.test.ts` | Public export, catalog dependency, and client tests. |
| `packages/decision-flow/src/decide-error.ts`, `test/decide-error.test.ts`, `README.md` | Delegate retry classification and document stacked policies. |
| `packages/decision-flow/package.json`, `test/built-entry.mjs` | Remove the extra smoke build. |
| `integration-tests/suites/built-entries.test.ts` | Check the built decision-flow entry. |
| `integration-tests/support/laya-setup.ts`, `vitest.config.ts`, `suites/laya.test.ts` | Shared server lifecycle and project isolation. |
| `integration-tests/suites/laya-decision-flow.test.ts`, `tsconfig.json`, `package.json`, `README.md` | Real decision-flow scenarios, JSON import, dependencies, and usage. |
| `.changeset/decision-flow-laya-retries.md` | Patch release intent for `@mokei/system-one-client`. |

---

### Task 1: Export retry classification and preserve the flow delegate

**Files:**
- Create: `packages/system-one-client/src/retryable-error.ts`
- Create: `packages/system-one-client/test/retryable-error.test.ts`
- Modify: `packages/system-one-client/src/index.ts`
- Modify: `packages/system-one-client/package.json`
- Modify: `packages/decision-flow/src/decide-error.ts`
- Modify: `packages/decision-flow/test/decide-error.test.ts`

**Interfaces:**
- Produces: `retryableSystemOneError(error: unknown): RetryDecision` from the client entry.
- Preserves: `retryableDecision(error: unknown): RetryDecision` from decision-flow; `describeDecisionError` stays in that file and unchanged.

- [ ] **Step 1: Write the failing client classification tests.** Create `test/retryable-error.test.ts` with the exact cases below. Move the corresponding classification cases out of decision-flow's test, leaving its metadata tests intact.

```ts
import { describe, expect, test } from 'vitest'

import {
  SystemOneAuthError, SystemOneConnectionError, SystemOneError, SystemOneInputError,
  SystemOneModelError, SystemOneOverloadedError, SystemOneRateLimitError,
  SystemOneResponseError,
} from '../src/errors.js'
import { retryableSystemOneError } from '../src/retryable-error.js'

describe('retryableSystemOneError', () => {
  test.each([408, 429, 500, 502, 503, 504, 529])('retries status %i', (status) => {
    expect(retryableSystemOneError(new SystemOneConnectionError({ message: 'secret', status }))).toBe(true)
  })
  test('retries a network failure', () => {
    expect(retryableSystemOneError(new SystemOneConnectionError({ message: 'secret' }))).toBe(true)
  })
  test.each([400, 401, 403, 404, 422, 501])('rejects status %i', (status) => {
    expect(retryableSystemOneError(new SystemOneConnectionError({ message: 'secret', status }))).toBe(false)
  })
  test.each([SystemOneRateLimitError, SystemOneOverloadedError])('uses finite retry-after for %s', (ErrorClass) => {
    expect(retryableSystemOneError(new ErrorClass({ message: 'secret', retryAfterMs: 250 }))).toEqual({ afterMs: 250 })
    expect(retryableSystemOneError(new ErrorClass({ message: 'secret', retryAfterMs: Infinity }))).toBe(true)
  })
  test.each([
    new SystemOneAuthError({ message: 'secret' }), new SystemOneInputError({ message: 'secret' }),
    new SystemOneModelError({ message: 'secret' }), new SystemOneResponseError({ message: 'secret' }),
    new SystemOneError({ message: 'secret' }), new DOMException('aborted', 'AbortError'),
  ])('rejects non-connection errors (%s)', (error) => {
    expect(retryableSystemOneError(error)).toBe(false)
  })
})
```

- [ ] **Step 2: Confirm red.** Run `pnpm --filter @mokei/system-one-client test`. Expected: FAIL because `../src/retryable-error.js` does not exist.
- [ ] **Step 3: Implement classification.** Add `@sozai/async: "catalog:"` to client dependencies and run `pnpm install`. Create `retryableSystemOneError(error: unknown): RetryDecision` using the status set `[408, 429, 500, 502, 503, 504, 529]` and finite rate-limit or overload delay. Export it in `src/index.ts`. Replace `retryableDecision`'s body with `return retryableSystemOneError(error)`, retaining the local `getRetryAfterMs` used by `describeDecisionError`.
- [ ] **Step 4: Replace flow classification tests with this complete delegate test.** Keep the existing `describeDecisionError` block.

```ts
test('delegates System One retry decisions', () => {
  expect(retryableDecision(new SystemOneConnectionError({ message: 'secret', status: 503 }))).toBe(true)
  expect(retryableDecision(new SystemOneRateLimitError({ message: 'secret', status: 429, retryAfterMs: 250 }))).toEqual({ afterMs: 250 })
  expect(retryableDecision(new SystemOneAuthError({ message: 'secret' }))).toBe(false)
})
```

- [ ] **Step 5: Verify green and the built export.** Run `pnpm --filter @mokei/system-one-client test`, then `pnpm --filter @mokei/system-one-client build`, then `pnpm --filter @mokei/decision-flow test`. Expected: all pass; the decision-flow test uses the freshly built client entry.
- [ ] **Step 6: Commit.** `git add packages/system-one-client/src/retryable-error.ts packages/system-one-client/test/retryable-error.test.ts packages/system-one-client/src/index.ts packages/system-one-client/package.json packages/decision-flow/src/decide-error.ts packages/decision-flow/test/decide-error.test.ts pnpm-lock.yaml && git commit -m "refactor: share System One retry classification"`

### Task 2: Retry HTTP predictions on request

**Files:**
- Modify: `packages/system-one-client/src/http.ts`
- Modify: `packages/system-one-client/test/http.test.ts`
- Modify: `packages/system-one-client/test/client.test.ts`
- Modify: `packages/decision-flow/README.md`

**Interfaces:**
- Consumes: `retryableSystemOneError(error: unknown): RetryDecision` from Task 1.
- Produces: `retry?: RetryPolicy` on `SystemOneHTTPClientParams` and `HTTPSystemOneBackendParams`; `createSystemOneClient` already passes the full params object to the backend.

- [ ] **Step 1: Add failing HTTP tests.** Use a counting `fetch` stub and the existing `questions` fixture in `test/http.test.ts`. Add these tests with their assertions; give each stub `content-type: application/json`. Use `{ maxAttempts: 2 }` except where specified. For a success response, use the complete valid raw envelope from the first existing HTTP test.

```ts
test('without retry, 503 fails after one request', async () => {
  const fetcher = vi.fn(async () => new Response('busy', { status: 503 }))
  const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000', fetch: fetcher })
  const error = await backend.predict({ state: 'hi', questions, model: 'english' }).catch((e: unknown) => e)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(error).toBeInstanceOf(SystemOneConnectionError)
  expect((error as SystemOneConnectionError).status).toBe(503)
})

test('503 then success makes two requests', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response('busy', { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(rawResult), { status: 200, headers: { 'content-type': 'application/json' } }))
  const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000', fetch: fetcher, retry: { maxAttempts: 2 } })
  expect((await backend.predict({ state: 'hi', questions, model: 'english' })).model).toBe('english')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test('401 under retry is not retried', async () => {
  const fetcher = vi.fn(async () => new Response('unauthorized', { status: 401 }))
  const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000', fetch: fetcher, retry: { maxAttempts: 3 } })
  await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(SystemOneAuthError)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('exhausted 503s rethrow the last mapped error', async () => {
  const fetcher = vi.fn(async () => new Response('busy', { status: 503 }))
  const backend = new HTTPSystemOneBackend({ url: 'http://localhost:8000', fetch: fetcher, retry: { maxAttempts: 2 } })
  const error = await backend.predict({ state: 'hi', questions, model: 'english' }).catch((e: unknown) => e)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(error).toBeInstanceOf(SystemOneConnectionError)
  expect(error).not.toBeInstanceOf(RetryExhaustedError)
  expect((error as SystemOneConnectionError).status).toBe(503)
})
```

Use `const rawResult = { model: 'english', answers: { dept: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.9 } } }, usage: { input_tokens: 1, output_tokens: 1 } }`. Import `RetryExhaustedError` from `@sozai/async`; Task 1 added that dependency. Add a `createSystemOneClient({ ..., retry: { maxAttempts: 2 } })` forwarding test in `test/client.test.ts` with the same 503/success sequence and request count two.

- [ ] **Step 2: Add timer, timeout, and abort tests.** Use `vi.useFakeTimers()` and `try/finally { vi.useRealTimers() }` for timed cases. Use `vi.advanceTimersByTimeAsync(...)` after the first request is observed. A hanging fetch must read the `Request.signal`, reject on abort, and count each invocation.

```ts
// In test/http.test.ts; each line below is a separate test assertion set.
// 429 then success, retry: { maxAttempts: 2 } and Retry-After: 1:
expect(fetcher).toHaveBeenCalledTimes(1)
await vi.advanceTimersByTimeAsync(999)
expect(fetcher).toHaveBeenCalledTimes(1)
await vi.advanceTimersByTimeAsync(1)
expect(fetcher).toHaveBeenCalledTimes(2)

// Hanging fetch, retry: { maxAttempts: 2, attemptTimeoutMs: 20 }:
expect(fetcher).toHaveBeenCalledTimes(2)
expect(abortedAttempts).toBe(2)
expect(error).toBeInstanceOf(SystemOneConnectionError)
expect((error as Error).message).toBe('System One request timed out')
expect((error as Error).cause).toBeInstanceOf(RetryExhaustedError)

// Hanging fetch, retry: { maxAttempts: 3, totalTimeoutMs: 20 }:
expect(error).toBeInstanceOf(SystemOneConnectionError)
expect((error as Error).message).toBe('System One request did not complete within the retry budget')
expect((error as Error).cause).toBeInstanceOf(RetryExhaustedError)

// 503, retry: { maxAttempts: 3, totalTimeoutMs: 20, backoff: { initialMs: 30 } }:
expect(fetcher).toHaveBeenCalledTimes(1)
expect((error as Error).message).toBe('System One request did not complete within the retry budget')
expect((error as Error).cause).toBeInstanceOf(RetryExhaustedError)

// Abort in-flight, then separately abort during backoff { initialMs: 1000 }:
expect(error).toBe(reason)
expect(fetcher).toHaveBeenCalledTimes(1)
```

The assertions above are the test bodies' required results. Build complete tests around `backend.predict({ state: 'hi', questions, model: 'english', signal: controller.signal })`; capture the promise before advancing time or aborting. For the backoff abort, wait until the first 503 response has been mapped before `controller.abort(reason)`, then advance past 1000 ms and assert no second request. For the attempt timeout, advance 20 ms twice, allowing microtasks between advances. Avoid ky's own timeout in these tests.

- [ ] **Step 3: Confirm red.** Run `pnpm --filter @mokei/system-one-client test`. Expected: type failures for `retry` and failing request counts.
- [ ] **Step 4: Implement the two mapping layers.** Import `retry`, `RetryExhaustedError`, `TimeoutInterruption`, and `type RetryPolicy` from `@sozai/async`. Store the optional policy on `HTTPSystemOneBackend`. Keep the no-policy `mapError(() => post(...))` path. For a policy, call `retry(({ signal }) => mapError(() => post(..., signal)), { policy, signal: params.signal, retryable })`. `retryable` returns true for `TimeoutInterruption` with `cause === 'attempt'` and otherwise calls Task 1's classifier. Catch only around `retry()` in `mapRetryError(error: unknown, signal?: AbortSignal): never`: throw `signal.reason` if aborted, throw a non-retryable `SystemOneError` unchanged, throw the last `SystemOneError` for attempts exhaustion, and throw the two exact connection-error messages and causes from the spec for attempt and total timeouts. Do not run `mapError` around `retry()`.
- [ ] **Step 5: Document stacked policies.** In `packages/decision-flow/README.md`, add: “Decide nodes have their own `retry` policy. Leave the HTTP backend's `retry` unset for flows; setting both multiplies attempts.”
- [ ] **Step 6: Verify green.** Run `pnpm --filter @mokei/system-one-client test`, then `pnpm --filter @mokei/system-one-client build`, then `pnpm --filter @mokei/decision-flow test`. Expected: all pass, including types and existing flow retries.
- [ ] **Step 7: Commit.** `git add packages/system-one-client/src/http.ts packages/system-one-client/test/http.test.ts packages/system-one-client/test/client.test.ts packages/decision-flow/README.md && git commit -m "feat: add opt-in System One HTTP retries"`

### Task 3: Move the built-entry smoke check into integration tests

**Files:**
- Create: `integration-tests/suites/built-entries.test.ts`
- Modify: `packages/decision-flow/package.json`
- Delete: `packages/decision-flow/test/built-entry.mjs`

**Interfaces:**
- Produces: an integration smoke suite against `@mokei/decision-flow`'s built `lib/index.js`.

- [ ] **Step 1: Add the test.** Copy this complete test, preserving every name from the old script.

```ts
import * as entry from '@mokei/decision-flow'
import { expect, test } from 'vitest'

test('built decision-flow entry exports its public symbols', () => {
  for (const name of [
    'checkDecide', 'createDecisionFlowGraph', 'decideKind', 'decideNodeSchema',
    'decideResultSchema', 'decideTargets', 'describeDecisionError',
    'flowDefinitionSchema', 'flowStorageSchema', 'formatIssues',
    'InvalidDecisionStateError', 'retryableDecision',
  ]) {
    expect(entry).toHaveProperty(name)
  }
})
```

- [ ] **Step 2: Confirm red before a build.** Run `pnpm --filter @mokei/decision-flow build`, then `pnpm --filter mokei-integration-tests exec vitest run suites/built-entries.test.ts`. Expected: PASS, proving the new test uses the built package. Temporarily remove one export name from the array and rerun; expected: FAIL on the missing property. Restore the exact array before proceeding.
- [ ] **Step 3: Remove the rebuild.** Change decision-flow's `test` script to `pnpm run test:types && pnpm run test:unit`; remove `test:built` and delete `test/built-entry.mjs`.
- [ ] **Step 4: Verify green.** Run `pnpm --filter @mokei/decision-flow test`, then `pnpm build`, then `pnpm --filter mokei-integration-tests test`. Expected: all pass; the integration smoke suite is included.
- [ ] **Step 5: Commit.** `git add packages/decision-flow/package.json packages/decision-flow/test/built-entry.mjs integration-tests/suites/built-entries.test.ts && git commit -m "test: move decision-flow built entry check"`

### Task 4: Share one laya server in its Vitest project

**Files:**
- Create: `integration-tests/support/laya-setup.ts`
- Modify: `integration-tests/vitest.config.ts`
- Modify: `integration-tests/suites/laya.test.ts`

**Interfaces:**
- Produces: `inject('laya'): { url: string; apiKey: string } | null` for both laya suites.

- [ ] **Step 1: Add the project-scoped failing check.** In `laya.test.ts`, replace the `BIN`/`ENABLED` gate with `const laya = inject('laya')` and `describe.skipIf(laya == null)`. Add `test('laya setup supplies a gate', () => { expect(laya).not.toBeUndefined() })` outside the skipped describe. Use `laya!.url` and `laya!.apiKey` inside existing tests. Remove its `beforeAll`, `afterAll`, `waitForHealth`, and process imports. Run `pnpm --filter mokei-integration-tests exec vitest run suites/laya.test.ts`. Expected: FAIL on the gate test before setup provides `laya`.
- [ ] **Step 2: Configure exact projects.** In `vitest.config.ts`, retain root `environment: 'node'` and `testTimeout: 120_000`, and add:

```ts
projects: [
  { test: { name: 'laya', include: ['suites/laya*.test.ts'], globalSetup: ['support/laya-setup.ts'] } },
  { test: { name: 'default', include: ['suites/**/*.test.ts'], exclude: ['suites/laya*.test.ts'] } },
],
```

- [ ] **Step 3: Implement setup.** Export `async function setup({ provide }: { provide: (key: 'laya', value: { url: string; apiKey: string } | null) => void })` or use Vitest's inferred setup context. Add the exact `ProvidedContext` module augmentation from the spec. If `MOKEI_LAYA_SERVE_BIN` is absent or empty, call `provide('laya', null)` and return. Otherwise use the existing `getPort`, `nano-spawn`, and warm-up code with `LAYA_HOST=127.0.0.1`, `LAYA_MODELS=english`, `LAYA_API_KEY=mokei-integration`, health limit `300_000`, and warm-up timeout `120_000`. Race health polling with process exit and preserve stderr in the failure. Provide `{ url, apiKey }` only after warm-up. Return a teardown that sends `SIGTERM` and awaits exit. In a `catch`, terminate and await exit before rethrowing. Vitest 5 does not impose the old `beforeAll` 330-second cap on global setup; use one 330-second setup deadline to cap the health and warm-up sequence.
- [ ] **Step 4: Verify project isolation.** Run `pnpm build`, then `pnpm --filter mokei-integration-tests exec vitest run suites/laya.test.ts`, then `pnpm --filter mokei-integration-tests exec vitest run suites/session.test.ts`. Expected without `MOKEI_LAYA_SERVE_BIN`: laya tests skip, session suite runs or skips by its own backend gate, and neither command starts laya.
- [ ] **Step 5: Commit.** `git add integration-tests/support/laya-setup.ts integration-tests/vitest.config.ts integration-tests/suites/laya.test.ts && git commit -m "test: share laya server across suites"`

### Task 5: Validate and route the support-triage example against laya

**Files:**
- Create: `integration-tests/suites/laya-decision-flow.test.ts`
- Modify: `integration-tests/package.json`
- Modify: `integration-tests/tsconfig.json`

**Interfaces:**
- Consumes: `inject('laya')` from Task 4, `createDecisionFlowGraph`, `flowDefinitionSchema`, `RunState`, and `createValidator`.
- Produces: shared `makeGraph({ apiKey?, actions? }?)` returning `{ graph, fetcher, createTicket }`; `observedRoute` and `expectedRoute` helpers for the remaining scenarios.

- [ ] **Step 1: Add the dependencies and JSON import.** Add `@sozai/schema` and `@sozai/flow-graph` to integration `devDependencies` with `catalog:`, then run `pnpm install`. Enable `resolveJsonModule: true` in `integration-tests/tsconfig.json`. Import the example exactly as `import example from '../../packages/decision-flow/examples/support-triage.json' with { type: 'json' }` and cast to `FlowDefinition`, as the package does not export it.
- [ ] **Step 2: Write the helper code and failing structural tests.** Use the same `BILLING` and `CRASH` strings from `laya.test.ts`. Create a real client with `defaultModel: 'english'`, `fetch: vi.fn((input, init) => globalThis.fetch(input, init))`, and a `createTicket` spy returning `{ created: true }`. Merge actions as `{ createTicket, ...params.actions }` so Task 6 can supply `record`. Read results from `runState.frames[0].results`. Define `Route = 'rejected' | 'ask' | 'billing' | 'technical' | 'error'`. Use this route logic in order:

```ts
function expectedRoute(results: Record<string, unknown>): Route {
  const guard = results.guard as { jailbreak?: { noul: number } } | undefined
  const triage = results.triage as { error?: unknown; department?: { confidence: number; choice: string } } | undefined
  if (!guard) return 'error'
  if ((guard.jailbreak?.noul ?? 0) > 0.8) return 'rejected'
  if (triage?.error) return 'technical'
  if ((triage?.department?.confidence ?? 0) < 0.6) return 'ask'
  if (triage?.department?.choice === 'billing') return 'billing'
  return 'technical'
}

function observedRoute(runState: RunState, createTicket: ReturnType<typeof vi.fn>): Route {
  if (runState.status === 'error') return 'error'
  if (runState.status === 'suspended') return runState.pending?.node as Route
  if (runState.outcome === 'rejected') return 'rejected'
  return (createTicket.mock.calls[0]?.[0] as { args: { ticket: { team: Route } } }).args.ticket.team
}
```

For each message, assert `observedRoute(run.runState, createTicket) === expectedRoute(run.runState.frames[0].results)`. If a guard answer exists, assert `noul` is within `[0, 1]`. If a triage department answer exists, assert the choice is among `billing`, `technical`, and `other`; confidence and each probability are within `[0, 1]`. Assert `createValidator(flowDefinitionSchema)(example)` has no `issues` and `graph.check(definition).ok === true` in a separate test.
- [ ] **Step 3: Verify green without the backend.** Run `pnpm build`, then `pnpm --filter mokei-integration-tests test`. Expected: typecheck and integration suites pass; the new laya suite skips when the environment variable is unset.
- [ ] **Step 4: Commit.** `git add integration-tests/suites/laya-decision-flow.test.ts integration-tests/package.json integration-tests/tsconfig.json pnpm-lock.yaml && git commit -m "test: exercise support triage against laya"`

### Task 6: Cover suspension, recovery, answer branches, and auth fallback

**Files:**
- Modify: `integration-tests/suites/laya-decision-flow.test.ts`

**Interfaces:**
- Consumes: Task 5's real-client graph factory and `RunState` helpers.

- [ ] **Step 1: Add four inline flow fixtures.** Give each a distinct `id`, `name`, `version: 1`, and `start`. Use `{ ref: ['input', 'message'] }` for every decide state. Use `{ type: 'choice', instructions: 'Which team?', criteria: { billing: 'payments', technical: 'bugs' } }` for suspension, recovery, and auth. Use `{ when: { not: { path: ['results', 'decide', 'department', 'confidence'], is: { greaterThanOrEqualTo: 0 } } }, to: 'unreachable' }` in the suspension fixture, with `default: 'ask'` and an `unreachable` end node. Set `ask` to `{ kind: 'input', schema: { enum: ['billing', 'technical'] }, next: 'route' }`. Branch `route` on `results.ask`, then end with `billing` or `technical` outcome. In recovery, set both the choice case and default to the `record` action, then end. In auth, set `default: 'success'`, `onError: 'fallback'`, and both targets to end nodes.
- [ ] **Step 2: Test suspend and resume.** Run the suspension fixture and assert `status === 'suspended'`, `pending?.node === 'ask'`, exactly one request, and a well-formed choice answer in `runState.frames[0].results.decide`. JSON round-trip the stored state, then use `graph.resume({ definition, runState, event: { type: 'value', value: 'billing' } })` and drain it. Assert final `outcome === 'billing'` and request count remains one. Use these exact terminal assertions:

```ts
expect(first.status).toBe('suspended')
expect(first.pending?.node).toBe('ask')
expect(fetcher).toHaveBeenCalledTimes(1)
expect(['billing', 'technical']).toContain(decideResult.department.choice)
expect(decideResult.department.confidence).toBeGreaterThanOrEqual(0)
expect(decideResult.department.confidence).toBeLessThanOrEqual(1)
expect(states.at(-1)?.outcome).toBe('billing')
expect(fetcher).toHaveBeenCalledTimes(1)
```
- [ ] **Step 3: Test recovery.** For the recovery fixture, route one decide node to a `record` action, then an end node. Call `const first = graph.start({ definition, input: { message: BILLING } })`; call `first.next()` until the yielded state has `inFlight?.node === 'decide'`. Save it and do not call `next()` again on `first`. Assert request count zero. On a fresh graph with the same counting fetch and `record` spy, drain `graph.recover({ definition, runState: checkpoint })`. Assert final status `ended`, every recovered revision exceeds `checkpoint.revision`, exactly one request, a well-formed decide result, and `record` called once:

```ts
expect(fetcher).toHaveBeenCalledTimes(0)
expect(states.at(-1)?.status).toBe('ended')
expect(states.every((state) => state.revision > checkpoint.revision)).toBe(true)
expect(fetcher).toHaveBeenCalledTimes(1)
expect(['billing', 'technical']).toContain(decideResult.department.choice)
expect(record).toHaveBeenCalledTimes(1)
```
- [ ] **Step 4: Test score and noul branching.** Make one decide node ask `urgency: { type: 'score', instructions: 'How urgent?', criteria: ['low', 'medium', 'high'] }` and `complaint: { type: 'noul', instructions: 'Is this a complaint?' }`. Put `urgency.score greaterThan 1` to `urgent` first, then `complaint.noul greaterThan 0.5` to `complaint`, with default `ordinary`; make all three targets end nodes with matching outcomes. Assert `Number.isFinite(urgency.score)`, `complaint.noul` within `[0, 1]`, and `run.outcome === (urgency.score > 1 ? 'urgent' : complaint.noul > 0.5 ? 'complaint' : 'ordinary')`.
- [ ] **Step 5: Test wrong-key fallback.** With `apiKey: 'wrong'`, set the decide node `retry: { maxAttempts: 3 }` and `onError: 'fallback'`. Use these exact assertions:

```ts
expect(run.status).toBe('ended')
expect(run.outcome).toBe('fallback')
expect(run.runState.frames[0]?.results.decide).toEqual({
  error: { type: 'SystemOneAuthError', reason: 'non_retryable', attempts: 1 },
})
expect(run.runState.frames[0]?.results.decide).not.toHaveProperty('error.message')
expect(fetcher).toHaveBeenCalledTimes(1)
```
- [ ] **Step 6: Verify green.** Run `pnpm build`, then `pnpm --filter mokei-integration-tests test`. Expected without `MOKEI_LAYA_SERVE_BIN`: all non-laya tests pass and laya tests skip. With the variable set, use the final manual task before keeping either pinned route.
- [ ] **Step 7: Commit.** `git add integration-tests/suites/laya-decision-flow.test.ts && git commit -m "test: cover laya decision-flow recovery and fallback"`

### Task 7: Document integration requirements and record the release intent

**Files:**
- Modify: `integration-tests/README.md`
- Create: `.changeset/decision-flow-laya-retries.md`

**Interfaces:**
- Produces: integration run instructions and one patch release intent.

- [ ] **Step 1: Update the README.** Add `built-entries` to the “nothing beyond a build” row. List `laya` and `laya-decision-flow` in the laya row. State that targeted non-laya runs do not start `laya-serve` because the laya suites have their own Vitest project.
- [ ] **Step 2: Add the changeset with exact content.**

```md
---
'@mokei/system-one-client': patch
---

Add opt-in retries for transient System One HTTP failures and export retry classification.
```

- [ ] **Step 3: Verify green.** Run `rtk proxy pnpm run lint`, then `pnpm build`, then `pnpm test`, then `pnpm change status`. Expected: lint, build, and tests pass without `MOKEI_LAYA_SERVE_BIN`; laya suites skip; change status includes the system-one-client patch intent and lockstep public-package movement.
- [ ] **Step 4: Commit.** `git add integration-tests/README.md .changeset/decision-flow-laya-retries.md && git commit -m "docs: record laya test requirements and retry changeset"`

### Task 8: Manually verify the shared laya server and checkpoint pins

**Files:**
- Modify only if a pin fails: `integration-tests/suites/laya-decision-flow.test.ts`
- Completion notes: record any dropped pin in the controller's completion summary for this plan.

**Interfaces:**
- Consumes: `MOKEI_LAYA_SERVE_BIN` pointing to a working `laya-serve` executable.

- [ ] **Step 1: Build.** Run `pnpm build`. Expected: exit 0.
- [ ] **Step 2: Run both laya suites together.** Run `MOKEI_LAYA_SERVE_BIN=/absolute/path/to/laya-serve pnpm --filter mokei-integration-tests exec vitest run suites/laya.test.ts suites/laya-decision-flow.test.ts`. Expected: both pass with one laya project setup and one server process.
- [ ] **Step 3: Add and check the checkpoint pins.** Add two tests using the Task 5 graph helper. For `BILLING`, assert `observedRoute(run.runState, createTicket) === 'billing'`. For `CRASH`, assert `observedRoute(run.runState, createTicket) === 'technical'`. Run `MOKEI_LAYA_SERVE_BIN=/absolute/path/to/laya-serve pnpm --filter mokei-integration-tests exec vitest run suites/laya-decision-flow.test.ts` three separate times. Keep each pin only if it passes all three runs. If either pin fails once, delete only that pin test, preserve the structural route test, and record the drop below before committing.
- [ ] **Step 4: Final verification.** Run `rtk proxy pnpm run lint`, then `pnpm build`, then `pnpm test`. Expected: all pass; with the variable unset, laya suites skip. Run `git status --short` and confirm no unintended files changed.
- [ ] **Step 5: Commit the checked pins and notes.** `git add integration-tests/suites/laya-decision-flow.test.ts docs/superpowers/plans/2026-09-29-decision-flow-laya-and-retries.md && git commit -m "test: pin stable laya decision routes"`. If neither pin holds, commit the completion notes alone with message `docs: record laya checkpoint observations`.

## Completion notes

Record the three-run result for each message here during Task 8. Name any dropped pin and its failing run. Leave this section empty until the manual run occurs.
