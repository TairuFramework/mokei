# Decision flow laya suite and HTTP retries

**Status:** complete (2026-09-29)
**Packages:** changed `@mokei/system-one-client`, `@mokei/decision-flow`; `integration-tests`
**Origin:** follow-on of [decision flows](2026-09-28-decision-flow.complete.md)

## Goal

Exercise decision flows end to end against a real laya backend, make the System One HTTP backend
retry transient failures when asked to, and stop the decision-flow smoke test from rebuilding the
package inside `test`.

## Key decisions

- **Opt-in retries.** `HTTPSystemOneBackendParams` and `SystemOneHTTPClientParams` take an
  optional `retry: RetryPolicy` (`@sozai/async`). Without it, a request makes exactly one attempt,
  as before. Callers that already retry at a higher level, such as a `decide` node, stay unchanged.
- **One classification.** `retryableSystemOneError` moved into `@mokei/system-one-client` and is
  exported. `retryableDecision` in decision-flow delegates to it, so both layers retry the same
  statuses (none, 408, 429, 500, 502, 503, 504, 529) and honour a finite `retryAfterMs`.
- **Two-level error mapping.** Each attempt maps its failure to a `SystemOneError` before the
  retry predicate sees it. What escapes `retry()` is mapped again: an abort gives the abort reason,
  a non-retryable error is rethrown unchanged, attempt exhaustion gives the last `SystemOneError`,
  and an attempt or total timeout gives a `SystemOneConnectionError` whose cause is the
  `RetryExhaustedError`.
- **Smoke test in integration.** The built-entry export check moved to
  `integration-tests/suites/built-entries.test.ts`, which runs after the cached build. The
  decision-flow `test` script is now types plus unit tests only.
- **Shared laya server.** The laya suites run in their own Vitest project (`laya`) whose global
  setup starts one `laya-serve` on a free port, warms it up and provides `{ url, apiKey }` through
  `inject('laya')`. It provides `null` when `MOKEI_LAYA_SERVE_BIN` is unset, and the suites skip.
  Other projects never start the server.
- **Model-independent assertions.** Route tests compare the observed route with the route the
  recorded answers imply, instead of pinning a team. Pins are kept only when stable across three
  runs.

## What was built

- `@mokei/system-one-client`: `retry` option on the HTTP backend and client, exported
  `retryableSystemOneError`, tests for each mapping row and for aborting during backoff.
- `integration-tests`: `support/laya-setup.ts`, the `laya` and `default` projects,
  `built-entries.test.ts`, and `laya-decision-flow.test.ts`. The last covers the support-triage
  example (validation, graph check, routing), suspend and resume after a JSON round trip, recovery
  of an in-flight checkpoint on a fresh graph, score and noul branching, and the wrong-key
  fallback (one request, `SystemOneAuthError`, `non_retryable`).
- README requirements for both laya suites, and a patch release intent for
  `@mokei/system-one-client` (lockstep 0.14.1).

## Notes

- Pins with the english checkpoint: the billing message routes to `billing` in 3 of 3 runs and is
  pinned. The crash message routes to `ask` in 3 of 3 runs (department confidence below 0.6), so
  its `technical` pin was dropped. The structural route test still covers it.
- The context-client test `ackTimeoutMs fails an unacknowledged candidate` failed once under full
  `pnpm test` load (10 ms timing) and passed in isolation. It is unrelated to this work.

Follow-on work: `backlog/2026-09-28-decision-flow-follow-ons.md`.
