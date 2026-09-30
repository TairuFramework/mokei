# Flow references, input decline and isolated validators — complete

**Status:** complete
**Date:** 2026-09-30
**Branch:** `feat/flow-references-decline-validators`
**Origin:** `@sozai/flow-graph` 0.2.0 (flow references, `input` decline edge, unconstrained result
schemas) and `@sozai/schema` 0.1.3 (`createValidatorFactory`) unblocked four backlog items from
[decision-flow follow-ons](../backlog/2026-09-28-decision-flow-follow-ons.md),
[decision-flow server follow-ons](../backlog/2026-09-29-decision-flow-server-follow-ons.md) and
[host-desktop follow-ons](../backlog/2026-09-30-host-desktop-follow-ons.md). Builds on the
[decision-flow server](2026-09-29-decision-flow-server.complete.md) and
[host desktop](2026-09-30-host-desktop.complete.md) work.

## Goal

Ship flow references (`call`, `goto`, flow-body `loop`) with a `list_flows` discovery tool, an
`input` node decline edge, unconstrained `tool` result paths, and isolated, recycled AJV instances
for runtime schemas, in one PR.

## Key design decisions

- **Flow registry is the single source of registered definitions.** Registered flows are stored as
  `structuredClone` snapshots with a `digestDefinition` digest taken at registration, so later
  mutation of the caller's objects has no effect. Tools, recovery, `list_flows` and the wiring
  approval map and elicitation guard all read the snapshots. One version per flow id; a duplicate id
  throws `Duplicate registered flow id: <id>`.
- **Runtime definitions reference registered flows plus themselves only.** A per-definition
  resolver returns the definition for its own id (matching or omitted version), then delegates to
  the registry. A runtime definition reusing a registered id with a different digest gets the
  `flow_id_conflict` error issue at `['id']`; a digest-equal copy is accepted.
- **Async checks.** `checkFlow` and `createDecisionFlowServer` became async around
  `graph.checkFlows()`. `graph.check` runs first; on success the `checkFlows` result replaces its
  issues (no duplicated root warnings). The mokei input-node checks and `input_without_elicitation`
  run over every reachable flow, with callee issues prefixed `['flows', id, version]`.
  Registration checks each flow after the whole registry exists, so flows may reference
  later-registered ones; a failure throws `Invalid registered flow <id>`.
- **One reachable-flow walk** (`reachableFlows`, edges `'all'` or `'goto'`) with a visited
  `(id, version)` set and full tolerance of malformed input. `flowPlan` and the elicitation guard
  use `'all'`, so approvals cover callee tools; `list_flows` uses `'goto'` to derive the
  `outputs`/`outcomes` a caller can read.
- **Decline routing uses the active frame.** The driver resolves the pending node through the last
  frame and a synchronous lookup, so a decline inside a callee uses the callee's `decline.to`. A
  missing response counts as cancel. Without the edge, or when the lookup fails, the task is
  cancelled as before.
- **Pinned-frame safety.** `resume`/`recover` are lazy, so `FlowVersionMismatchError` and
  `FlowReferenceError` from `next()` map to `Flow definition changed`. Recovery checks every frame's
  id, version and digest before `checkFlow`, so a changed or removed callee reports
  `Flow definition changed` rather than `Flow no longer valid`.
- **Unconstrained result paths.** Tools without an `outputSchema` use `{}`; the 32-level depth
  bound is gone.
- **Validator recycling per package, not a shared package.** `decision-flow-server`
  (`src/validators.ts`) and `host-desktop` (`form.ts`) each lazily create a
  `createValidatorFactory` instance, key a 64-entry LRU by canonical JSON (keys sorted
  recursively), count failed compiles too, and on the first miss after 256 distinct compiles
  dispose the factory and start fresh. Validators are looked up at use and not held, so suspended
  runs keep no factory alive; this also removed a per-run recompile of every catalogued tool.
  A shared `createValidatorCache` and a flow-graph validator-factory option are requested upstream.

## What was built

- `@mokei/decision-flow`: flow-reference tests (call into a decide flow, goto, loop body, resume
  across a callee suspension) and a README section. No source change.
- `@mokei/decision-flow-server`: flow registry and exports (`createFlowRegistry`, `FlowRegistry`,
  `FlowSummary`, `flowSummaries`), async `checkFlow` (takes `registry`) and
  `createDecisionFlowServer` (accepts `flows` or `registry`), transitive `flowPlan` (takes a
  `lookup`), `list_flows` tool, decline edge routing, registry-based recovery with the frame check,
  unconstrained result paths, recycled validators, README and integration test.
- `@mokei/host-desktop`: form validators on an isolated recycled factory with canonical keys.
- Patch changesets naming the breaking signature changes.

## Deviations

- Two changesets instead of one (identical release outcome in the fixed group).
- The integration test drives `run_flow` through `Session` and `addDecisionFlow` rather than
  `NodeContextHost`: the decision-flow server is only a direct context until the standalone binary
  exists.
