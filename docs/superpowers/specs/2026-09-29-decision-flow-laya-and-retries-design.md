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
- `totalTimeoutMs` passing during a hanging attempt, and during a backoff sleep, both throw
  `SystemOneConnectionError` with the budget message and a `RetryExhaustedError` cause.
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

### Shared server

Move the `laya-serve` lifecycle out of `suites/laya.test.ts` into a vitest `globalSetup`,
`support/laya-setup.ts`, registered in `vitest.config.ts`.

- Declare the injected value with module augmentation in the setup file:
  `declare module 'vitest' { interface ProvidedContext { laya: { url: string; apiKey: string } | null } }`.
- When `MOKEI_LAYA_SERVE_BIN` is unset, provide `laya: null` and start nothing.
- Otherwise start the server on a free port with only the english checkpoint and the fixed API
  key, wait for `/health` (failing fast with stderr if the process exits first, same limits as
  today: 300 s health, 120 s warm-up timeout), run the warm-up prediction, then provide
  `{ url, apiKey }` and return a teardown that sends `SIGTERM` and awaits exit.
- If the health wait or warm-up throws, kill the child and await its exit before rethrowing,
  so a failed setup never leaves `laya-serve` running.

Both laya suites call `inject('laya')` and use `describe.skipIf(laya == null)`. `laya.test.ts`
otherwise keeps its tests unchanged. The checkpoint loads once for both suites.

### New suite: `suites/laya-decision-flow.test.ts`

Skipped when `inject('laya')` is `null`. Builds a graph with `createDecisionFlowGraph`, a real
`createSystemOneClient` (`defaultModel: 'english'`) whose `fetch` is wrapped to count requests,
and a `createTicket` spy action returning `{ created: true }` (actions must return a JSON value).

The example is not a package export. Import it by relative path with the JSON import
attribute: `import example from '../../packages/decision-flow/examples/support-triage.json' with
{ type: 'json' }`, enabling `resolveJsonModule` in `integration-tests/tsconfig.json` if needed.

Results live on the run state at `runState.frames[0].results`, keyed by node ID; the paths
below are relative to that.

The example's routing depends on model answers (a jailbreak `guard`, a department question
with an `other` choice, and a confidence fallback to `ask`), so the suite pins no route.
Instead, a helper `expectedRoute(results)` recomputes the example's own rules from the recorded
answers: `guard.jailbreak.noul > 0.8` gives `reject`; else `triage.department.confidence < 0.6`
gives `ask`; else `choice === 'billing'` gives `billing`; else `technical`. Tests assert the run
took that route. This checks the engine's branching against real answers without depending on
what the checkpoint answers. The existing `laya.test.ts` routing test stays the checkpoint
regression.

Tests:

1. **Example validates.** The example passes `flowDefinitionSchema` and `graph.check`.
2. **Billing and crash messages follow their recorded answers.** For each of the two messages
   from `laya.test.ts`, run the example with `graph.run`. `guard.jailbreak.noul` is in [0, 1];
   when `triage` ran, `triage.department` has a declared choice, `confidence` in [0, 1] and
   probabilities in [0, 1]. The route taken (the terminal node, or `ask` when the run is
   `suspended`) equals `expectedRoute(results)`. When the route reaches `billing` or
   `technical`, `createTicket` ran exactly once.
3. **A suspended run resumes.** For an ambiguous message, if the run suspends at `ask`, resume
   with `{ type: 'value', value: 'billing' }` and assert the run ends at `billing` with
   `results.ask === 'billing'`. If it does not suspend, assert its route matches
   `expectedRoute` instead, so the test passes either way without skipping.
4. **Streaming revisions and recovery.** Stream `graph.start` and assert strictly increasing
   `revision`s. Then run again, stop the iterator (`return()`) after the first yielded state
   whose `inFlight?.node === 'triage'`, and call `graph.recover` with that state. Assert the
   recovered run replays `triage` with the same `inFlight.invocationID`, ends with status
   `ended`, and `createTicket` ran at most once across both runs. Route equality with an
   uninterrupted run is not asserted: a replayed `triage` makes a fresh prediction. (Replay
   determinism is covered by decision-flow's unit tests with a fixed backend.)
5. **Score and noul branching.** An inline flow with one `score` and one `noul` question
   branches on thresholds; the test asserts well-formed answers and that the branch taken is
   the one the recorded answers select.
6. **Wrong API key takes `onError`.** The example's `guard` has no `onError`, so this test uses
   an inline flow: one `decide` node with `retry: { maxAttempts: 3 }` and `onError` pointing at
   a fallback node. With a bad key, the run ends at the fallback; `results.<decide>.error` is
   `{ type: 'SystemOneAuthError', reason: 'non_retryable', attempts: 1 }` with no message field;
   the counting `fetch` saw exactly one request.

### README

In `integration-tests/README.md`, the `laya` requirements row lists both laya suites, and
`built-entries` joins the "nothing beyond a build" row.

## Verification

- `rtk proxy pnpm run lint` clean.
- `pnpm build`, then `pnpm test` passes without `MOKEI_LAYA_SERVE_BIN` (laya suites skip).
- With `MOKEI_LAYA_SERVE_BIN` set, both laya suites pass against one server.
