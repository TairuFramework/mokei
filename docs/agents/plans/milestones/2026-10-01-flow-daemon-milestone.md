# Milestone: flow daemon

**Status:** open -- sub-projects 1 and 2 complete -- sub-project 3 (daemon) implemented and validated; whole-branch review and desktop QA pending
**Opened:** 2026-10-01
**Replaces:** phase 3 of the [flow rig milestone](2026-09-30-flow-rig-milestone.md), from sub-project B onwards

## Goal

Run decision flows in the background under the per-user `mokei` daemon, and drive them from scripts, agents (MCP),
the CLI and the monitor. Runs survive daemon restarts. Inputs and approvals go to one inbox with desktop
notifications. Every run has a trace and logs. The flow rig under `scripts/flow-rig/` is ephemeral: all its logic
moves into packages, and the CLI replaces it.

## Architecture

```
@mokei/flow-host (portable)
  createFlowHost({ session, flows, predictor, approval, runStore, taskStore })
  run lifecycle, approval queue, inbox (inputs and approvals), flow.run span, events
@mokei/flow-host-node
  node:sqlite stores (tasks, runs, spans, logs) under getDataDir('mokei')
  OTel SDK span processor into the store, optional OTLP exporter
  @sozai/log sink into the store (run-correlated) and a @tejika/log file sink
  config loader, daemon handlers, the MCP facade server
@mokei/host-protocol       flow, run and inbox procedures; run:* and inbox:* events
@mokei/host-node           daemon composes injected handler sets; no flow or desktop code
@mokei/cli                 daemon entry wires flow-host-node and host-desktop; flows, runs, inbox, daemon commands
monitor/                   runs, run detail (trace and logs) and inbox pages
```

## Decisions

- **One daemon per user.** The existing `mokei` daemon (`@tejika/process`, Enkaku over a unix socket) hosts flows.
  Runs from every project share one monitor and one inbox.
- **Explicit callers only.** The CLI, MCP and the monitor start runs. Triggers (schedules, events) can be added later
  as one more caller.
- **Approval by policy.** Tool-id globs approve a run at once. Any other run waits in `awaiting_approval` with an
  inbox approval item. The single-use flow grant is minted on approval, so a queued approval survives a restart.
- **Run states.** `awaiting_approval`, `denied`, `working`, `input_required`, `completed`, `failed`, `cancelled`. A
  flow that ends with an error result is `failed`, not `completed`.
- **The runtime owns the inbox.** Inputs and approvals are inbox items keyed by run. Desktop is only a surface:
  notifications on new items, and dialogs on request. `@mokei/host-desktop`'s `InputInbox` stays for in-process hosts.
- **Resume after restart.** Tasks checkpoint into a persistent task store. On boot the daemon recovers tasks and
  resumes watching non-terminal runs.
- **Observability through OpenTelemetry.** Each run has a `flow.run` root span. The existing flow-graph, decide and
  MCP spans become its children. Spans and run-correlated `@sozai/log` records are stored per run. The first cut is
  wiring, and detail grows with the logic.
- **Storage.** One `node:sqlite` database in `getDataDir('mokei')`. Terminal runs are pruned after a retention
  period, with their spans and logs.
- **Config.** `flows.json` in `getDataDir('mokei')`: sibling servers, flow directories, predictor, approval globs,
  tracing, retention and `desktop.notifications` (default `false`). Changes apply on daemon restart.
  Dialogs require explicit inbox prompting. Startup sends no notification for zero pending items,
  one item notification for one, or one generic pending-count notification for multiple items.
- **tejika for local plumbing.** `@tejika/process` (daemon lifecycle), `@tejika/env` (paths), `@tejika/log` (log
  files), `@tejika/server` (monitor bridge) and `@tejika/test` (end-to-end harness).

## Sub-projects

Each sub-project gets its own spec, plan and PR from `main`.

| # | Sub-project | Delivers | Exit criteria | Status |
|---|-------------|----------|---------------|--------|
| 1 | Flow runtime | `@mokei/flow-host` with memory stores; `DecisionFlowWiring.authorize`; a portable elicitation content validator; the `flow.run` span. The rig becomes a thin shim over it. | Unit suite green; the rig integration suite green on the shim. | complete |
| 2 | Node storage and observability | `@mokei/flow-host-node`: sqlite stores, span and log capture, OTLP option, config loader, retention. | Store, capture and config tests green. | complete |
| 3 | Daemon | `host-protocol` procedures and events, handler composition in `host-node`, daemon entry in the CLI, recovery on boot, desktop notifier. | Daemon integration suite green, including restart and resume. | implementation checks passed; whole-branch review and desktop QA pending |
| 4 | CLI and MCP | `mokei daemon`, `flows`, `runs` and `inbox` commands; `mokei flows mcp`. `scripts/flow-rig` and its suite are deleted. | End-to-end suite green; manual macOS QA done. | not started |
| 5 | Monitor | Runs, run detail and inbox pages. | Manual QA of the monitor pages. | not started |

Completed sub-projects link their summary in `completed/` here.

- Sub-project 1: [`completed/2026-10-01-flow-host.complete.md`](../completed/2026-10-01-flow-host.complete.md)
- Sub-project 2: [`completed/2026-10-02-flow-host-node.complete.md`](../completed/2026-10-02-flow-host-node.complete.md)

Sub-project 3 implements one flow service per daemon process and initial recovery reconciliation
before ready publication. Flow startup failure leaves proxy and monitor status serving available.
Clients subscribe before querying snapshots and reconcile current records on reconnect; events
are live without durable replay. The rig remains until sub-project 4 replaces its user surface.

Publication remains blocked on the
[upstream Enkaku fix and dependency adoption](../next/2026-10-02-enkaku-protocol-schema-rebasing.md).
The checked-in workspace patch provides local verification only and does not reach published consumers.

## Findings carried over from the flow rig

- No public "call a tool with approval" outside `AgentSession` -- sub-project 1 (`authorize`).
- Inbox entries carry only a context key -- sub-project 1 (inbox items keyed by run).
- `tasks.wait` answers task input automatically -- sub-project 1 (the runtime drives `tasks.get` and `tasks.update`).
- Host elicit handling and the flow task API share no notion of a run -- sub-project 1.
- A failed flow reports `state: completed` -- sub-project 1 (`failed` run state).
