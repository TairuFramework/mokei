# Flow daemon

**Status:** complete
**Date:** 2026-10-02
**Milestone:** [flow daemon](../milestones/2026-10-01-flow-daemon-milestone.md), sub-project 3
**Branch:** `feat/flow-daemon`

## Outcome

The CLI-owned daemon composes one shared durable flow service, generic proxy serving and an injected desktop adapter.
Portable wire contracts expose flow, run and inbox procedures, service status and live events.
Recovery reconciles stored tasks and inbox items before readiness. Failed flow initialization leaves proxy and monitor status available.
Host-node remains independent of flow and desktop implementations.

## Key decisions

- Desktop notifications default off. Configuration applies on restart.
- Startup sends nothing for zero pending items, one item notification for one, or one generic count notification for several.
- New items notify once per daemon lifetime without content previews. Polling and reconnects do not notify.
- Dialogs require explicit inbox prompting. Answers pass runtime validation, and remote settlement prevents late answers.
- Caller cancellation releases dialog ownership while leaving the item pending.
- Events have no replay. Clients subscribe before querying and reconcile current records on reconnect.
- Shutdown stops admission and drains admitted calls and desktop operations. Durable runs suspend for recovery.
- Sessions and local telemetry drain before SQLite closes. Remote telemetry phases have ten-second budgets within a sixty-second shutdown deadline.
- Permanently stuck work can exhaust shutdown and produce a reported failure exit.
- Direct sibling elicitation outside task inputs retains the existing decline fallback.
- CLI command families and the MCP facade remain sub-project 4. Monitor pages remain sub-project 5, and the rig stays through sub-project 4.

## Verification and review

All nine implementation tasks passed task reviews.
Whole-branch review found missing production protocol validation and an insufficient shutdown deadline.
Both fixes passed scoped re-review without new Critical or Important findings.
Repository build, typechecks and lint passed. The full suite passed 3,385 tests with 41 expected skips, including 14 daemon process scenarios.
Release preview confirmed the fixed group's patch intent. No versions were applied and no packages were published.

Published Enkaku protocol 0.21.4 replaced the workspace patch.
The [dependency adoption](2026-10-02-enkaku-protocol-schema-rebasing.complete.md) passed fresh packed-consumer verification without patches or workspace links.

The user deferred native desktop QA for this chunk. Automated adapters do not establish native UI quality.
[Native desktop QA](../next/2026-10-02-flow-daemon-native-desktop-qa.md) remains explicit follow-on work.
Existing [declaration dependency work](../backlog/2026-10-03-flow-client-follow-ons.md) and
[historical tracing work](../backlog/2026-10-02-flow-host-node-follow-ons.md) remain separately tracked.
