# Unified traces follow-ons

**Origin:** [unified traces](../completed/2026-10-09-unified-traces.complete.md). The initial implementation is documented in [architecture](../../architecture.md#unified-traces).

## Follow-ons

- Add a reverse-link index so a context trace can list calls made from flow traces into that context.
- Add `llm.chat` and `agent.turn` spans for `Session` and `AgentSession`.
- Add newest-first, span-filtered log paging after the `@hozon/store-log` query is available (requested upstream).
- Remove `context:message` from the wire after consumers have migrated to trace spans.
- Add an optional `types` filter param to the `events` stream, and pass `FLOW_EVENT_TYPES` from `flow-client` `subscribe()`. Today every subscriber receives every span and log, with payloads up to 64 KB. Filtering reduces bandwidth for subscribers that only need flow events. Enkaku requires a `prm` field once a procedure declares a param schema, so adding `types` breaks existing no-param `events` callers unless that is resolved first.
- Cap the monitor trace list. `useTraceList` merges every `trace:summary` event for the life of the page, including traces outside the loaded pages, so a monitor left open for days accumulates every trace.
- Show the server name in context trace rows. `server.name` arrives after the context root span starts, so the summary row has no display label for contexts yet.
- Let caller-built HTTP registrations supply a session ID accessor, so their request spans also carry `mcp.session.id`.
- Count lost summary deltas for persisted traces seen only through child spans. When hydration fails for good, or the hydration limit is hit, a child-only delta is dropped without incrementing `lostSummaryCount`, because the recorder cannot tell a persisted trace from an unrooted one. The load errors are still reported.

### Noise

- Vitest transform-performance and jsdom performance advisories in suite output.
- Deprecation and prepare-hook warnings in sandboxed test runs.
- Vite chunk-size warning in the monitor build.
