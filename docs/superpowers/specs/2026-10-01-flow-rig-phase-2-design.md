# Flow rig phase 2 -- integration harness design

**Milestone:** `docs/agents/plans/milestones/2026-09-30-flow-rig-milestone.md`, phase 2
**Branch:** `feat/flow-rig`

## Goal

Run the flow rig's scenarios in CI without a desktop or System One. The suite drives the rig's facade tools
end to end, the same way Claude Code does, over a real stdio process boundary. It replaces the phase 1 smoke run
and automates the manual QA checklist, except for the parts that need a real desktop and a real System One.

## Decisions

- **Target: the rig facade.** The suite calls `start_flow`, `flow_status` and the input tools. It covers the
  rig's approval, run manager, inbox and dialog routing, and the stack below them. Stack-only scenarios without
  the facade are out of scope.
- **Real process boundary.** The suite spawns a rig process over stdio. It does not call the rig in-process.
- **Stubs are injected in code, not config.** The rig config gains no test-only fields. The stub desktop uses the
  existing `@mokei/host-desktop` test seam (`createBackend`, `runner`, `platform`, `env` on
  `createDesktopElicitHandler`). No package changes.
- **The fake predictor stays config-driven.** `predictor: fake` with `fakeAnswers` already exists and covers
  System One.
- **The smoke run is removed.** The integration suite supersedes all its checks and runs in CI.
- **No new package.** The rig stays a script under `scripts/flow-rig/`.

## Components

### `scripts/flow-rig/serve.mjs`: `createRig`

`main({ configPath, stdio })` becomes `createRig({ configPath, desktop })`, returning `{ tools, shutdown }`.

- `createRig` no longer calls `serveProcess`.
- `desktop` is optional: `{ createBackend, runner, platform, env }`. When given, it is passed to both
  `createDesktopElicitHandler` calls (flow input and the confirm dialog). When omitted, behaviour is unchanged.
- The CLI entry at the bottom of `serve.mjs` loads the config path, calls `createRig`, calls `serveProcess` with
  the tools, and keeps the existing signal and stdin-end shutdown handling.

### `integration-tests/support/flow-rig/stub-rig.mjs`

A test entry, spawned by the suite. It reads the config path from `FLOW_RIG_CONFIG`, calls `createRig` with a
stub desktop, and serves the rig tools merged with two test-only tools through `serveProcess`.

The stub desktop:

- Backend detection checks real executables and session variables before it calls `createBackend`. So the stub
  entry creates a temporary directory holding executable `zenity` and `notify-send` files (`#!/bin/sh` +
  `exit 0`). It passes `env: { PATH: <that dir>, DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/stub' }`
  and `platform: 'linux'`. This is the same approach as `packages/host-desktop/test/elicit-handler.test.ts`.
- A runner whose `run` rejects, so no command ever runs. `stub_dialogs` reports the runner call count, and the
  suite asserts it stays 0.
- A `createBackend` that returns stub backends for `zenity` (ask) and `notify-send` (notify).
- Each `ask` call is recorded and stays pending until the test settles it, or until its `signal` aborts. On
  abort the stub rejects with the signal reason, removes its listener and marks the call settled. The elicit
  handler releases its dialog queue only when the backend promise settles, so an abandoned ask would block
  later dialogs.
- Each `notify` call is recorded and resolves at once.

Lifecycle:

- One idempotent `stop()` awaits `rig.shutdown()` and removes the temporary executables directory.
- The `stub_shutdown` tool calls `stop()` and returns once it settles. The process stays up until stdin ends.
- `SIGINT`, `SIGTERM` and stdin end call `stop()`, then exit the process.
- When `createRig` throws, the entry logs the error to stderr, removes the directory and exits with code 1.

Host disposal kills only the direct child, and sends `SIGKILL` 5 seconds after `SIGTERM`. The rig's own shutdown
can take longer: run shutdown waits up to 5 seconds, then the `sqlite` sibling is disposed. So the suite calls
`stub_shutdown` before it disposes the host. Then the signal path only runs as a fallback.

Test-only tools:

| Tool | Input | Result |
|------|-------|--------|
| `stub_dialogs` | none | `{ calls, runnerCalls }`. Each call is `{ index, backend, type, kind?, title, text, pending }`, where `type` is `ask` or `notify`. `index` grows for the life of the process. |
| `stub_answer` | `{ index, result }` | Settles the pending `ask` call at `index` with `result`, an `AskResult` (`answered` with `value`, `declined`, `dismissed` or `timeout`). An unknown or settled index returns an error result. |
| `stub_shutdown` | none | `{}` once the rig and its siblings have shut down. |

### `integration-tests/suites/flow-rig.test.ts`

Spawns `stub-rig.mjs` through `NodeContextHost` with a temporary config file, one rig per `describe` in
`beforeAll`, disposed in `afterAll`.

Spawn contract:

- `NodeContextHost` does not support `cwd`, so every path is absolute. The suite derives the stub entry, the
  sample flows directory and the built `mcp-servers/sqlite/lib/serve.js` from `import.meta.url`.
- `command` is `process.execPath`.
- The temporary config sets `flowsDir` to the absolute sample flows path, since a relative `flowsDir` resolves
  from the config file's directory.
- `stderr: 'inherit'`, because the spawn default is `ignore` and a startup failure must be visible.

Helpers:

- `call(name, args, deadline)`: every RPC gets the remaining time to the deadline as its timeout or abort
  signal, so an awaited call cannot outlive a helper deadline.
- `waitFor(runID, predicate)` polls `flow_status`. `waitForDialog(after, predicate)` polls `stub_dialogs` for a
  new call with `index > after`. Both fail at their deadline with the last observed state. No fixed sleeps.
- `beforeAll` and `afterAll` have explicit deadlines. The `afterAll` deadline covers `stub_shutdown` (up to
  10 seconds) plus host disposal.

Sequencing rules:

- Tests in a file run sequentially (no `test.concurrent`).
- `prompt_input` blocks until its dialog settles. `start_flow` blocks while a confirm dialog is open.
- A watermark is the highest dialog `index` seen so far. Capture it just before the action that causes the
  dialog or notification.
- To answer a dialog behind a blocking call, follow these steps:
  1. Capture the watermark.
  2. Start the blocking call without awaiting it.
  3. Wait for a new pending `ask` call after the watermark.
  4. Answer it with `stub_answer`.
  5. Await the blocking call.
- Every call started without `await` gets its own `AbortController` and a rejection handler at once. This
  prevents an unhandled rejection when the call times out.
- In `finally`, each test aborts and joins its outstanding calls, then cancels its known runs. Errors are
  ignored. This cleanup has its own fresh deadline.
- A run still in approval has no run ID yet. Aborting its `start_flow` call aborts the approval, so the abort
  covers that case.

Both rigs use `predictor: fake`, `allow: ['system-one:predict', 'sqlite:sqlite_get']`, `confirm: 'desktop'`,
the real `sqlite` sibling, and the sample flows in `scripts/flow-rig/flows`.

## Scenarios

"Completes" means `flow_status` reports `state: 'completed'` and a result whose `structuredContent` holds the
named `outcome` and `output`.

Inbox rig (`input: 'inbox'`):

1. `list_flows` lists `demo/triage`, `demo/ask` and `demo/nested`.
2. `check_flow` reports issues for an invalid definition.
3. `demo/ask` answered through `answer_input` completes with outcome `answered`, output `{ value: <answer> }`.
4. `demo/ask` declined through `decline_input` completes with outcome `declined`, output `{}`.
5. `demo/nested` shows the inner input in the outer run's `pending`. Answering it completes the outer run with
   outcome `answered`, output `{ output: { value: <answer> } }`.
6. `demo/ask` through `prompt_input`. The inbox notifies when the entry is added, before any prompt. So the test
   captures one watermark before `start_flow` and expects a new `notify` call after it. It captures a second
   watermark before `prompt_input` and expects one new `ask` call after that. Answering the ask with
   `stub_answer` settles `prompt_input` with `accept`. The run completes as in scenario 3.
Inline scenarios always pass `input: {}` to `start_flow`. The rig does not default a missing `input` yet (a
phase 3 finding), and without it `start_flow` returns `Invalid flow input`.

7. An inline flow using `sqlite:sqlite_all` (outside `allow`) opens the stub confirm dialog. Answered yes, the
   run completes with the query rows in its output. Answered no, `start_flow` returns an error result starting
   with `Flow denied`.
8. `demo/triage` completes with outcome `triaged`, output `{ row: { label: <fake choice> } }`.
9. An inline `decide` flow whose question key has no fake answer: `state: 'completed'`, `result.isError: true`,
   `result.structuredContent.error.code: 'node_failed'`. This pins current behaviour, which phase 3 may change.
10. `cancel_flow` during a pending input ends the run as `cancelled` with no pending entries. `answer_input` on
    the old entry id returns an error result `Unknown input: <id>`.

Dialog rig (`input: 'dialog'`):

11. `demo/ask` opens a stub dialog directly. `flow_status` shows `input_required` with empty `pending`.
    Answering the dialog completes the run as in scenario 3.

After each describe, `stub_dialogs` reports `runnerCalls: 0`.

## CI and scripts

- CI needs no workflow change. `pnpm run test` already runs `test:integration` after the build.
- The stub needs no zenity, xvfb or alerter.
- Root `test` also runs `pnpm run test:flow-rig`, so the rig's unit tests run in CI.
- `scripts/flow-rig/smoke.mjs` and the root `smoke:flow-rig` script are deleted.

## Docs

- `scripts/flow-rig/README.md`: the Tests section points to the integration suite and drops the smoke run. The
  manual QA checklist stays, for real desktop and real System One checks.
- The milestone's phase 2 row and status are updated at completion.

## Error handling

- A rig that fails to start fails `beforeAll`, with the rig's stderr visible through `stderr: 'inherit'`.
- Every wait helper and every RPC has a deadline. A helper fails with the last observed state.
- `afterAll` disposes the host even when a test fails, and removes the temporary config directory. The stub
  entry's shutdown handlers stop the rig and its `sqlite` sibling.

## Out of scope

- Fixing the phase 1 findings (hidden predictor error message, `state: completed` for failed flows, missing
  `input` default). Phase 3 owns them. The suite asserts current behaviour only where a scenario needs it.
- Real desktop dialogs in CI. The `host-desktop` zenity job already covers the backends.
