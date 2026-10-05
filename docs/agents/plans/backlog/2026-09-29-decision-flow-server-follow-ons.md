# Decision-flow server follow-ons

**Status:** open · follow-on of the decision-flow server in [decision flows](../completed/2026-09-29-decision-flow.complete.md)
**Package:** `@mokei/decision-flow-server`

## Items

- **Runtime tool IDs.** Tool IDs computed at run time, with per-call approval, since the approved set is fixed at plan time today.
- **Standalone binary.** Add `mcp-servers/decision-flow`, using a `NodeContextHost` built from a config of sibling servers.
- **`llm` node kind.** Add a session-backed kind that uses the session's `ModelProvider`.
- **Validator cache package upstream.** A new sozai package exposing `createValidatorCache({ factory, maxCompiles, maxEntries })` over `createValidatorFactory` and `@sozai/json` canonical keys, so the recycle rule in `src/validators.ts` and in `@mokei/host-desktop`'s `src/form.ts` can move out of mokei. Requested upstream.
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

- The server version is hard-coded. Same blocker as the decision-flow tracer version: the build does not keep JSON import attributes and no portable version constant exists.
- Once the standalone binary exists, cover `run_flow` calling a registered flow with a declined input over stdio (`NodeContextHost`).

## Done in the flow references, decline and validators PR

- **Input decline edge.** An `input` node's decline routes to its `decline` edge, including inside called flows.
- **Unconstrained result paths.** The `tool` kind's result schema no longer uses a 32-level `additionalProperties` chain.
- **Runtime validator recycling.** Runtime schemas compile on an isolated factory that is recycled after 256 distinct compiles, with a 64-entry LRU keyed by canonical JSON. Runs no longer recompile per run.

## Done in the [quick follow-ons](../completed/2026-09-30-quick-follow-ons.complete.md) PR

- **Uncompilable tool schemas.** A node referencing a catalogue tool whose input schema fails to compile gets a `tool_invalid_schema` issue at `['nodes', id, 'tool']` instead of throwing from `check_flow`.
