# Decision flow follow-ons

**Status:** open · follow-on of [decision flows](../completed/2026-09-29-decision-flow.complete.md), including the
laya suite and HTTP retries
**Package:** `@mokei/decision-flow` (and consumers)

## Items

- **MCP tools and `AgentSession` integration.** Done by
  the [decision-flow server](../completed/2026-09-29-decision-flow.complete.md) (`check_flow`,
  `run_flow` and registered-flow task tools, wired into `AgentSession`). Flows gating or routing
  session turns without a tool call remain open.
- **Tracer version.** Pass the package version to `createTracerFactory` once the build keeps JSON
  import attributes (kigu SWC config) or a portable version constant exists.
- **Checker coverage.** The `decide` checker skips any `{ value }`-shaped object, as the engine
  does, so a custom kind storing a filter under a field named `value` gets no choice-label check.
  Revisit if kinds expose filter-typed fields to the checker explicitly.

## Done in the flow references, decline and validators PR

- **Flow references.** Registered flows can reference each other, and `@mokei/decision-flow-server` resolves them through a registry.
