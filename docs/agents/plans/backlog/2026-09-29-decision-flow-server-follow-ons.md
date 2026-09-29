# Decision-flow server follow-ons

**Status:** open · follow-on of [decision-flow server](../completed/2026-09-29-decision-flow-server.complete.md)
**Package:** `@mokei/decision-flow-server`

## Items

- **Runtime tool IDs.** Tool IDs computed at run time, with per-call approval, since the approved set is fixed at plan time today.
- **Standalone binary.** Add `mcp-servers/decision-flow`, using a `NodeContextHost` built from a config of sibling servers.
- **`llm` node kind.** Add a session-backed kind that uses the session's `ModelProvider`.
- **Input decline edge.** Add a flow-graph `decline` resume event for `input` nodes, so a decline takes its own edge instead of cancelling the run.
- **Sibling task wait timeouts.** A `tool` node's `retry.timeoutMs` / `totalTimeoutMs` bounds the call, not the wait on a sibling task. A hung sibling task ends only on client cancellation or task TTL. Add a suspend deadline so the node's timeout branch can run.
- **Unconstrained result paths.** Replace the 32-level `additionalProperties` chain in the `tool` kind's result schema once `@sozai/flow-graph` can treat a schema as unconstrained. The request is filed in sozai's backlog as `2026-09-29-flow-graph-unconstrained-result-paths.md`.
- **Minor cleanups:**
  - The server version is hard-coded.
  - `wrapApproval('auto')` emits a pending event for every tool, which contradicts the `agent-types.ts` doc.
  - `index.ts` exports internals (`startRun`, `ResumeDataV1`, the context mark/unmark helpers) but not `ToolNode` or `toolKind`.
  - A failed `setStatus` fails the task with a raw error.
  - `checkFlow` builds its graph through two parallel paths.
  - The driver's sibling `cancelTask` has no timeout.
  - A `null` entry in stored `siblings` throws a `TypeError` before the per-entry recovery handling.
  - A second waiter answering an already-answered key that is still listed fails its wait.
- **Input recovery changes planned with host desktop interaction.** That work, on branch `feat/mcp-notify`, changes decision-flow recovery:
  - a completed-request replay returns a stored answer instead of re-asking;
  - `TaskInputKeyReusedError` means changed contents and fails the run;
  - a legacy `InputRequestOutcomeUnknownError` triggers the re-ask;
  - only the deadline abort reason maps to the timeout edge.
