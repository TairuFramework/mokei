# Flow daemon design

**Date:** 2026-10-02
**Branch:** `feat/flow-daemon`
**Milestone:** [flow daemon, sub-project 3](../../agents/plans/milestones/2026-10-01-flow-daemon-milestone.md)

## Purpose and success criteria

The existing per-user daemon hosts durable decision flows alongside context proxy services.
Scripts and future CLI, MCP and monitor surfaces use one host protocol.
Runs, approval requests and task inputs survive daemon replacement through the existing SQLite stores.

Phase 3 delivers protocol procedures, handler composition, the CLI-owned daemon entry, recovery and desktop integration.
Its exit criterion is a passing daemon integration suite, including process restart and resume.
Phase 4 delivers user-facing daemon, flow, run and inbox commands and the MCP facade.
Phase 5 delivers monitor pages.
The flow rig remains available until phase 4.

The user approved these requirements:

- Proxy and monitor services remain available when flow configuration or startup fails.
- Flow service status exposes startup progress and actionable failure information.
- Desktop notifications are opt-in and default to off.
- Multiple pending items at startup produce one generic notification containing the pending count.
- One pending item at startup produces one item notification.
- New inbox items produce individual notifications when enabled.
- Desktop dialogs open only through an explicit inbox request.

## Architecture and ownership

### `@mokei/host-protocol`

This portable package owns wire schemas for flow procedures, service status and events.
Wire schemas describe public snapshots rather than persistence records.
Internal task IDs, revisions, request metadata and approval digests remain private.

### `@mokei/host-node`

This package owns generic daemon serving, context proxy handlers and handler composition.
It accepts injected handler sets, event sources and lifecycle hooks.
It has no flow or desktop implementation dependency.
Duplicate procedure registrations fail explicitly rather than silently overriding handlers.

Existing `createClient`, `runDaemon`, proxy behaviour and socket overrides remain compatible.
Daemon launch accepts an explicit entry path so callers can select the composed application entry.
The standalone host entry remains usable with flow services unavailable.

### `@mokei/flow-host-node`

This package owns flow service initialization, durable resources, recovery and flow procedure handlers.
It composes the existing portable runtime, SQLite stores, configuration loader, telemetry and retention.
It receives desktop operations through an injected adapter rather than importing desktop implementation code.
Flow service initialization occurs once per daemon process, shared by every connected client.

### `@mokei/cli`

A dedicated executable module composes the generic host, flow service and desktop adapter.
Existing proxy and monitor commands select this entry when ensuring the daemon exists.
The entry loads configuration from the existing per-user data directory.
Explicit path overrides support isolated tests without changing normal defaults.
No new user-facing command family belongs to this phase.

### `@mokei/host-desktop`

This package supplies native notifications and explicitly requested dialogs through its existing backend abstractions.
A small reusable notification operation supports the startup count message.
Desktop failure never removes or automatically answers an inbox item.
No new package is required.

## Service status and availability

Flow service status is a discriminated union of `starting`, `ready` and `failed`.
Failed status includes a public error type and actionable message.
Configuration failures include the configuration path and validation issues when available.
Status messages exclude credentials and configured environment values.

The `info` response retains existing context information and adds flow service status.
The generic standalone entry reports flow services unavailable through failed status.
Injected status comes from the same service instance used by request handlers.

Proxy handlers and status inspection become available before flow initialization completes.
Flow procedures report unavailable while status is `starting` or `failed`.
Initialization success publishes `ready` only after initial recovery and inbox reconciliation.
Initialization failure cleans up acquired resources and publishes `failed`.
The daemon continues serving existing services.

Configuration changes take effect on daemon restart.
This phase adds no automatic startup retry or hot reload.
Telemetry registration can consume the process lifetime even when later initialization fails.
Restart remains the supported recovery action for that failure.

## Protocol procedures

| Procedure | Parameters | Result |
|-----------|------------|--------|
| `info` | None | Existing host information and flow service status |
| `flows.list` | None | Registered flow summaries |
| `flows.check` | Inline definition | Existing flow validation result |
| `runs.start` | Registered flow ID or inline definition, optional input and label | Run snapshot |
| `runs.get` | Run ID | Run snapshot |
| `runs.list` | Optional states, limit and updated-before filter | Run snapshots |
| `runs.cancel` | Run ID | Run snapshot |
| `runs.trace` | Run ID | Stored spans and logs for that run |
| `inbox.list` | Optional run ID | Pending inbox items |
| `inbox.get` | Item ID | Pending inbox item |
| `inbox.answer` | Item ID, optional content | Successful settlement acknowledgement |
| `inbox.decline` | Item ID, optional reason | Successful settlement acknowledgement |
| `inbox.cancel` | Item ID | Successful settlement acknowledgement |
| `inbox.prompt` | Item ID | Desktop action after validated settlement |

`runs.start` follows the existing runtime's registered and inline forms.
Run snapshots preserve existing states, results, errors, labels and trace IDs.
Inbox schemas distinguish approvals from task inputs.
Answers pass through existing runtime validation and single-use approval authorization.
No caller can bypass approval by selecting a different procedure.

An unknown run or inbox item produces a missing-record error.
A known run without a trace returns empty spans and logs.
Trace reads expose captured records, which may lag active work because export is batched.
Reads do not force telemetry flushing or expose unrelated trace IDs.

Unavailable service, missing record, invalid definition, invalid answer and unsupported dialog failures remain distinguishable.
Handlers map domain failures into structured Enkaku errors without leaking arbitrary exception internals.
Unexpected errors are logged and return a generic internal failure.

## Events and reconnects

The existing `events` stream retains context start, stop and message events.
It adds service status, `run:state`, `inbox:added` and `inbox:settled` events.
Every event has an event ID and timestamp.
Flow events identify runs and inbox items without fabricated context IDs.
Service status events identify the flow service.

Events describe live changes, not a durable replay log.
Clients subscribe before fetching `info`, run snapshots and the inbox.
Clients buffer events during those reads and reconcile affected identifiers afterwards.
Re-reading affected records avoids applying stale buffered snapshots over newer query results.
Reconnect repeats this process rather than assuming uninterrupted delivery.

All connections share one event source and one flow runtime.
Each stream owns its listener cleanup and respects transport cancellation.
Disconnected event consumers cannot block runtime transitions or notification delivery.

## Startup and recovery

The daemon starts generic serving while flow status is `starting`.
Flow initialization follows these dependencies:

1. Load and validate configuration and flow files.
2. Open SQLite and construct run, task and trace stores.
3. Install process telemetry before starting flow work.
4. Create the session and connect configured sibling servers.
5. Register flows and recover persisted tasks and runs.
6. Await each recovered run's initial task and inbox reconciliation.
7. Start retention and publish ready status.
8. Send the optional startup inbox notification.

The current runtime launches asynchronous task watchers during recovery.
Creation alone does not guarantee that recovered input items already exist in the inbox.
A focused runtime readiness barrier provides initial reconciliation without sleeps or polling guesses.
It waits for initial task snapshots, not completion of pending flows or user answers.
Recovery listeners attach during construction so startup events are not lost.

Recovery retains run IDs, task IDs and stored trace context.
Pending approvals use the runtime's existing policy revalidation.
Individual recovery failures become failed runs through existing runtime behaviour.
They do not disable otherwise usable flow services.
Fatal initialization failures clean up partial resources and disable flow procedures.

The session enables task input elicitation without opening unsolicited desktop dialogs.
Durable flow inputs continue through the runtime inbox.
Direct sibling elicitation outside the task inbox follows the host's existing decline fallback.
Extending durable attribution to those requests is outside this phase.

## Desktop policy

Configuration adds `desktop.notifications`, a boolean defaulting to `false`.
Missing desktop configuration preserves existing configuration defaults.
Configuration changes apply on restart.

During recovery, inbox additions collect into the startup population without per-item notifications.
After initial reconciliation, notification delivery takes one current pending-item snapshot.
Zero items produce no notification.
One item produces an item notification.
Multiple items produce one generic message stating the pending count.

The startup-to-live handoff records represented item IDs before asynchronous delivery begins.
Items added after that boundary notify individually.
Polling, event subscriptions and client reconnects do not send notifications.
Repeated additions for the same pending item do not repeat delivery within one daemon lifetime.
Restart intentionally announces the current pending population again.
Notification messages use generic labels without input content previews.
Delivery failures are logged without automatic retry or inbox mutation.

`inbox.prompt` opens a dialog only for a currently pending, supported item.
Approval dialogs show the flow label and planned tools, then require explicit approval.
Input dialogs use the item's requested schema.
The runtime validates answers before settlement.
Dialog cancellation follows the runtime's existing inbox cancellation semantics.

Only one prompt operation owns an item at a time.
A concurrent request for that item returns a distinguishable prompt-in-progress error.
The desktop surface serializes native dialogs across items.
Settlement elsewhere aborts the active dialog and prevents a late answer.
Request cancellation or daemon shutdown aborts the dialog without fabricating an inbox answer.
Notification opt-in controls notifications only, leaving explicitly requested dialogs available.

## Shutdown and resource ownership

Shutdown first stops admitting flow requests and aborts active desktop operations.
It awaits admitted calls before disposing their resources.
Retention stops and awaits its current pass.
The flow runtime suspends work for recovery rather than cancelling stored runs.
The session then disconnects sibling processes.
Telemetry drains spans and logs before SQLite closes.

Generic serving stops through the daemon lifecycle and cleans up tracked proxy children.
Shutdown is idempotent across RPC shutdown, signals and initialization races.
Initialization cannot publish ready status or retain resources after shutdown begins.
Cleanup attempts every acquired resource even when an earlier disposal fails.

## Validation

Unit tests cover protocol schemas, public error mapping, handler composition and stream cancellation.
Service tests cover initialization failures, readiness and cleanup with injected dependency failures.
Desktop tests use injected backends rather than real notifications or dialogs.

Daemon integration tests use actual child processes, a temporary socket and a temporary SQLite database.
They cover these observable behaviours:

- Existing context proxy and status procedures work with valid and invalid flow configuration.
- Multiple clients see the same runs, inbox and live events.
- Registered and inline runs enforce existing approval policy.
- Pending approvals survive daemon restart and can launch after explicit approval.
- Waiting inputs survive restart with the same run, task, inbox item and trace identities.
- Answering a recovered input completes its run and leaves no duplicate task.
- Abrupt process replacement preserves checkpointed waiting work.
- Notifications default to off.
- Startup emits zero, one item notification or one count notification for zero, one or multiple items.
- Newly added items notify once after startup when enabled.
- Reconnects, polling and duplicate item events produce no extra notifications.
- Unsupported dialogs and notification failures leave items available.
- Settlement elsewhere aborts a dialog and rejects its late answer.
- Shutdown suspends durable runs and drains capture before database closure.

Repository lint, build and tests remain required implementation checks.
Manual desktop QA follows implementation with notifications explicitly enabled.

## Scope boundaries

This phase adds no new package, trigger system, configuration watcher or persistent event replay.
It does not add CLI command families, the MCP facade or monitor pages.
It leaves historical trace backfill and unrelated published declaration dependency gaps in their existing follow-on plans.
