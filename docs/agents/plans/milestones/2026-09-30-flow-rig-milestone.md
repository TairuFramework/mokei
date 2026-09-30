# Milestone: flow rig

**Status:** open — phase 1 (local rig) in review
**Opened:** 2026-09-30
**Branch / PR:** phase 1 on `feat/flow-rig`

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
| 1 | Local rig | A Node script under `scripts/flow-rig/` that owns a `NodeSession` with sibling servers, `addDecisionFlow` and the desktop elicit handler, and exposes a facade MCP server to Claude Code (`start_flow`, `flow_status`, input tools). Sample flows, smoke run, manual QA checklist. No package changes. | Smoke run passes; manual QA checklist done on macOS; findings recorded below. | in review |
| 2 | Integration/e2e harness | Move the rig's scenarios into `integration-tests/`: fake predictor, stub desktop backend or answers through the facade tools, run in `pnpm test:integration` and CI. | Rig scenarios run in CI without a desktop or System One. | not started |
| 3 | Session, host and CLI features | Address the findings: public APIs the rig had to work around, CLI surfaces for flows and the input inbox, desktop notifications in the CLI. | Every finding below is shipped or explicitly deferred. | not started |

Completed phases link their summary in `completed/` here.

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
  raw context client itself.
- **Inbox entries carry only a context key.** No task or run id, so a host cannot tell which run an entry belongs
  to. The rig passes the run id as the key.
- **`tasks.wait` answers task input requests automatically.** A host that routes task input itself must poll
  `tasks.get` and answer with `tasks.update`.
- **`InputInbox.prompt(id)` takes no abort signal.** A cancelled `prompt_input` call leaves the desktop dialog open.
- **A flow `end` node's `outcome` must be a literal.** Passing a nested flow's outcome through needs a `branch` on
  each possible outcome (see `demo/nested`).
- **Aborting a desktop elicit handler rejects its promise.** A host that withdraws inputs sees an error for every
  withdrawal and must tell withdrawal apart from failure itself (the rig currently logs these as failures).
- **`@mokei/host-desktop` elicit handling and the flow task API have no shared notion of a run.** The rig keeps its
  own runId-to-task map and passes the run id as the inbox key.
