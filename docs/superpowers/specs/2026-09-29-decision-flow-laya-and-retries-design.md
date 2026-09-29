# Decision flow: laya integration, HTTP retries and smoke-test cost

**Date:** 2026-09-29
**Branch:** `feat/decision-flow-follow-ons`
**Origin:** `docs/agents/plans/backlog/2026-09-28-decision-flow-follow-ons.md`

## Goal

Exercise `@mokei/decision-flow` end to end against a real System One backend (`laya-serve`),
let `HTTPSystemOneBackend` retry transient failures on request, and stop the decision-flow test
script from rebuilding the package.

This is the first of four specs covering the decision-flow follow-ons:

1. **This spec:** laya integration suite, opt-in HTTP retries, smoke-test cost.
2. MCP Tasks extension (`io.modelcontextprotocol/tasks`, `2026-07-28` only) in
   `context-protocol`, `context-server` and `context-client`.
3. `check_flow` and `run_flow` tools in `mcp-servers/system-one`, running flows as MCP tasks:
   a `wait`/`input` suspension surfaces as `input_required`, `tasks/update` resumes the run and
   `tasks/cancel` cancels it.
4. `AgentSession` integration (flows gating or routing session turns).

Out of scope, staying in the backlog: flow references (blocked on `@sozai/flow-graph`
`FlowResolver`), tracer version (blocked on the kigu SWC config), checker coverage (revisit
only if kinds expose filter-typed fields).

## 1. Opt-in HTTP retries (`@mokei/system-one-client`)

### Classification

Move the retry classification from `@mokei/decision-flow` (`decide-error.ts`) into the client
as an exported `retryableSystemOneError(error: unknown): RetryDecision`:

- Retry `SystemOneConnectionError` with no status (network failure) or with status 408, 429,
  500, 502, 503, 504 or 529.
- For `SystemOneRateLimitError` and `SystemOneOverloadedError` with a finite `retryAfterMs`,
  return `{ afterMs: retryAfterMs }`; otherwise `true`.
- Everything else (auth, input, model, response validation, aborts) returns `false`.

`RetryDecision` comes from `@sozai/async`, which becomes a client dependency (already in the
workspace catalog). `retryableDecision` in decision-flow keeps its name and export and delegates
to `retryableSystemOneError`, so the decide node's engine-level retries are unchanged.

### Backend option

`HTTPSystemOneBackendParams` and `SystemOneHTTPClientParams` gain `retry?: RetryPolicy`
(`@sozai/async`). `createSystemOneClient` passes it to the backend.

- Unset: one attempt, the current behaviour.
- Set: `predict` runs inside `retry()` with the caller's `signal`. Each attempt uses the attempt
  signal `retry()` provides, so `attemptTimeoutMs` aborts the in-flight request.

Error mapping happens at two levels:

- **Per attempt:** the existing `mapError` wraps each attempt's HTTP call inside the `retry()`
  callback, so the `retryable` predicate sees `SystemOneError` subclasses, never ky's
  `HTTPError`.
- **After `retry()`:** a separate `mapRetryError` maps what escapes `retry()` (table below).
  `mapError` never wraps `retry()` itself, which would turn `RetryExhaustedError` into a generic
  connection error.

Without a `retry` option the backend keeps today's single `mapError` call and never enters
`retry()`.

The `retryable` predicate passed to `retry()` is: retry a `TimeoutInterruption` whose `cause` is
`'attempt'` (an attempt that hit `attemptTimeoutMs`, raised by `retry()` itself, not by the
HTTP error mapper), otherwise defer to `retryableSystemOneError`. `retryableSystemOneError`
itself stays about System One errors only, because decision-flow uses it for engine retries
where the engine handles its own attempt timeouts.

`retry()` throws `RetryExhaustedError` when a limit is reached, and throws a `TimeoutInterruption`
or other non-retryable error as is. The backend maps what escapes so callers only see the
client's error classes (or the caller's abort reason):

| What escapes `retry()` | Backend throws |
|---|---|
| Caller signal aborted | The abort reason, unchanged |
| A non-retryable `SystemOneError` | That error, unchanged |
| `RetryExhaustedError`, `reason: 'attempts'`, cause is a `SystemOneError` | The cause (the last attempt's error) |
| `RetryExhaustedError`, `reason: 'attempts'`, cause is an attempt `TimeoutInterruption` | `SystemOneConnectionError`, message `System One request timed out`, `cause` the `RetryExhaustedError` |
| `RetryExhaustedError`, `reason: 'total_timeout'` | `SystemOneConnectionError`, message `System One request did not complete within the retry budget`, `cause` the `RetryExhaustedError` |

For `total_timeout` the `RetryExhaustedError` cause varies (the last HTTP error, a deadline
`TimeoutInterruption`, or `undefined` when the deadline passes before an attempt), so the
backend keeps the whole `RetryExhaustedError` as `cause` rather than picking one.

The README notes that decide nodes carry their own `retry` policy and that stacking both
multiplies attempts, so flows should leave the backend's `retry` unset.

### Tests

Unit tests with a stubbed `fetch` that counts requests:

- No `retry` option: a 503 fails after one request with `SystemOneConnectionError`.
- 503 then success resolves after two requests.
- 429 with `Retry-After: 1` waits at least the header delay before the second request (fake
  timers).
- 401 is not retried: one request, `SystemOneAuthError`.
- Exhausted attempts on 503s rethrow the last `SystemOneConnectionError` (status 503), not
  `RetryExhaustedError`.
- A `fetch` that hangs until its signal aborts, with `attemptTimeoutMs`: each attempt is
  aborted and retried; exhaustion throws `SystemOneConnectionError('System One request timed
  out')` after `maxAttempts` requests.
- `totalTimeoutMs` passing during a hanging attempt throws `SystemOneConnectionError` with the
  budget message and a `RetryExhaustedError` cause.
- A backoff that would cross `totalTimeoutMs` (checked by `retry()` before it sleeps; there is
  no deadline timer during the sleep) throws the same budget error without a further request.
- Aborting the caller signal during an in-flight request, and during a backoff sleep, rejects
  with the abort reason and sends no further requests.

`retryableSystemOneError` gets the classification cases currently in decision-flow's
`decide-error.test.ts`; decision-flow keeps a short delegation test.

A changeset records a patch for `@mokei/system-one-client` (lockstep versioning moves all
public packages).

## 2. Smoke-test cost (`@mokei/decision-flow`)

`test:built` runs `pnpm run build` inside `test`, bypassing Turbo's build cache.

- decision-flow's `test` script becomes `pnpm run test:types && pnpm run test:unit`.
- Delete `test/built-entry.mjs` and the `test:built` script.
- Add `integration-tests/suites/built-entries.test.ts`, importing `@mokei/decision-flow` (which
  resolves to the built `lib/`) and asserting the same export names the smoke script checks.
  Integration suites already require a build (`integration-tests/README.md`), so this runs
  against the build without triggering another. The root `pnpm test` does not build first;
  the verification below runs `pnpm build` before it, as CI and the README already do.

## 3. Laya decision-flow suite (`integration-tests`)

### Shared server, scoped to the laya suites

Move the `laya-serve` lifecycle out of `suites/laya.test.ts` into a vitest `globalSetup`,
`support/laya-setup.ts`. Register it on a dedicated vitest project so it only runs when a laya
suite is selected. In `vitest.config.ts`, `test.projects` (vitest 5) defines two projects:

- `laya`: `include: ['suites/laya*.test.ts']`, `globalSetup: ['support/laya-setup.ts']`.
- `default`: every other suite, `exclude`-ing `suites/laya*.test.ts`, with no global setup.

Both keep today's `environment: 'node'` and `testTimeout: 120_000`. `pnpm test` runs both
projects; `pnpm exec vitest run suites/session.test.ts` never starts laya.

The setup file:

- Declares the injected value with module augmentation:
  `declare module 'vitest' { interface ProvidedContext { laya: { url: string; apiKey: string } | null } }`.
- When `MOKEI_LAYA_SERVE_BIN` is unset, provides `laya: null` and starts nothing.
- Otherwise starts the server on a free port with only the english checkpoint and the fixed API
  key, waits for `/health` (failing fast with stderr if the process exits first; same limits as
  today: 300 s health, 120 s warm-up timeout), runs the warm-up prediction, then provides
  `{ url, apiKey }` and returns a teardown that sends `SIGTERM` and awaits exit.
- If the health wait or warm-up throws, kills the child and awaits its exit before rethrowing,
  so a failed setup never leaves `laya-serve` running.

Both laya suites call `inject('laya')` and use `describe.skipIf(laya == null)`. `laya.test.ts`
otherwise keeps its tests unchanged. The checkpoint loads once for both suites.

### New suite: `suites/laya-decision-flow.test.ts`

Skipped when `inject('laya')` is `null`. Each test builds a graph with
`createDecisionFlowGraph`, a real `createSystemOneClient` (`defaultModel: 'english'`) whose
`fetch` is wrapped to count requests, and a `createTicket` spy action returning
`{ created: true }` (actions must return a JSON value).

`integration-tests` adds `@sozai/schema` and `@sozai/flow-graph` (types) as catalog
devDependencies for `createValidator` and `RunState`.

The example is not a package export. Import it by relative path with the JSON import
attribute: `import example from '../../packages/decision-flow/examples/support-triage.json' with
{ type: 'json' }`, enabling `resolveJsonModule` in `integration-tests/tsconfig.json` if needed.

Results live on the run state at `runState.frames[0].results`, keyed by node ID.

#### Route helpers for the example

Both helpers return one of `'rejected' | 'ask' | 'billing' | 'technical' | 'error'`.

`observedRoute(runState, createTicket)` reads what the run did:

- `status === 'error'`: `'error'`.
- `status === 'suspended'`: `runState.pending.node` (the example only suspends at `ask`).
- `status === 'ended'` and `outcome === 'rejected'`: `'rejected'`.
- `status === 'ended'` and `outcome === 'routed'`: the `team` argument of the single
  `createTicket` call (`billing` or `technical`). Both action nodes advance to `done`, so the
  final node cannot tell them apart.

`expectedRoute(results)` recomputes the example's rules, in its case order, from the recorded
results:

1. No `guard` result (guard failed; it has no `onError`): `'error'`.
2. `guard.jailbreak.noul > 0.8`: `'rejected'`.
3. `triage.error` is set (triage exhausted its retries or failed non-retryably; `onError` is
   `technical`): `'technical'`.
4. `triage.department.confidence < 0.6`: `'ask'`.
5. `triage.department.choice === 'billing'`: `'billing'`.
6. Otherwise: `'technical'`.

#### Tests

1. **Example validates.** The example passes `flowDefinitionSchema` (via `createValidator`) and
   `graph.check`.
2. **Example routes follow the recorded answers.** For each of the billing and crash messages
   from `laya.test.ts`, run the example with `graph.run`. When present, `guard.jailbreak.noul`
   is in [0, 1] and `triage.department` has a declared choice, `confidence` in [0, 1] and
   probabilities in [0, 1]. `observedRoute` equals `expectedRoute`.
3. **Example checkpoint regression.** For the billing message the run routes to `billing`; for
   the crash message, to `technical`. These are the only pinned assertions. Before committing
   them, the implementer runs the suite against `laya-serve` three times; a pin that does not
   hold in all three runs is dropped and the drop recorded in the plan's completion notes,
   leaving test 2 as that message's coverage.
4. **Decide then suspend then resume.** Inline flow: a `decide` node with one `choice` question
   whose only case can never match a valid answer (`confidence` `greaterThan` 1), so it always
   takes its `default`, an `input` node `ask` (`schema: { enum: ['billing', 'technical'] }`,
   `next` a branch on `results.ask`), then two `end` nodes with outcomes `billing` and
   `technical`. The run suspends with `pending.node === 'ask'` after exactly one prediction
   request and a well-formed decide result; resuming with `{ type: 'value', value: 'billing' }`
   ends with outcome `billing` and no further prediction request.
5. **Recover from an in-flight checkpoint.** Inline flow: one `decide` node (no guard, no
   fallback) whose cases route to a `record` action, then `end`. Stream `graph.start` with
   `next()` and keep the first yielded state whose `inFlight?.node` is the decide node; stop
   calling `next()` on that run (it is abandoned, not closed; `FlowRun` has no `return()`).
   The engine yields that checkpoint before the decide node executes, so the request counter
   is still 0. Then call `graph.recover` with the saved state on a fresh graph and drain it.
   Assert: the recovered run ends; its revisions are all greater than the checkpoint's;
   exactly one prediction request was made; the decide result is well formed; `record` ran
   once. This checks that a persisted checkpoint resumes against a real backend; replay of a
   request interrupted mid-flight is covered by decision-flow's unit tests.
6. **Score and noul branching.** Inline flow with one `score` and one `noul` question that
   branches on thresholds; the test asserts well-formed answers and that the branch taken is
   the one the recorded answers select.
7. **Wrong API key takes `onError`.** Inline flow: one `decide` node with
   `retry: { maxAttempts: 3 }` and `onError` pointing at a fallback `end` node. With a bad key,
   the run ends at the fallback; `results.<decide>.error` is
   `{ type: 'SystemOneAuthError', reason: 'non_retryable', attempts: 1 }` with no message
   field; the counting `fetch` saw exactly one request.

### README

In `integration-tests/README.md`, the `laya` requirements row lists both laya suites, the
`built-entries` suite joins the "nothing beyond a build" row, and a line notes that the laya
suites run in their own vitest project so other targeted runs never start `laya-serve`.

## Verification

- `rtk proxy pnpm run lint` clean.
- `pnpm build`, then `pnpm test` passes without `MOKEI_LAYA_SERVE_BIN` (laya suites skip).
- With `MOKEI_LAYA_SERVE_BIN` set, both laya suites pass against one server.
