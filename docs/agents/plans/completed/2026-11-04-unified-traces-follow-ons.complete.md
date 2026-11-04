# Unified traces follow-ons

**Status:** complete
**Date:** 2026-11-04

## Goal

Close `backlog/2026-10-08-unified-traces-follow-ons.md` (from
`completed/2026-10-09-unified-traces.complete.md`), with the `@hozon/store-log` paging item it
listed as waiting upstream.

## Shipped

- **Server names for contexts.** The recorder holds open spans live, so attributes set after start
  reach open-span snapshots, and reach root summaries on the next flush tick. `mokei.server.name`
  is a summary attribute and part of the search text. The monitor titles context rows and headers
  with it. The daemon proxy now sets it from the `initialize` or `server/discover` result, as
  `ContextHost` and `ContextClient` already did.
- **Reverse links.** A `trace_calls` table in the trace index (migration `1-calls`) records each
  span carrying `mokei.context.trace_id` for another trace, in its flush transaction, and prunes
  it with either end's trace. `traces.get` returns `calls` (newest first, 200,
  `callsTruncated`), merged with calls still in the recorder. The monitor lists them under
  "Called from" and adds live calls from span events.
- **Log paging.** `traces.logs` (trace, optional span, `before`, cursor, limit) pages newest
  first through `@hozon/store-log` `queryLogs`. The first page includes unflushed logs. The
  monitor's truncation notice offers "Load older logs". The query was already in 0.4.0, so it was
  never blocked upstream.
- **Lost summary deltas.** A child-only delta dropped at the hydration limit triggers one bounded,
  deduplicated index lookup. It counts as lost only if the trace is indexed; otherwise the trace
  is unrooted. When hydration fails for good, a delta holding child spans counts as lost.
- **`events` type filter.** `events` takes `{ types? }`, and the daemon subscribes only to those
  types. `flow-client` requests its three flow events.
- **`context:message` removed** from the protocol and the daemon, with the unused monitor
  `EventBadge`. Proxy tests now wait on a child acknowledgement instead of the event.

The backlog's session ID accessor for caller-built HTTP registrations was dropped earlier the same
day, as `2025-11-25`-only. See the second pass in `2026-11-04-backlog-trim.complete.md`.

## Decisions

- **Breaking `events` change**, chosen over a second procedure. Enkaku 0.22 requires `prm` once a
  param is declared, so every caller now sends one, and a CLI and a daemon from either side of
  the change cannot share an `events` stream: restart the daemon after upgrading.
- **Unverifiable losses count.** When the index cannot be read, a child-only delta counts as lost.
  An outage is already reported, and hiding real losses was the bug.
- **Calls use the existing `mokei.context.trace_id` attribute**, not every cross-trace link, so
  only calls into a context are indexed.
