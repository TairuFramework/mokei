# Decision flow follow-ons

**Status:** open · follow-on of [decision flows](../completed/2026-09-28-decision-flow.complete.md) and
[laya suite and HTTP retries](../completed/2026-09-29-decision-flow-laya-and-retries.complete.md)
**Package:** `@mokei/decision-flow` (and consumers)

## Items

- **Flow references.** When `@sozai/flow-graph` publishes `call`, `goto`, `loop.body: { flow }`
  and `FlowResolver` (tracked in `../sozai/docs/agents/plans/backlog/2026-09-28-flow-graph-flow-references.md`),
  add a forwarded `resolver` option to `createDecisionFlowGraph` and cover a cross-flow example.
- **MCP tools.** `check_flow` / `run_flow` in `mcp-servers/system-one`, returning `formatIssues`
  output so a model can repair a flow.
  `run_flow` returns a durable handle through the MCP Tasks extension
  (`io.modelcontextprotocol/tasks`), now implemented
  ([MCP Tasks extension](../completed/2026-09-29-mcp-tasks-extension.complete.md)).
- **`AgentSession` integration.** Flows gating or routing session turns. The runtime has no
  session dependency, so this lives in the session layer.
- **Tracer version.** Pass the package version to `createTracerFactory` once the build keeps JSON
  import attributes (kigu SWC config) or a portable version constant exists.
- **Checker coverage.** The `decide` checker skips any `{ value }`-shaped object, as the engine
  does, so a custom kind storing a filter under a field named `value` gets no choice-label check.
  Revisit if kinds expose filter-typed fields to the checker explicitly.
