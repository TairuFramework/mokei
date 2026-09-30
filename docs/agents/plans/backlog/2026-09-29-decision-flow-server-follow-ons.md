# Decision-flow server follow-ons

**Status:** open · follow-on of [decision-flow server](../completed/2026-09-29-decision-flow-server.complete.md)
**Package:** `@mokei/decision-flow-server`

## Items

- **Runtime tool IDs.** Tool IDs computed at run time, with per-call approval, since the approved set is fixed at plan time today.
- **Standalone binary.** Add `mcp-servers/decision-flow`, using a `NodeContextHost` built from a config of sibling servers.
- **`llm` node kind.** Add a session-backed kind that uses the session's `ModelProvider`.
- **Input decline edge.** Add a flow-graph `decline` resume event for `input` nodes, so a decline takes its own edge instead of cancelling the run. Blocked on `@sozai/flow-graph`: `ResumeEvent` and `validateResumeEvent` accept only `value` and `timeout`. The request is filed in sozai's backlog as `2026-09-30-flow-graph-input-decline-edge.md`.
- **Unconstrained result paths.** Replace the 32-level `additionalProperties` chain in the `tool` kind's result schema once `@sozai/flow-graph` can treat a schema as unconstrained. The request is filed in sozai's backlog as `2026-09-29-flow-graph-unconstrained-result-paths.md`.
- **Task input lifecycle.** Planned on branch `feat/task-input-lifecycle`, which builds on this one. It changes decision-flow input recovery:
  - an expired deadline replays a stored answer instead of re-asking;
  - `TaskInputKeyReusedError` fails the run, and the `inputSeq` re-ask goes away;
  - only the deadline maps to the timeout edge.

  It also fixes a waiter failure: a second waiter answering an already-answered key that is still listed fails its wait. The fix is that task snapshots list only unanswered keys.

## Done in the decision-flow server PR

- **Sibling task wait timeouts.** A `tool` node's `retry.attemptTimeoutMs` sets a suspend deadline on the sibling task wait, and `totalTimeoutMs` also bounds the wait. On expiry the driver cancels the sibling and times out or fails the node, including after recovery.
- **Bounded sibling cancellation.** It uses a 5-second limit.
- **Status write failures.** They map to `Flow status update failed`.
- **Malformed stored `siblings` entries.** Recovery ignores them.
- **`checkFlow`.** It builds a single graph.
- **Exports.** `index.ts` no longer exports driver and context-marker internals, and it exports `ToolNode` and `toolKind`.
- **Wrapped approval strategies.** The docs state that a wrapped strategy always emits `tool-call-pending`, including `'auto'`.

## Remaining minor cleanups

- The server version is hard-coded.
