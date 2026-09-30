# Decision-flow server — complete

**Status:** complete
**Date:** 2026-09-29
**Branch:** `feat/decision-flow-server`
**Origin:** the MCP tools and `AgentSession` integration items in
[decision flow follow-ons](../backlog/2026-09-28-decision-flow-follow-ons.md). Builds on the
[MCP Tasks extension](2026-09-29-mcp-tasks-extension.complete.md) and
[session elicitation](2026-09-29-session-elicitation.complete.md).

## Goal

Run decision flows whose steps call MCP tools. A new MCP server, `@mokei/decision-flow-server`, sits
beside the other servers of a session. It calls their tools from `tool` nodes and runs `decide`
nodes through a System One backend, by default the sibling `system-one` server. Each run is an MCP
task. The first consumer is an `AgentSession`: the model delegates multi-step work to a flow the
application registered, or to one it writes and repairs itself. This replaces the earlier idea of
`check_flow` / `run_flow` tools inside `mcp-servers/system-one`.

## What was built

- **`@mokei/decision-flow-server`** (new package, in the fixed release group):
  - `createDecisionFlowServer({ caller, predictor, tasks, flows, approval })` exposes three kinds of tool:
    - `check_flow`, synchronous, returns `formatIssues` output so a model can repair its flow;
    - `run_flow`, task mode, for an inline definition;
    - one task tool per registered flow, named after its ID (`support/triage` becomes `flow_support_triage`).
  - `addDecisionFlow(session, { key, flows?, predictor?, store? })` wires the server into a `Session` as a direct context. It runs recovery before registering and rolls back on failure. It returns `wrapApproval(strategy)` and `dispose()`.
  - A `tool` node kind calls sibling MCP tools, including task tools, and routes on their results.
  - `createMCPPredictor` calls the sibling System One `predict` tool.
  - Recovery restores persisted runs.
- **`@mokei/session`:** a `ToolApprovalFn` may return `{ approved: true, meta }`, and that `meta` reaches the approved tool call as `_meta`.
- **`@mokei/decision-flow`:** `decideKind` and `createDecisionFlowGraph` accept any `Predictor`. The predictor receives the node's `call` (`runID`, `invocationID`, `attempt`).
- **`mcp-servers/system-one`:** `predict` declares an `outputSchema` and returns `structuredContent`. The text content is unchanged.
- **`@mokei/context-server`:** `TaskManager.update` rejects a response for a key that is not outstanding with `-32602` `Task is not awaiting input for <key>` and `data: { key }`. That covers a withdrawn, answered or unknown key, and a task not awaiting input. A multi-key update with one stale key is rejected whole.
- **`@mokei/context-client`:** on that rejection the task waiter fetches an authoritative `tasks/get`. It keeps waiting when the key was withdrawn, and surfaces the error only when the key is still outstanding.

## Key design decisions

- **One approval per run, inside the agent's tool gate.**
  - `wrapApproval` computes the run's plan in-process: every `tool` node ID, plus the predictor tool.
  - It applies the agent's strategy to the plan. A function strategy receives `flow: { id?, name, inline, tools }` as a `FlowApprovalRequest`.
  - On approval it mints a single-use grant token (random UUID, bound to tool name and canonical-argument digest, 5-minute lifetime). The token travels only as that call's `_meta['dev.mokei/flow-grant']`.
  - The server consumes the grant atomically before creating a task, so a concurrent identical call cannot reuse it.
  - An invalid inline definition skips approval, so the server returns formatted issues and creates no task.
  - `approval` is required; there is no approving default.
- **Server check order:** depth, then definition, then grant, then task creation.
  - Nested flow calls carry `dev.mokei/flow-depth`, capped at 4.
  - All flow contexts on one host exclude each other from their catalogues, which prevents recursion. Keys are reserved synchronously, so concurrent wiring cannot collide.
- **At-least-once delivery.**
  - Every sibling call carries `dev.mokei/idempotency-key = <runID>:<invocationID>` and `dev.mokei/attempt`. Tools that must not repeat an action deduplicate on the key.
  - Sibling task handles are committed to run state before the driver waits on them. A crash in that window leaves an orphaned sibling task, and recovery calls the tool again with the same key.
  - A lost sibling wait cancels the sibling.
  - The node's attempt and total timeouts bound the sibling task wait; on expiry the sibling is cancelled.
  - Invalid structured output from a sibling is `tool_invalid_output` and is not retried.
- **Input nodes use MCP form elicitation.**
  - Schemas must be a primitive, a string enum, or a flat object of primitives; anything else is `input_schema_not_elicitable`.
  - A bare string enum is sent with `type: 'string'`.
  - The input key is `<runID>:<invocationID>:input:<inputSeq>`. A deadline withdraws the outstanding request, so a late answer is rejected rather than applied.
- **Recovery.**
  - A run stored as ended, errored or aborted settles from stored state.
  - A removed or changed registered flow fails with `Flow definition changed`, detected by a digest check. A definition that no longer passes the catalogue check fails with `Flow no longer valid`.
  - Otherwise the run resumes by status:
    - `running`: `graph.recover`;
    - suspended on input: re-attach, or withdraw a stale request whose deadline passed during downtime, then take the timeout edge;
    - suspended on a sibling task: wait on that task again;
    - suspended on a retry: its timer.
  - A lookup for `flow_*` names serves only recovery. It is never listed and cannot be called.
  - Resume data must be version 1.
- **Tool results with no declared schema.** The `tool` kind's result schema is a 32-level `additionalProperties` chain, so `results.<node>.<path>` references check. The flow-graph checker cannot yet treat a schema as unconstrained; the ask is requested upstream in `@sozai/flow-graph`.

## Testing

- The package has 171 unit tests.
- An `AgentSession` integration suite runs the support-triage example end to end. It includes an `input` answered through `onElicitation`, and checks that aborting the agent cancels both the run and its sibling task.
- A laya-gated variant (`suites/laya-decision-flow-server.test.ts`) passed live.
- The full workspace `pnpm test` is green.

## Follow-on

See [decision-flow server follow-ons](../backlog/2026-09-29-decision-flow-server-follow-ons.md).
