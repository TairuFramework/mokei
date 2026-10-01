# Milestone: flow rig

**Status:** open -- phases 1 (local rig) and 2 (integration harness) complete, phase 3 next
**Opened:** 2026-09-30
**Branch / PR:** phases 1 and 2 on `feat/flow-rig`

## Goal

Run the whole stack locally: decision flows that use System One, sibling MCP servers, and desktop input
(`@mokei/host-desktop` notifications, inbox and dialogs). First drive it from Claude Code through MCP, then turn the
same setup into integration and end-to-end tests, and finally use what both phases find to drive new session, host
and CLI features and UX.

## Phases

Each phase gets its own design spec, implementation plan and PR. Specs for phases 2 and 3 are written when the phase
starts, since each depends on what the previous phase finds.

| # | Phase | Scope | Exit criteria | Status |
|---|-------|-------|---------------|--------|
| 1 | Local rig | A Node script under `scripts/flow-rig/` that owns a `NodeSession` with sibling servers, `addDecisionFlow` and the desktop elicit handler, and exposes a facade MCP server to Claude Code (`start_flow`, `flow_status`, input tools). Sample flows, smoke run, manual QA checklist. No package changes. | Smoke run passes; manual QA checklist done on macOS; findings recorded below. | complete |
| 2 | Integration/e2e harness | Move the rig's scenarios into `integration-tests/`: fake predictor, stub desktop backend or answers through the facade tools, run in `pnpm test:integration` and CI. | Rig scenarios run in CI without a desktop or System One. | complete |
| 3 | Session, host and CLI features | Address the findings: public APIs the rig had to work around, CLI surfaces for flows and the input inbox, desktop notifications in the CLI. | Every finding below is shipped or explicitly deferred. | not started |

Completed phases link their summary in `completed/` here.

- Phase 1: [`completed/2026-09-30-flow-rig.complete.md`](../completed/2026-09-30-flow-rig.complete.md)
- Phase 2: [`completed/2026-10-01-flow-rig-phase-2.complete.md`](../completed/2026-10-01-flow-rig-phase-2.complete.md)

## Decisions

- **Phase 1 is a plain script, not a package or binary.** It imports the built `lib/` of workspace packages.
- **Facade in front of the flow server.** Claude Code cannot call the flow tools directly: they require the MCP tasks
  extension, and run approval needs a grant minted by `wrapApproval` on the session side. The rig approves, drives
  flow tasks and exposes blocking tools instead.
- **Flow input goes to the desktop directly**, not upstream to Claude Code. Inbox mode by default, with blocking
  dialogs as an opt-in.
- **Approval by allowlist.** A run whose static tool plan fits the configured tool globs is approved; anything else
  shows a desktop confirm dialog.
- **Real or fake predictor.** `system-one:predict` by default; a scripted fake for runs without System One, reused by
  phase 2.

## Findings

Gaps found while building and using the rig. Phase 3 consumes this list.

- **No public "call a tool with approval" outside `AgentSession`.** The rig calls the `wrapApproval` function and the
  raw context client itself. Status: phase 3 sub-project B (flow runs API).
- **Inbox entries carry only a context key.** No task or run id, so a host cannot tell which run an entry belongs
  to. The rig passes the run id as the key. Status: phase 3 sub-project B (flow runs API).
- **`tasks.wait` answers task input requests automatically.** A host that routes task input itself must poll
  `tasks.get` and answer with `tasks.update`. Status: phase 3 sub-project B (flow runs API).
- **`InputInbox.prompt(id)` takes no abort signal.** A cancelled `prompt_input` call leaves the desktop dialog open.
  Status: shipped -- `prompt` accepts a signal and closes its dialogs when aborted.
- **A flow `end` node's `outcome` must be a literal.** Passing a nested flow's outcome through needs a `branch` on
  each possible outcome (see `demo/nested`). Status: requested upstream.
- **Aborting a desktop elicit handler rejects its promise.** Aborting with a `TaskInputWithdrawnError` reason makes
  the inbox record the entry as `withdrawn`, but the handler promise still rejects, so a host must ignore
  rejections from inputs it has withdrawn itself (the rig does). Status: deferred by design -- the aborting caller
  owns the rejection and must handle it.
- **`@mokei/host-desktop` elicit handling and the flow task API have no shared notion of a run.** The rig keeps its
  own runID-to-task map and passes the run id as the inbox key. Status: phase 3 sub-project B (flow runs API).
- **A predictor failure hides its message.** The flow error reports only `lastFailure: { type: "SystemOneError" }`.
  A missing System One model needed a manual repro against the sibling server to diagnose. Status: shipped -- the
  predictor rebuilds the typed error from the System One error metadata.
- **The system-one server needs a model with no fallback.** Without `model` or `SYSTEM_ONE_MODEL` every predict
  call fails, although `laya-serve` picks a default itself. The integration suite cannot catch this, since it uses the
  fake predictor. Status: shipped -- `model` is optional and omitted when unset.
- **A failed flow reports `state: completed`.** The task completes and the failure shows only as `isError` in the
  result, so `flow_status` callers must inspect the result. Status: phase 3 sub-project B (flow runs API).
- **An inline flow started without `input` fails with `Invalid flow input`.** The rig does not default a missing
  `input` to `{}`, and the error does not say that `input` is missing. Status: shipped -- missing `input` defaults
  to `{}`; the `Invalid flow input` detail was requested upstream.
