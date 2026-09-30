# Decision flow follow-ons

**Status:** open · follow-on of [decision flows](../completed/2026-09-28-decision-flow.complete.md) and
[laya suite and HTTP retries](../completed/2026-09-29-decision-flow-laya-and-retries.complete.md)
**Package:** `@mokei/decision-flow` (and consumers)

## Items

- **Flow references.** When `@sozai/flow-graph` publishes `call`, `goto`, `loop.body: { flow }`
  and `FlowResolver` (requested upstream),
  add a forwarded `resolver` option to `createDecisionFlowGraph` and cover a cross-flow example.
- **MCP tools and `AgentSession` integration.** Done by
  [decision-flow server](../completed/2026-09-29-decision-flow-server.complete.md) (`check_flow`,
  `run_flow` and registered-flow task tools, wired into `AgentSession`). Flows gating or routing
  session turns without a tool call remain open.
- **Tracer version.** Pass the package version to `createTracerFactory` once the build keeps JSON
  import attributes (kigu SWC config) or a portable version constant exists.
- **Checker coverage.** The `decide` checker skips any `{ value }`-shaped object, as the engine
  does, so a custom kind storing a filter under a field named `value` gets no choice-label check.
  Revisit if kinds expose filter-typed fields to the checker explicitly.
