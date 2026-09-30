# Decision-flow server follow-ons

**Status:** open · follow-on of [decision-flow server](../completed/2026-09-29-decision-flow-server.complete.md)
**Package:** `@mokei/decision-flow-server`

## Items

- **Runtime tool IDs.** Tool IDs computed at run time, with per-call approval, since the approved set is fixed at plan time today.
- **Standalone binary.** Add `mcp-servers/decision-flow`, using a `NodeContextHost` built from a config of sibling servers.
- **`llm` node kind.** Add a session-backed kind that uses the session's `ModelProvider`.
- **Isolated validator options upstream.** Add `createValidatorCache({ maxCompiles, maxEntries })` to `@sozai/schema`, so the recycle rule in `src/validators.ts` can move out of this package. Requested upstream.
- **Validator factory in flow-graph.** Add a validator-factory option to `FlowGraphOptions` in `@sozai/flow-graph`, so the graph's own compiles use the recycled factory. Requested upstream.

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

## Done in the flow references, decline and validators PR

- **Input decline edge.** An `input` node's decline routes to its `decline` edge, including inside called flows.
- **Unconstrained result paths.** The `tool` kind's result schema no longer uses a 32-level `additionalProperties` chain.
- **Runtime validator recycling.** Runtime schemas compile on an isolated factory that is recycled after 256 distinct compiles, with a 64-entry LRU keyed by canonical JSON. Runs no longer recompile per run.
