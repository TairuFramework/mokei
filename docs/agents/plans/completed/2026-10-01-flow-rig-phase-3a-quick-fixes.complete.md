# Flow rig phase 3A -- quick fixes

**Status:** complete
**Date:** 2026-10-01
**Milestone:** [flow rig](../completed/2026-09-30-flow-rig-milestone.complete.md), phase 3, sub-project A
**Branch:** `feat/flow-rig`

## Goal

Close the small flow rig findings in the packages that own them, and drop the matching rig workarounds. Phase 3 is
split into sub-projects: A (these quick fixes, with the sozai asks), B (flow runs as a first-class session API) and
C (CLI surfaces).

## Key decisions

- **A cancellable inbox prompt.** `InputInbox.prompt(id, { signal })` shares one prompt run across concurrent
  callers. The shared run aborts only when its last waiting caller aborts, and the entry stays pending so it can be
  prompted again. A signal that is already aborted opens no dialog. An abort after the entry settled elsewhere
  resolves with the entry's outcome.
- **Withdrawal rejection deferred by design.** An elicit handler aborted with a `TaskInputWithdrawnError` still
  rejects. The aborting caller owns that rejection, as documented on `createDesktopElicitHandler`.
- **Typed predictor errors across the MCP hop.** sozai's sanitising already keeps the error type. The loss was the
  hop: the system-one server threw a plain `Error`. It now returns an error result with
  `_meta['dev.mokei/system-one-error']` (`{ name, status?, retryAfterMs? }`). The predictor rebuilds the matching
  `SystemOneError` subclass, and falls back to a plain `SystemOneError` for missing or unknown meta. Aborted requests
  still throw.
- **Optional System One model.** The request `model` is optional end to end, and the HTTP backend omits it so
  `laya-serve` picks its default. The backend result still reports the model it used.
- **Inline input default.** `run_flow` treats an `undefined` input as `{}`. An explicit `null` is still validated.
- **Upstream asks.** A more detailed `Invalid flow input` message and a `ref` for an `end` node `outcome` were
  requested upstream from `@sozai/flow-graph`.

## What was built

- `@mokei/host-desktop`: the `prompt` signal option. The rig's `prompt_input` passes its request signal.
- `@mokei/system-one-client`: optional request model, plus `SYSTEM_ONE_ERROR_META`, `SystemOneErrorInfo`,
  `systemOneErrorInfo` and `systemOneErrorFromInfo`.
- `@mokei/mcp-system-one`: error results carrying the error meta.
- `@mokei/decision-flow-server`: typed predictor errors and the inline input default.
- A patch changeset, finding statuses in the milestone, and rig README updates.

## Notes

- Over MCP, rate-limit and overloaded predictor errors are now retryable at flow level, as they already were with an
  in-process predictor.
- Possible follow-up: export a meta parser from `@mokei/system-one-client` so the predictor does not parse the wire
  shape inline.
