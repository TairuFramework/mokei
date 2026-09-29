# Decision flow follow-ons

**Status:** open · follow-on of [decision flows](../completed/2026-09-28-decision-flow.complete.md)
**Package:** `@mokei/decision-flow` (and consumers)

## Items

- **Flow references.** When `@sozai/flow-graph` publishes `call`, `goto`, `loop.body: { flow }`
  and `FlowResolver` (tracked in `../sozai/docs/agents/plans/backlog/2026-09-28-flow-graph-flow-references.md`),
  add a forwarded `resolver` option to `createDecisionFlowGraph` and cover a cross-flow example.
- **MCP tools.** `check_flow` / `run_flow` in `mcp-servers/system-one`, returning `formatIssues`
  output so a model can repair a flow.
- **`AgentSession` integration.** Flows gating or routing session turns. The runtime has no
  session dependency, so this lives in the session layer.
- **HTTP backend retries.** `system-one-client`'s HTTP backend could adopt `@sozai/async`
  `retry()` with `retryAfterMs`, sharing the status classification in `retryableDecision`.
- **Tracer version.** Pass the package version to `createTracerFactory` once the build keeps JSON
  import attributes (kigu SWC config) or a portable version constant exists.
- **Checker coverage.** The `decide` checker skips any `{ value }`-shaped object, as the engine
  does, so a custom kind storing a filter under a field named `value` gets no choice-label check.
  Revisit if kinds expose filter-typed fields to the checker explicitly.
- **Smoke test cost.** `test:built` rebuilds the package inside `test`, bypassing Turbo's build
  cache. Move it to a step that runs after the cached build if the pipeline grows.
