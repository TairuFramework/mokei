# Flow review follow-ups

**Status:** complete

## Goal

Fix the gaps, bugs, convention breaks and duplication found by the post-merge review of the flow
rig and flow daemon milestones (PRs #68-#74). Then adopt the helpers that sozai and tejika shipped
in response to the requests mokei sent upstream. There was no separate spec. The review findings
were the requirements.

## Key decisions

- No new packages. Shared code moves along the existing dependency graph. `@mokei/flow-client`
  owns the run-state, error-code and span-nesting helpers. `@mokei/context-protocol` owns the
  browser-safe elicitation form-field parser.
- The flow database checks its schema version before it sets the WAL pragma. Reopening a database
  that is already at the latest version must succeed.
- `withTransaction` lives in its own module in `@mokei/flow-host-node` and is shared by the SQLite
  stores.
- Error classes take a single `Params` object. `FlowHostErrorDescription.code` is derived from
  `FlowControlErrorCode` instead of restating the codes.
- `mokei daemon` delegates fully to `createDaemonCommand` from `@tejika/cli`. It does not keep its
  own start and stop logic. Accepted consequences:
  - `--pid-path` is now honoured.
  - The JSON of a failed start no longer carries `flowService`.
  - Human status output uses the upstream labels.
  - Start and readiness have separate 30 s budgets.
- `@sozai/async` `lazy()` is used only where the memoised promise is internal and always awaited.
  It is not used for a public `dispose()` or a shutdown callback. Its body runs only when awaited,
  so a caller that does not await would never trigger cleanup.
- The `@logtape/logtape` catalog moves to `^2.3.11`. With two versions installed, `@enkaku/server`
  split into two peer variants and broke `HandlerError` instanceof checks.

## What was built

- Schema version check, shared transaction helper, and inbox reconcile that skips existing items.
- One set of flow types, error codes, span nesting and the elicitation parser, shared by the host,
  the CLI and the monitor.
- `decision.predict` spans descend from `flow.run`.
- `@sozai/async` adoption: `createKeyedQueue`, `settleAll`, `settleSequential`, `raceSignal`,
  `whenAborted`, `sleep` and `lazy`. Also `toJSONValue` from `@sozai/json` and `renderLogMessage`
  from `@sozai/log`.
- `@tejika` adoption:
  - `@tejika/cli`: the daemon command and the output helpers.
  - `@tejika/ui`: the prompt components.
  - `@tejika/log`: `followLog`.
  - `@tejika/env`: `expandHome` and `readJSONFile`.
  - `@tejika/test`: `spawnCLI`, `runCLI`, `createTestProfile` and `poll`, in the integration tests.
- Unused CLI dependencies removed. The milestone docs moved to `completed/`. The CLI docs and the
  release intent were updated.

## Not adopted

SQLite helpers and a Node OpenTelemetry setup were proposed upstream, but no shared package exists
yet. Mokei keeps its own code for both.
