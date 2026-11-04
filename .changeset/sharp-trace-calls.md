---
"@mokei/host-protocol": minor
"@mokei/app-node": minor
"@mokei/host-node": minor
"@mokei/flow-host-node": patch
"@mokei/flow-client": minor
---

Unified traces follow-ons. Context traces are named by their server: the recorder reads open spans live, so `mokei.server.name` (now also set by the daemon proxy from `initialize` or `server/discover`) reaches trace summaries and open-span snapshots. It is a summary attribute and part of the search text. A new `trace_calls` index records spans that call into another trace (`mokei.context.trace_id`). `traces.get` returns them as `calls` with `callsTruncated`, and the monitor lists them under "Called from". A new `traces.logs` procedure pages a trace's logs newest first, by span, before a time or with a cursor, and the monitor uses it for "Load older logs". A child-only summary delta dropped at the hydration limit is now looked up and counted as lost when its trace is indexed, and one left after hydration fails for good is counted too. **Breaking:** `events` takes a `{ types? }` param, and the daemon subscribes only to those types (`flow-client` asks for its three flow events). Every caller must now send `param` (`{}` for all events), so restart the daemon after upgrading. **Breaking:** `context:message` is removed from the `events` stream and from `@mokei/host-protocol`; MCP traffic is carried by trace spans.
