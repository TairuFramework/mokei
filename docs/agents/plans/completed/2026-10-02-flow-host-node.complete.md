# Flow host Node storage and observability

**Status:** complete
**Date:** 2026-10-02
**Milestone:** [flow daemon](../completed/2026-10-01-flow-daemon-milestone.complete.md), sub-project 2
**Branch:** `feat/flow-host-node`

## Outcome

Added `@mokei/flow-host-node` with durable SQLite run, task and trace stores, process telemetry, configuration loading and retention.
Portable JSON contracts, memory trace storage, capture adapters, run correlation and pruning remain in the Node-free `@mokei/flow-host`.
Shared contracts prove memory and SQLite parity. A real file-reopen test proves waiting input survives host and session replacement.
The package includes lifecycle documentation and joins the fixed patch release group.

## Key decisions

- One process owns one database. JSON records preserve keys, revision checks, detached copies and stable ordering across memory and SQLite.
- Each run owns an independent root trace, linked to its caller. Recovery parents the stored trace context, preserving correlation across asynchronous work.
- Capture stays local to the owning process. Normalisation guards unusual values, and serialised log writes exclude capture diagnostics to prevent recursion.
- Successful provider registration consumes the telemetry lifetime. Cached tracer delegates survive rollback, so later setup failures and disposal require restart before another installation.
- Disposal suspends flow work for recovery, and tasks retain a null default TTL. Shutdown drains retention, hosts, sessions and telemetry before closing the database.
- Retention removes terminal records through a resumable cascade. Active tasks prevent deletion, and every remaining run protects its trace from orphan pruning.
- Configuration is validated and applied at restart. Defaults are info logging, 30-day retention and a daily pruning interval.
- Published declarations require direct production dependencies. The Node package declares flow-graph directly, and package tests remain valid across fixed-group version changes.

## Verification

All 14 implementation tasks and final review fixes are complete. Completion evidence came from task reports, reviews and commits, rather than maintained plan checkboxes.
Repository lint, build, full tests and release preview passed at `0ad15eb2`.
Portable flow-host passed 151 tests, Node flow-host passed 72, and flow rig passed 13.
Integration passed 104 tests with 35 intentionally skipped.
An isolated declaration probe confirmed the Node package dependency resolves, with a dependency-removal negative control.

## Follow-on

Published declaration dependencies in existing packages outside this implementation were folded into the flow CLI and MCP sub-project (see the [flow client follow-ons](../backlog/2026-10-03-flow-client-follow-ons.md)).
[Historical tracing and file-sink compatibility](../backlog/2026-10-02-flow-host-node-follow-ons.md) remain deferred.
Daemon composition, CLI, MCP and monitor work remain later sub-projects of the milestone.
