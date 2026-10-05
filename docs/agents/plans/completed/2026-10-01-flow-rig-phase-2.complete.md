# Flow rig phase 2 -- integration harness

**Status:** complete
**Date:** 2026-10-01
**Milestone:** [flow rig](../completed/2026-09-30-flow-rig-milestone.complete.md), phase 2
**Branch:** `feat/flow-rig`

## Goal

Run the flow rig's facade scenarios in CI over a real stdio boundary, without a desktop or System One. The suite
replaces the phase 1 smoke run and automates the manual QA checklist, except the parts that need a real desktop or a
real System One.

## Key decisions

- **Target the rig facade.** The suite calls `start_flow`, `flow_status` and the input tools, the same way Claude
  Code does. It covers approval, the run manager, inbox and dialog routing, and the stack below them.
- **Real process boundary.** The suite spawns a rig process through `NodeContextHost` and never calls it in-process.
- **Stubs are injected in code, not config.** `serve.mjs` exports `createRig({ configPath, desktop })`. `desktop`
  is the existing `@mokei/host-desktop` seam (`createBackend`, `runner`, `platform`, `env`), passed to both elicit
  handlers. The rig config gained no test-only fields, and no package changed.
- **The stub desktop passes backend detection honestly.** It writes executable `zenity` and `notify-send` stubs to a
  temporary directory and sets `PATH`, `DISPLAY` and `DBUS_SESSION_BUS_ADDRESS`. Its runner rejects, so no real
  command can run, and the suite asserts the runner call count stays 0.
- **A stub ask always settles.** It stays pending until a test answers it or its signal aborts. The elicit handler
  releases its dialog queue only when the backend promise settles, so an abandoned ask would block later dialogs.
- **Shutdown beats the host's kill grace.** Host disposal sends `SIGKILL` 5 seconds after `SIGTERM`, but rig shutdown
  can take longer. The suite calls a `stub_shutdown` tool before it disposes the host.
- **Blocking calls are tracked.** Every call started without `await` gets an abort controller and a rejection
  handler. Each test aborts and joins them, then cancels its runs, so a failure cannot leak into the next test.
- **The fake predictor stays config-driven** (`predictor: fake`, `fakeAnswers`).

## What was built

- `scripts/flow-rig/serve.mjs`: the `createRig` factory, with the CLI entry kept behind its direct-run guard.
- `integration-tests/support/flow-rig/`: the stub desktop with its `stub_dialogs` and `stub_answer` tools, the
  stub rig entry with `stub_shutdown`, and a driver with deadline-bound call, wait, watermark and cleanup helpers.
- `integration-tests/suites/flow-rig.test.ts`: 16 tests covering listing, flow checks, answered, declined and nested
  input, inbox prompting, confirm yes and no outside the allowlist, fake triage, `node_failed` for a missing fake
  answer, cancellation, the direct dialog mode, and the abort and withdrawal paths.
- The smoke run and its root script are deleted. The root `test` script now also runs `test:flow-rig`, so CI runs
  the rig unit tests and the integration suite with no workflow change.

## Notes

- Aborting or timing out a client `callTool` cancels the server-side approval or prompt, and the stub ask settles.
  The suite proves this by opening a new dialog afterwards.
- The suite pins current behaviour where phase 3 may change it: a failed flow reports `state: completed` with
  `isError`, and inline flows must pass `input: {}`.
