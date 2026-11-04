# Unified traces follow-ons

**Origin:** [unified traces](../completed/2026-10-09-unified-traces.complete.md). The initial implementation is documented in [architecture](../../architecture.md#unified-traces).

## Follow-ons

- Add a reverse-link index so a context trace can list calls made from flow traces into that context.
- Remove `context:message` from the wire after consumers have migrated to trace spans.
- Add an optional `types` filter param to the `events` stream, and pass `FLOW_EVENT_TYPES` from `flow-client` `subscribe()`. Today every subscriber receives every span and log, with payloads up to 64 KB. Filtering reduces bandwidth for subscribers that only need flow events. Enkaku requires a `prm` field once a procedure declares a param schema, so adding `types` breaks existing no-param `events` callers unless that is resolved first.
- Show the server name in context trace rows. `mokei.server.name` arrives after the context root span starts, so the summary row has no display label for contexts yet.
- Count lost summary deltas for persisted traces seen only through child spans. When hydration fails for good, or the hydration limit is hit, a child-only delta is dropped without incrementing `lostSummaryCount`, because the recorder cannot tell a persisted trace from an unrooted one. The load errors are still reported.

Newest-first, span-filtered log paging waits on `@hozon/store-log` (see the upstream dependency gaps).
