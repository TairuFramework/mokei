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
  existing `@mokei/host-desktop` test seam (`createBackend`, `runner`, `platform` on
  `createDesktopElicitHandler`). No package changes.
- **The fake predictor stays config-driven.** `predictor: fake` with `fakeAnswers` already exists and covers
  System One.
- **The smoke run is removed.** The integration suite supersedes all its checks and runs in CI.
- **No new package.** The rig stays a script under `scripts/flow-rig/`.

## Components

### `scripts/flow-rig/serve.mjs`: `createRig`

`main({ configPath, stdio })` becomes `createRig({ configPath, desktop })`, returning `{ tools, shutdown }`.

- `createRig` no longer calls `serveProcess`.
- `desktop` is optional: `{ createBackend, runner, platform }`. When given, it is passed to both
  `createDesktopElicitHandler` calls (flow input and the confirm dialog). When omitted, behaviour is unchanged.
- The CLI entry at the bottom of `serve.mjs` loads the config path, calls `createRig`, calls `serveProcess` with
  the tools, and keeps the existing signal and stdin-end shutdown handling.

### `integration-tests/support/flow-rig/stub-rig.mjs`

A test entry, spawned by the suite. It reads the config path from `FLOW_RIG_CONFIG`, calls `createRig` with a
stub desktop, and serves the rig tools plus two test-only tools on stdio.

The stub desktop:

- `platform: 'linux'`, a runner whose `run` rejects (no command ever runs), and a `createBackend` that returns
  stub backends.
- Each `ask` call is recorded and stays pending until the test settles it.
- Each `notify` call is recorded and resolves at once.

Test-only tools:

| Tool | Input | Result |
|------|-------|--------|
| `stub_dialogs` | none | `{ calls }`. Each call is `{ index, backend, type, kind?, title, text, pending }`, where `type` is `ask` or `notify`. |
| `stub_answer` | `{ index, result }` | Settles the pending `ask` call at `index` with `result`, an `AskResult` (`answered` with `value`, `declined`, `dismissed` or `timeout`). An unknown or settled index returns an error result. |

### `integration-tests/suites/flow-rig.test.ts`

Spawns `stub-rig.mjs` through `NodeContextHost` with a temporary config file, one rig per `describe` in
`beforeAll`, disposed in `afterAll`. Helpers: `call(name, args)`, `waitFor(runID, predicate)` polling
`flow_status`, and `waitForDialog(predicate)` polling `stub_dialogs`.

Both rigs use `predictor: fake`, `allow: ['system-one:predict', 'sqlite:sqlite_get']`, `confirm: 'desktop'`,
the real `sqlite` sibling, and the sample flows in `scripts/flow-rig/flows`.

## Scenarios

Inbox rig (`input: 'inbox'`):

1. `list_flows` lists `demo/triage`, `demo/ask` and `demo/nested`.
2. `check_flow` reports issues for an invalid definition.
3. `demo/ask` answered through `answer_input` completes with the answer as output.
4. `demo/ask` declined through `decline_input` ends on the decline edge.
5. `demo/nested` shows the inner input under the outer run. Answering it completes the outer run.
6. `demo/ask` through `prompt_input`: the stub records an inbox notification and one dialog. Answering the dialog
   with `stub_answer` settles `prompt_input` with `accept`, and the run completes with that answer.
7. An inline flow using `sqlite:sqlite_all` (outside `allow`) opens the stub confirm dialog. Answered yes, the
   run completes. Answered no, `start_flow` returns `Flow denied`.
8. `demo/triage` completes with the fake label in its output.
9. An inline `decide` flow whose question key has no fake answer ends with a `node_failed` error result.
10. `cancel_flow` during a pending input ends the run as `cancelled` with no pending entries. `answer_input` on
    the old entry id returns `Unknown input`.

Dialog rig (`input: 'dialog'`):

11. `demo/ask` opens a stub dialog directly. `flow_status` shows `input_required` with empty `pending`.
    Answering the dialog completes the run with that answer.

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

- A rig that fails to start fails `beforeAll` with the rig's stderr visible in the test output.
- Every wait helper has a deadline and fails with the last observed state.
- `afterAll` disposes the host even when a test fails, so no rig process outlives the suite.

## Out of scope

- Fixing the phase 1 findings (hidden predictor error message, `state: completed` for failed flows, missing
  `input` default). Phase 3 owns them. The suite asserts current behaviour only where a scenario needs it.
- Real desktop dialogs in CI. The `host-desktop` zenity job already covers the backends.
