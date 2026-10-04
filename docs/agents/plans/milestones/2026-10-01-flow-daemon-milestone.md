# Milestone: flow daemon

**Status:** complete -- sub-projects 1 to 5 complete
**Opened:** 2026-10-01
**Replaces:** phase 3 of the [flow rig milestone](2026-09-30-flow-rig-milestone.md), from sub-project B onwards

## Goal

Run decision flows in the background under the per-user `mokei` daemon, and drive them from scripts, agents (MCP),
the CLI and the monitor. Runs survive daemon restarts. Inputs and approvals go to one inbox with desktop
notifications. Every run has a trace and logs. The former flow rig is gone: all its logic moved into packages, and the CLI
replaced it.

## Architecture

```
@mokei/flow-host (portable)
  createFlowHost({ session, flows, predictor, approval, runStore, taskStore })
  run lifecycle, approval queue, inbox (inputs and approvals), flow.run span, events
@mokei/flow-host-node
  node:sqlite stores (tasks, runs, spans, logs) under getDataDir('mokei')
  OTel SDK span processor into the store, optional OTLP exporter
  @sozai/log sink into the store (run-correlated) and a @tejika/log file sink
  config loader, daemon handlers
@mokei/flow-client (portable)
  FlowControl contract, daemon adapter, wait helpers, the flow MCP server (createFlowControlServer)
@mokei/host-protocol       flow, run and inbox procedures; run:* and inbox:* events
@mokei/host-node           daemon composes injected handler sets; no flow or desktop code
@mokei/cli                 daemon entry wires flow-host-node and host-desktop; flows, runs, inbox, daemon commands; `flows mcp` serves the flow MCP server
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
| 3 | Daemon | `host-protocol` procedures and events, handler composition in `host-node`, daemon entry in the CLI, recovery on boot, desktop notifier. | Daemon integration suite green, including restart and resume. | complete (native desktop QA done in sub-project 4) |
| 4 | CLI and MCP | `mokei daemon`, `flows`, `runs` and `inbox` commands; `mokei flows mcp`. `scripts/flow-rig` and its suite are deleted. The MCP server lives in the portable `@mokei/flow-client` (not `@mokei/flow-host-node`), over a `FlowControl` interface with a daemon adapter and a local `@mokei/flow-host` adapter. Folds in the published declaration dependency fixes (context-server, context-client, context-rpc, context-protocol, model-provider) and the `pnpm test:packed` packed-consumer check. | End-to-end suite green; packed consumer check green; manual macOS QA done. | complete |
| 5 | Monitor | Runs, run detail, inbox and flows pages; monitor presence routes notifications and prompts before native desktop surfaces, and notification clicks open the item in the monitor when attached. | Manual QA of the monitor pages. | complete |

Completed sub-projects link their summary in `completed/` here.

- Sub-project 1: [`completed/2026-10-01-flow-host.complete.md`](../completed/2026-10-01-flow-host.complete.md)
- Sub-project 2: [`completed/2026-10-02-flow-host-node.complete.md`](../completed/2026-10-02-flow-host-node.complete.md)
- Sub-project 3: [`completed/2026-10-02-flow-daemon.complete.md`](../completed/2026-10-02-flow-daemon.complete.md)
- Sub-project 4: [`completed/2026-10-03-flow-cli.complete.md`](../completed/2026-10-03-flow-cli.complete.md)
- Sub-project 5: [`completed/2026-10-04-flow-monitor.complete.md`](../completed/2026-10-04-flow-monitor.complete.md)

Native desktop QA, deferred from sub-project 3, passed during sub-project 4 manual macOS QA.

Sub-project 3 implements one flow service per daemon process and initial recovery reconciliation
before ready publication. Flow startup failure leaves proxy and monitor status serving available.
Clients subscribe before querying snapshots and reconcile current records on reconnect; events
are live without durable replay. Sub-project 4 replaced the rig's user surface and removed it.

Sub-project 5 adds monitor attachment and tab-presence procedures. Attended tabs suppress new
item notifications; hidden tabs can receive browser notifications when permission is granted.
Prompts route to the monitor first and fall back to native dialogs when delivery is unavailable.
Recovery summaries remain native-only, and reconnecting tabs reconcile current state.

The [Enkaku fix and dependency adoption](../completed/2026-10-02-enkaku-protocol-schema-rebasing.complete.md)
passed verification with protocol 0.21.4 and a fresh packed consumer installation.
The workspace patch was removed, satisfying this publication prerequisite.

## Findings carried over from the flow rig

- No public "call a tool with approval" outside `AgentSession` -- sub-project 1 (`authorize`).
- Inbox entries carry only a context key -- sub-project 1 (inbox items keyed by run).
- `tasks.wait` answers task input automatically -- sub-project 1 (the runtime drives `tasks.get` and `tasks.update`).
- Host elicit handling and the flow task API share no notion of a run -- sub-project 1.
- A failed flow reports `state: completed` -- sub-project 1 (`failed` run state).

Sub-project 4 follow-ons are in the [flow client follow-ons](../backlog/2026-10-03-flow-client-follow-ons.md) backlog.
Sub-project 5 follow-ons are in the [flow monitor follow-ons](../next/2026-10-04-flow-monitor-follow-ons.md) and the
[flow monitor backlog](../backlog/2026-10-04-flow-monitor-backlog.md).
