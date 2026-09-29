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
- Set: `predict` runs inside `retry()` with `retryable: retryableSystemOneError` and the
  caller's `signal`. Each attempt uses the attempt signal `retry()` provides, so
  `attemptTimeoutMs` aborts the in-flight request.

`retry()` throws `RetryExhaustedError` when a limit is reached. The backend unwraps it so
callers keep seeing the client's error classes:

- `reason: 'attempts'`: rethrow the cause, the last `SystemOneError`.
- `reason: 'total_timeout'`: throw `SystemOneConnectionError` with the message
  `System One request did not complete within the retry budget` and the original error as
  `cause`.
- A caller abort rethrows the abort reason, as today.

The README notes that decide nodes carry their own `retry` policy and that stacking both
multiplies attempts, so flows should leave the backend's `retry` unset.

### Tests

Unit tests with a stubbed `fetch`:

- 503 then success resolves after two requests.
- 429 with `Retry-After: 1` waits at least the header delay (fake timers).
- 401 is not retried: one request, `SystemOneAuthError`.
- Exhausted attempts rethrow the last `SystemOneConnectionError` subclass, not
  `RetryExhaustedError`.
- A total-timeout exhaustion throws `SystemOneConnectionError` with the budget message.
- Aborting the caller signal during a backoff stops the loop with the abort reason.
- No `retry` option: a 503 fails after one request.

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
  Integration suites already require a build, so this runs after it without a rebuild.

## 3. Laya decision-flow suite (`integration-tests`)

### Shared server

Move the `laya-serve` lifecycle out of `suites/laya.test.ts` into a vitest `globalSetup`,
`support/laya-setup.ts`, registered in `vitest.config.ts`:

- Does nothing unless `MOKEI_LAYA_SERVE_BIN` is set.
- Starts the server on a free port with only the english checkpoint and the fixed API key,
  waits for `/health` (failing fast with stderr if the process exits first), and runs the
  warm-up prediction.
- Exposes the URL and API key to suites through `provide` / `inject`; teardown sends
  `SIGTERM`.

`laya.test.ts` reads the URL from `inject` and otherwise keeps its tests unchanged. Both laya
suites share one server, so the checkpoint loads once.

### New suite: `suites/laya-decision-flow.test.ts`

Skipped unless `MOKEI_LAYA_SERVE_BIN` is set. Builds a graph with `createDecisionFlowGraph`, a
real `createSystemOneClient` (`defaultModel: 'english'`) and a `createTicket` spy action, over
decision-flow's `examples/support-triage.json`.

Tests:

1. **Example validates.** The example passes `flowDefinitionSchema` and `graph.check`.
2. **Billing message routes to billing.** The run completes through `guard`, `triage`,
   `billing`; `createTicket` runs once with a stable `invocationID`;
   `results.triage.department` is well formed (declared choice, confidence and probabilities
   in [0, 1]).
3. **Crash message routes to technical.**
4. **Low-confidence fallback is handled either way.** For an ambiguous message the run either
   completes at `billing` or `technical`, or suspends at `ask`; when suspended, the test
   resumes with `{ type: 'value', value: 'billing' }` and the run completes at `billing`.
5. **Streaming and recovery.** `graph.start` yields strictly increasing `revision`s. Recovering
   with `graph.recover` from an intermediate `running` state reaches the same final status and
   route as the uninterrupted run.
6. **Score and noul branching.** An inline flow with one `score` and one `noul` question
   branches on thresholds; the test asserts well-formed answers and that the branch taken is
   the one the recorded answers select, not a specific value.
7. **Wrong API key takes `onError`.** The example's `guard` has no `onError`, so this test
   uses an inline flow: one `decide` node with a `retry` policy and `onError` pointing at a
   fallback node. With a bad key, the `SystemOneAuthError` is not retried (one attempt), the
   run follows `onError` and completes at the fallback, and the recorded error metadata has
   `type: 'SystemOneAuthError'` and no message.

Only tests 2 and 3 pin a route, and only on the unambiguous messages `laya.test.ts` already
pins. Every other assertion is structural, because answers are model-dependent.

### README

In `integration-tests/README.md`, the `laya` requirements row lists both laya suites, and
`built-entries` joins the "nothing beyond a build" row.

## Verification

- `rtk proxy pnpm run lint` clean.
- `pnpm test` passes without `MOKEI_LAYA_SERVE_BIN` (laya suites skip).
- With `MOKEI_LAYA_SERVE_BIN` set, both laya suites pass against one server.
