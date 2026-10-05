# Milestone: flow daemon

**Status:** complete
**Dates:** 2026-10-01 to 2026-10-05
**PRs:** #69 to #73, then the post-merge review follow-ups
**Replaces:** phase 3 of the [flow rig milestone](2026-10-01-flow-rig-milestone.complete.md), from sub-project B
onwards

## Goal

Run [decision flows](2026-09-29-decision-flow.complete.md) in the background under the per-user `mokei` daemon.
Drive them from scripts, agents over MCP, the CLI and the monitor. Runs survive daemon restarts. Inputs and approvals
go to one inbox with desktop notifications. Every run has a trace and logs. All the flow rig's logic moved into
packages, and the CLI replaced the rig.

## Architecture

- `@mokei/flow-host` (portable): `createFlowHost`, the run lifecycle, the approval queue, the inbox of inputs and
  approvals, the `flow.run` span and events.
- `@mokei/flow-host-node`: `node:sqlite` stores for tasks, runs, spans and logs under `getDataDir('mokei')`. It also
  holds OpenTelemetry and `@sozai/log` capture, the config loader and the daemon handlers.
- `@mokei/flow-client` (portable): the `FlowControl` contract, the daemon adapter, wait helpers and the flow MCP
  server (`createFlowControlServer`).
- `@mokei/host-protocol`: flow, run and inbox procedures, and `run:*` and `inbox:*` events.
- `@mokei/host-node`: the daemon composes injected handler sets. It holds no flow or desktop code.
- `@mokei/cli`: the daemon entry wires `flow-host-node` and `host-desktop`. It adds `daemon`, `flows`, `runs` and
  `inbox` commands, and `flows mcp`.
- `monitor/`: runs, run detail with trace and logs, inbox and flows pages.

## Milestone decisions

- **One daemon per user.** The existing `mokei` daemon (`@tejika/process`, Enkaku over a unix socket) hosts flows.
  Runs from every project share one monitor and one inbox.
- **Explicit callers only.** The CLI, MCP and the monitor start runs. Triggers such as schedules or events can be
  added later as one more caller.
- **Approval by policy.** Tool-ID globs approve a run at once. Any other run waits in `awaiting_approval` with an
  inbox approval item. The single-use flow grant is minted on approval, so a queued approval survives a restart.
- **Run states.** `awaiting_approval`, `denied`, `working`, `input_required`, `completed`, `failed` and `cancelled`. A
  flow that ends with an error result is `failed`, not `completed`.
- **The runtime owns the inbox.** Inputs and approvals are inbox items keyed by run. Desktop is only a surface, with
  notifications on new items and dialogs on request. `@mokei/host-desktop`'s `InputInbox` stays for in-process hosts.
- **Resume after restart.** Tasks checkpoint into a persistent task store. On boot the daemon recovers tasks and
  resumes watching non-terminal runs.
- **Observability through OpenTelemetry.** Each run has a `flow.run` root span. The flow-graph, decide and MCP spans
  become its children. Spans and run-correlated `@sozai/log` records are stored per run.
- **Storage.** One `node:sqlite` database in `getDataDir('mokei')`. Terminal runs are pruned after a retention
  period, with their spans and logs.
- **Config.** `flows.json` in `getDataDir('mokei')` holds sibling servers, flow directories, approval globs, tracing,
  retention and `desktop.notifications`. Changes apply on daemon restart. The predictor is always
  `system-one:predict` through a configured sibling.
- **tejika for local plumbing.** `@tejika/process` runs the daemon lifecycle, `@tejika/env` resolves paths and
  `@tejika/log` writes log files. `@tejika/server` bridges the monitor. `@tejika/test` and `@tejika/cli` arrived with
  the review follow-ups.

## Sub-project 1 -- flow runtime (PR #69)

Move the rig's run logic into a portable package, so the daemon, the CLI and tests drive flows through one API. The
package owns run identity, approval, the inbox, state mapping, tracing and recovery.

### What was built

- **`@mokei/flow-host`**, new and portable, with memory stores. `createFlowHost` takes `session`, `flows`,
  `predictor`, `approval`, `runStore`, `taskStore`, `taskTTLMs` and `listeners`. It offers `start`, `get`, `list`,
  `cancel`, `inbox` and `dispose`, and emits `run:state`, `inbox:added` and `inbox:settled`.
- **`DecisionFlowWiring.authorize`** in `@mokei/decision-flow-server`: a public approval call. It checks a flow and
  returns its plan, digest and a `grant()` for the single-use token. `wrapApproval` is rebuilt on it. The wiring
  exposes its flow registry, so the host keeps no second copy.
- **A portable elicitation content validator**, moved from `@mokei/host-desktop` to `@mokei/host`. `host-desktop`
  gained an input surface for notifications and dialogs over flow-host inbox items.
- **Recovery-safe shutdown** in `@mokei/context-server`. Disposing the task manager aborts work with
  `TaskManagerDisposedError`, so the flow driver suspends instead of cancelling.
- **Restart safety.** The driver still cancels sibling tasks started after its last checkpoint, so a restart never
  runs them twice. Recovered task work runs under its original `requestMeta`, so resumed spans stay in the run's
  trace. `ttlMs: null` means a task never expires.
- **The rig** became a thin shim over flow-host, and its own run, input and approval modules were deleted. Its
  integration suite proved the API end to end.

### Key decisions

- **Failed runs.** A flow that completes with an error result is `failed`, carrying the flow error's type and code.
- **One transition helper.** Every run change is a compare-and-set on the record's `revision`, retried up to 5 times
  and serialised by a per-run queue. Terminal states are absorbing. Network calls stay outside the queue.
- **Launch is the only path that mints a grant.** It claims the run and re-authorises the stored request. It fails
  with `FlowChanged` when the plan or digest differs. A queued approval holds no token, so it survives a restart.
- **Recovery re-applies the policy.** An allowlisted run that crashed before its claim launches instead of waiting for
  approval.
- **The inbox is derived state.** Approval items come from runs in `awaiting_approval`. Input items come from the
  latest `inputRequests` of each watched task. Items move `open`, `settling`, `settled`, and a settled ID never
  reappears.
- **Unsupported requests.** URL elicitation is answered with `cancel`. Sampling and roots requests fail the run with
  `UnsupportedInput`.
- **Terminal cleanup.** When a run ends on any path, its open items settle as `withdrawn` and its per-run state is
  pruned. Settled items of ended runs are no longer readable.
- **The runtime drives tasks itself.** A watcher polls `tasks.get` and answers with `tasks.update`. An unchanged poll
  writes nothing. A missing task fails the run with `Interrupted`, or cancels it when a cancel was requested.
- **No task expiry for flows by default.** Flow tasks get `taskTTLMs: null`, so a run can wait in the inbox
  indefinitely.
- **Recovery.** Non-terminal runs get their watchers or approval items back. A run that crashed during launch is
  linked to its task through the `dev.mokei/flow-run` request meta, or failed with `Interrupted`. It never launches
  twice.
- **Isolated recovery errors.** A per-run recovery error fails only that run. `listeners` passed in params see
  recovery events.
- **Tracing.** Each run has a `flow.run` span, or `flow.run.resume` after recovery. It parents the flow-graph, decide
  and MCP spans. Spans end at terminal states and on dispose.

## Sub-project 2 -- Node storage and observability (PR #70)

Added `@mokei/flow-host-node` with durable SQLite run, task and trace stores, process telemetry, config loading and
retention. Portable JSON contracts, memory trace storage, capture adapters, run correlation and pruning stay in the
Node-free `@mokei/flow-host`. Shared contracts prove memory and SQLite parity. A file-reopen test proves waiting
input survives host and session replacement.

### Key decisions

- **One process owns one database.** JSON records preserve keys, revision checks, detached copies and stable ordering
  across memory and SQLite.
- **Independent run traces.** Each run owns a root trace, linked to its caller. Recovery parents the stored trace
  context, preserving correlation across asynchronous work.
- **Local capture.** Capture stays local to the owning process. Normalisation guards unusual values. Serialised log
  writes exclude capture diagnostics, to prevent recursion.
- **One telemetry installation per process.** Successful provider registration consumes the telemetry lifetime.
  Cached tracer delegates survive rollback. Later setup failures and disposal therefore require a restart before
  another installation.
- **Disposal suspends.** Disposal suspends flow work for recovery, and tasks keep a null default TTL. Shutdown drains
  retention, hosts, sessions and telemetry before closing the database.
- **Resumable retention.** Retention removes terminal records through a resumable cascade. Active tasks prevent
  deletion. Every remaining run protects its trace from orphan pruning.
- **Config defaults.** Configuration is validated and applied at restart. Defaults are info logging, 30-day
  retention and a daily pruning interval.
- **Direct declaration dependencies.** Published declarations require direct production dependencies, so the Node
  package declares flow-graph directly. Package tests stay valid across fixed-group version changes.

The declaration dependency gaps in older packages moved to sub-project 4. Historical tracing and file-sink
compatibility stay deferred in the [flow host Node follow-ons](../backlog/2026-10-02-flow-host-node-follow-ons.md).

## Sub-project 3 -- daemon (PR #71)

The CLI-owned daemon composes one shared durable flow service, generic proxy serving and an injected desktop adapter.
Portable wire contracts expose flow, run and inbox procedures, service status and live events. `host-node` stays
independent of flow and desktop implementations.

### Key decisions

- **One flow service per daemon process.** Initial recovery reconciles stored tasks and inbox items before ready
  publication. A flow startup failure leaves proxy and monitor status serving available.
- **Notifications default off.** Configuration applies on restart. Startup sends nothing for zero pending items, one
  item notification for one, or one generic count notification for several.
- **Quiet notifications.** New items notify once per daemon lifetime, without content previews. Polling and
  reconnects do not notify.
- **Dialogs on request.** Dialogs require explicit inbox prompting. Answers pass runtime validation, and remote
  settlement prevents late answers. Caller cancellation releases dialog ownership and leaves the item pending.
- **No event replay.** Events are live only. Clients subscribe before querying snapshots and reconcile current
  records on reconnect.
- **Draining shutdown.** Shutdown stops admission and drains admitted calls and desktop operations. Durable runs
  suspend for recovery. Sessions and local telemetry drain before SQLite closes.
- **Shutdown budgets.** Remote telemetry phases have ten-second budgets within a sixty-second shutdown deadline.
  Permanently stuck work can exhaust shutdown and produce a reported failure exit.
- **Direct sibling elicitation** outside task inputs keeps the existing decline fallback.

The whole-branch review found missing production protocol validation and an insufficient shutdown deadline. Both
were fixed. Native desktop QA was deferred, and passed later during the sub-project 4 macOS QA.

### Enkaku protocol adoption

Publication was gated on an upstream Enkaku fix. Published `@enkaku/protocol@0.21.4` rebases local definition
references when composing client and server message schemas, using `@sozai/schema@0.1.5`. The catalogue requires
`^0.21.4`, and the workspace patch was removed.

A fresh temporary consumer installed all 29 packed production packages, with only protocol 0.21.4 and no patches. Its
probe validated signed and unsigned recursive schemas and preserved literal reference data. The packed CLI daemon
completed an inline input flow with nested JSON input and output.

## Sub-project 4 -- CLI and MCP (PR #72)

The `mokei` CLI drives the daemon through `daemon`, `flows`, `runs` and `inbox` commands. `mokei flows mcp` exposes
the same control to agents over stdio MCP. The flow rig and its suite were deleted, and the repository `.mcp.json`
now runs `mokei flows mcp`. `@mokei/flow-host` added `createLocalFlowControl` for in-process use. The published
declaration dependency fixes were folded in, guarded by the `pnpm test:packed` packed-consumer check in CI.

### Key decisions

- **Agents cannot approve runs.** Over MCP, approval items are only routed to a human through `prompt_input` as a
  desktop dialog. Runs matching the `flows.json` approval globs still start at once.
- **Plain MCP tools, not MCP tasks.** Claude Code does not support tasks, and task elicitation would bypass the inbox.
- **The MCP server targets `FlowControl`.** It works against the daemon or an in-process `FlowHost`.
- **A new `@mokei/flow-client` package.** The CLI, `flows mcp` and the monitor all consume it. It is portable, so the
  MCP server does not live in `@mokei/flow-host-node`.
- **Output.** CLI output is human-readable by default. Every command takes `--json` and prints one JSON document.
- **Start and wait.** `runs start` returns at once. `--wait` follows the run to a terminal state and answers inputs
  and approvals in the terminal. Ctrl-C in a terminal prompt aborts the command.
- **Declining in the terminal.** Declining an approval there with n or Esc leaves the item pending. `inbox decline`
  denies the run.
- **Wait timeouts.** `wait_flow` and `waitForRun` return the latest status with `timedOut: true` on timeout. They do
  one final read when none succeeded, and reject only with a real error.
- **Safe daemon stop.** `daemon stop` passes the expected socket to `@tejika/process` 0.5.2, so it never signals a
  daemon serving another socket. It reports a forced kill. `restart` starts after a stop or when nothing was running.
- **macOS notifications.** Notifications use `alerter` when installed, else `osascript`, whose notifications open
  Script Editor on click. Clicking a single-item notification opens that item's prompt. Each notification is removed
  when its item settles.
- **Terminal prompts** reuse `@tejika/cli`, `@tejika/ui` and `@inkjs/ui` primitives. Optional boolean and select
  fields cannot be skipped.
- **Packed-consumer gaps.** The check patches three third-party manifest gaps with `packageExtensions`, requested
  upstream.

The whole-branch review found one Important issue, a short `wait_flow` timeout reporting a false `DISCONNECTED`. It
and eight Minor ones were fixed. Manual macOS QA passed on 2026-10-03 through the CLI and Claude Code over MCP. It
covered notifications, desktop prompts, terminal `--wait`, restart recovery, daemon commands and the MCP tools.

## Sub-project 5 -- monitor (PR #73)

The monitor became the main human surface for flows. It lists runs and shows run detail with a trace waterfall and
filterable logs. It answers inputs and approvals in the inbox and inline on the run page. It checks pasted flow
definitions, and starts and cancels runs.

The monitor is also an inbox surface next to the native desktop. The daemon routes notifications and prompts through
an ordered list of surfaces, monitor first, then native. Native notifications and dialogs remain the fallback.

### What was built

- `@mokei/host-protocol`: `monitor.attach` (stream) and `monitor.presence` (channel), typed as a separate
  `MonitorProcedure` group.
- `@mokei/flow-host-node`: the `InboxSurface` contract, `MonitorPresence`, monitor and native surfaces, and surface
  routing in the desktop controller.
- `@mokei/host-node` serves the monitor procedures through an injected handler set.
- `@mokei/host-desktop`: native notification deliveries are observable and closable, and `openURL` opens monitor
  links.
- `@mokei/host-monitor`: it allows the monitor's own origin and forwards SSE aborts to the daemon. It rejects browser
  `monitor.attach` and re-attaches after a daemon restart. It explains when the daemon is too old.
- The `monitor` app: the `FlowProvider` data layer, `PresenceProvider`, and the Runs, Inbox and Flows pages.
- `@mokei/cli`: the daemon entry wires presence and surfaces. The root `pnpm test` and CI run the monitor tests and
  bundle check.

### Key decisions

- **Presence over a channel, liveness by ping.** Each tab holds a `monitor.presence` channel. A tab's claims are
  trusted only after a fresh `pong`. There is no heartbeat. Pings and acks time out after 5 s.
- **Registration over a stream.** `mokei monitor` holds a `monitor.attach` stream, whose lifetime is the
  registration. Tabs are bound to the attachment that served them. Only a `http://127.0.0.1:<port>/` root URL is
  accepted.
- **Suppression and routing.** An attended tab suppresses native notifications. A hidden tab shows browser
  notifications when permission is granted. Prompts open the item form in the page and fall back to native dialogs.
- **Notification clicks** open the item in the monitor when one is attached.
- **Visibility means the Page Visibility API.** Window focus is not required, so a monitor on a second screen counts.
- **No catch-up.** An item that arrived while the monitor was attended gets no notification later.
- **Recovery summaries stay native.** After a restart the startup summary goes through the native surface only.
  Reconnecting tabs read the pending items themselves.
- **The flow host stays the only settler.** Every prompt resolves from the inbox settlement, even when another
  client answers. The monitor settles with `inbox.answer`, `inbox.decline` and `inbox.cancel`, never `inbox.prompt`.
- **`desktop.notifications: false` disables native notifications only.** The monitor still suppresses and notifies.
  The user opted in by opening it and granting browser permission.
- **The browser reuses `FlowControl`** through `createRemoteFlowControl`. The CLI, MCP and the monitor share one
  adapter.
- **The Flows page checks pasted definitions.** The daemon cannot return a registered flow's definition. A per-flow
  check would need a new daemon procedure.
- **Reconciliation.** Every list and detail hook buffers events, reads by generation and re-reads affected IDs. Inbox
  state keeps tombstones, so a stale snapshot cannot resurrect a settled item.
- **Trace polling.** The trace store holds only ended spans. The run trace therefore polls while active and briefly
  after the run ends.

The whole-branch review found three Important issues: a double-slash monitor URL, monitor tests missing from CI, and
an older daemon breaking attach. All were fixed, and one Minor finding on shutdown order was declined. Manual macOS QA
passed on 2026-10-04 with native notifications on. Only the older-daemon check was skipped.

## Findings carried over from the flow rig

- No public "call a tool with approval" outside `AgentSession`: solved by `authorize` in sub-project 1.
- Inbox entries carry only a context key: solved by inbox items keyed by run in sub-project 1.
- `tasks.wait` answers task input automatically: the runtime drives `tasks.get` and `tasks.update` in sub-project 1.
- Host elicit handling and the flow task API share no notion of a run: solved in sub-project 1.
- A failed flow reports `state: completed`: solved by the `failed` run state in sub-project 1.

## Post-merge review follow-ups

A post-merge review of the flow rig and flow daemon milestones (PRs #68 to #74) found gaps, bugs, convention breaks
and duplication. The findings were the requirements, with no separate spec. The work then adopted the helpers that
sozai and tejika shipped in response to mokei's upstream requests.

### Key decisions

- **No new packages.** Shared code moves along the existing dependency graph. `@mokei/flow-client` owns the run-state,
  error-code and span-nesting helpers. `@mokei/context-protocol` owns the browser-safe elicitation form-field parser.
- **Schema version before WAL.** The flow database checks its schema version before it sets the WAL pragma. Reopening
  a database already at the latest version must succeed.
- **Shared transactions.** `withTransaction` lives in its own module in `@mokei/flow-host-node`, shared by the SQLite
  stores.
- **Error classes take a single `Params` object.** `FlowHostErrorDescription.code` derives from
  `FlowControlErrorCode` instead of restating the codes.
- **`mokei daemon` delegates fully to `createDaemonCommand` from `@tejika/cli`.** It keeps no start and stop logic of
  its own.
- **Accepted behaviour changes.** `--pid-path` is now honoured. The JSON of a failed start no longer carries
  `flowService`. Human status output uses the upstream labels. Start and readiness have separate 30 s budgets.
- **Limited `lazy()`.** `@sozai/async` `lazy()` is used only where the memoised promise is internal and always
  awaited. Its body runs only when awaited, so it is never used for a public `dispose()` or shutdown callback.
- **One `@logtape/logtape` version.** The catalogue moved to `^2.3.11`. With two versions installed, `@enkaku/server`
  split into two peer variants and broke `HandlerError` instanceof checks.

### What was built

- A schema version check, the shared transaction helper, and an inbox reconcile that skips existing items.
- One set of flow types, error codes, span nesting and the elicitation parser, shared by the host, the CLI and the
  monitor.
- `decision.predict` spans descend from `flow.run`.
- `@sozai` adoption: `createKeyedQueue`, `settleAll`, `settleSequential`, `raceSignal`, `whenAborted`, `sleep` and
  `lazy` from `@sozai/async`. Also `toJSONValue` from `@sozai/json` and `renderLogMessage` from `@sozai/log`.
- `@tejika` adoption: the daemon command and output helpers from `@tejika/cli`, and prompt components from
  `@tejika/ui`. Also `followLog` from `@tejika/log` and `expandHome` and `readJSONFile` from `@tejika/env`.
- `@tejika/test` in the integration tests: `spawnCLI`, `runCLI`, `createTestProfile` and `poll`.
- Unused CLI dependencies removed, and the CLI docs and release intent updated.

### Not adopted

SQLite helpers and a Node OpenTelemetry setup were proposed upstream, but no shared package exists yet. Mokei keeps
its own code for both.

## Follow-ons

- [Flow client follow-ons](../backlog/2026-10-03-flow-client-follow-ons.md), from sub-project 4.
- [Flow monitor follow-ons](../next/2026-10-04-flow-monitor-follow-ons.md) and the
  [flow monitor backlog](../backlog/2026-10-04-flow-monitor-backlog.md), from sub-project 5.
- [Flow host Node follow-ons](../backlog/2026-10-02-flow-host-node-follow-ons.md), for historical tracing.
