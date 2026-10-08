# Unified traces: flows and MCP calls in one span model

Status: design approved in brainstorming; restructured after review round 3 (single local writer), round 4 fixes applied, pending user spec review
Branch: `feat/unified-traces`
Related: `docs/agents/plans/next/2026-10-04-flow-monitor-follow-ons.md` (monitor UI design pass), `docs/agents/architecture.md` (flow tracing, `runs.trace`, monitor presence)

## Goal

One trace model for flow runs, flow steps and MCP traffic, delivered live to the monitor and persisted for debugging and history. The monitor is rebuilt around a single Traces page.

Priorities, in order:

1. **Live observation** -- see flows, contexts and MCP calls as they happen, including in-flight calls.
2. **Debugging** -- drill into one trace: parent/child chain, timings, errors, request/response payloads.
3. **History** -- browse and filter past traces.

## Current state

- Flows already produce OpenTelemetry spans: `flow.run` / `flow.run.resume` from `flow-host/src/tracing.ts`, `decision.predict` from `decision-flow`. A `BatchSpanProcessor` exports them into the hozon telemetry store; LogTape traced logs go to the hozon log store through a sink. Both are read per run through `runs.trace`, which the monitor polls every 2 s and the CLI uses for `mokei runs trace`.
- MCP traffic shown in the monitor comes from the daemon's `spawn` procedure (`host-node/src/daemon-server.ts`), a raw stream proxy: the MCP client runs in another process (CLI, desktop host) and the daemon forwards JSON-RPC messages to a spawned stdio server, dispatching `context:start | context:stop | context:message` events. These are live-only, never persisted, unpaired and carry no span IDs. `context:message` carries the full raw message. The monitor shows them in a flat table on `/`.
- In-process clients (the flow host's `ContextClient`, embedded hosts) inject W3C `traceparent` / `tracestate` / `baggage` into request `_meta` (SEP-414) via `currentTraceMeta()`, but no span is recorded around requests, so flow and MCP data never join.
- The hozon `TelemetryStore` supports `getSpans(traceID)` only; there is no way to list traces. Only ended spans are stored, after a batch delay. The OTel `BatchSpanProcessor` drops spans on queue overflow and does not retry failed exports.
- The monitor opens three overlapping `events` subscriptions (two in `FlowProvider`, one in `useHostEvents`).

## Scope

In scope:

- Spans for MCP request/response pairs, both directions, from two producers: in-process `ContextClient`s and the daemon's `spawn` proxy.
- A lifetime span per context.
- A single local trace recorder that owns local persistence of spans, logs and trace summaries, and live delivery.
- A persisted trace index for listing and filtering.
- Redaction for every observation sink, including the existing `context:message` events.
- Monitor rebuild: one host-level connection, Traces page replacing the `/` events table and the Runs pages.

Out of scope (follow-ons):

- `Session` / `AgentSession` spans (`llm.chat`, `agent.turn`). The naming and `mokei.kind` attribute leave room for them.
- Ingesting spans from other processes (a local OTLP receiver). Remote parents are recorded as links.
- A reverse-link index (`trace_links`): listing, on a context trace, the calls made from flows into that context. Forward links (call to context) are kept.
- Newest-first, span-filtered log paging: needs a `@hozon/store-log` query, requested upstream.
- Removing `context:message` events from the wire.
- Backfilling the index for traces recorded before upgrade.

## Design

### 1. Span model

All spans are OpenTelemetry spans. A `mokei.kind` attribute drives UI icons and filters.

| Span name | `mokei.kind` | Producer | Parent |
|---|---|---|---|
| `mcp.context` | `context` | `ContextHost` (`@mokei/host`) for hosted contexts; the daemon `spawn` handler for proxied contexts | Root of a new trace |
| `mcp.<method>` (e.g. `mcp.tools/call`) | `mcp` | `ContextClient` (in-process) or the `spawn` proxy (proxied) | See "Parenting" |
| `flow.run` / `flow.run.resume` | `flow` | `flow-host/src/tracing.ts` (unchanged apart from attributes) | Root / previous run span (unchanged) |
| `decision.predict`, other step spans | `step` | Existing step nodes | The run span |

**Root segments.** A span is a root segment when it has no parent, or when it is a `flow.run.resume` span (parented to the previous run span, continuing its trace). Producers mark root segments with `mokei.root = true`; the recorder relies only on that attribute.

**Parenting.**

- In-process outgoing request: the active span if there is one (for example a tool call issued inside `withRun`), otherwise the client's bound `mcp.context` span. When the parent is not the context span, the request span carries a link to the context span.
- In-process incoming request (server-to-client: elicitation, sampling, roots): parent is the bound `mcp.context` span; a `_meta.traceparent` on the request becomes a link.
- Proxied request, either direction: parent is the proxied context's `mcp.context` span; a `_meta.traceparent` on the request becomes a link (the remote span is not ingested locally).

**Context binding (in-process).** `ContextHost` gives each hosted context's `ContextClient` a tracing binding at creation: `{ contextID, contextSpan, payloads }`. Clients created by callers and registered through `registerHostedContext` get the same binding at registration. A client without a binding (standalone use) produces request spans parented only to the active span, with no context link.

**Instrumentation seam (in-process).** Spans are created at one exchange seam in `ContextClient` covering:

- every outgoing request: `request()`, the setup/initialize exchange, subscription exchanges, and each MRTR retry leg (one span per leg, retry legs linked to the first);
- every incoming request dispatched through `_handleRequest`, settled on response, error or cancellation.

For outgoing requests the span is made active before `currentTraceMeta()` runs, so the propagated `traceparent` points at it. The base RPC exposes the allocated JSON-RPC ID to the seam so `jsonrpc.request.id` is set.

**Proxy correlation.** The `spawn` handler already taps both directions. A per-context correlator keyed by `(direction, typeof id, id)` opens a span when a request passes and ends it on the matching response; both peers allocate IDs independently, hence the direction in the key. A `notifications/cancelled` for an open request ends its span with `ERROR` and `error.type = "cancelled"`; a late response for an already-settled key is ignored. Requests still open when the context ends are settled per §6.

**Shared helper.** Both producers, and the sanitised `context:message` events, use one module that maps a JSON-RPC message to span name, attributes, status and payload records, and applies redaction and the capture cap (§2).

**MCP request span attributes** (OTel MCP semantic conventions where they exist):

- `mcp.method.name`, `gen_ai.tool.name` (tools), `mcp.session.id`, `jsonrpc.request.id`
- `mokei.context.id`, `mokei.kind = "mcp"`, `mokei.direction = "client" | "server"` (which peer sent the request)
- `mokei.mcp.request`: the serialised, redacted request params, set at span start so in-flight calls show their arguments live.
- On a JSON-RPC error or a tool result with `isError: true`: status `ERROR`, `error.type` set (JSON-RPC error code or `tool_error`).

**Response payload** is one `mcp.response` span event with a `payload` attribute.

**Notifications** (either direction) are traced log records, not span events: category `['mokei', 'mcp', 'notification']`, `traceID` / `spanID` of the `mcp.context` span, properties `{ method, direction, payload? }`.

**Context span attributes:** `mokei.context.id`, `mokei.kind = "context"`, `mokei.root = true`, server name or command, transport, and `mcp.session.id` once known.

### 2. Payload capture and redaction

- Setting: `tracing.payloads: 'on' | 'off' | number` (byte cap) in the existing `tracing` section of `@mokei/app-node` config (schema updated). `'on'`, the default, means a cap of 65536 bytes. `ContextHost` accepts the same option for non-daemon hosts and passes it in the client binding; the daemon passes it to `ContextHost` and to the `spawn` proxy.
- Payloads longer than the cap are cut, and the attribute, event or log gets `mokei.payload.truncated = true`. `'off'` records no payloads.
- **Redaction always applies before any observation sink**: the local store, live events, the OTLP exporter, and `context:message` events.
  - `_meta` keys other than `traceparent` and `dev.mokei/flow-run` are dropped. This removes authorization grants added by `flow-host/src/launch.ts`, and `baggage` / `tracestate`, which are opaque strings that key-based redaction cannot inspect.
  - Object keys matching `/authorization|token|secret|password|api[-_]?key|cookie|credential/i` at any depth have their value replaced with `"[redacted]"`.
- **`context:message` events** keep their envelope (`{ from, message }`), but `message` is the sanitised observation copy: redacted, cut to the cap, and reduced to `{ jsonrpc, id, method }` when capture is `'off'`. The forwarded MCP traffic itself is never modified.
- When no OTel SDK is registered, spans are no-ops and payloads are never serialised.

### 3. Local trace recorder

`LocalTraceRecorder`, in `@mokei/app-node`, is the single owner of local trace persistence and live trace delivery. It replaces the hozon `BatchSpanProcessor` exporter and the hozon log-store sink in `setupMokeiTelemetry`. The OTLP exporter, when configured, keeps its own `BatchSpanProcessor`.

It is both an OTel `SpanProcessor` and a LogTape sink:

- `onStart(span)`: add to the in-memory **open map**; for a root segment, create or reactivate the trace's in-memory summary; emit `span:start` and, when the summary changed, `trace:summary`.
- `onEnd(span)`: move from the open map to the **write queue** as a `StoredSpan`; update the summary (counts, and `active` / `outcome` for root segments); emit `span:end` and `trace:summary`.
- Log sink (traced records only, same filters as today): assign a `logID`, append to the write queue, emit `log`.

**Write queue.** Bounded (default 10000 entries). A flush runs every 250 ms or at 200 entries. One flush writes, in a single `provider.withTransaction`, the queued spans, the queued logs and the changed summaries. Entries leave the queue only when that transaction commits.

- Write failure: the batch stays queued and is retried with backoff (250 ms, 1 s, 4 s). After the third failure the batch is dropped, the error goes to the `errors` sink, and each affected trace's summary gets `droppedCount` incremented (persisted with the next successful flush).
- Overflow: the oldest queued spans and logs are dropped and counted the same way.
- Dirty summaries (changed since the last successful flush) are capped (default 1000). At the cap, the oldest dirty summary of an inactive trace is dropped and a process-level `lostSummaryCount` is incremented. That counter is exposed in the daemon `info` response (`tracing: { lostSummaryCount, droppedCount }`) and logged to the `errors` sink, so loss is reported outside the recorder's own storage. Summaries of active traces are not dropped; they are bounded by the open map.
- OTel `onStart` / `onEnd` and the LogTape sink are synchronous: they only enqueue. Nothing waits in memory for an external acknowledgement, so memory is bounded by the open map, the write queue and the dirty-summary cap.

**Summaries (trace index).** A new hozon store `traces`, defined in `@mokei/app-node` and registered in `mokeiStoreDefinitions` so `openMokeiDatabase` migrates it before telemetry starts. One row per trace:

`{ traceID, rootSpanID, activeSegmentSpanID?, kind, name, active, outcome: 'ok' | 'error' | 'interrupted' | null, startTime, endTime?, attributes: { 'run.id'?, 'flow.id'?, 'mokei.context.id'?, label? }, spanCount, errorCount, droppedCount, revision }`

- `rootSpanID` is the first root segment and never changes; `activeSegmentSpanID` is the open root segment while `active`.
- `active` is true while a root segment is open. `outcome` is null while active, then set from the root segment's status. `spanCount` counts ended spans; `errorCount` counts ended spans with `ERROR` status. A running trace with failed children is `active: true, errorCount > 0`.
- `revision` increases on every change and continues from the persisted value: when a root segment starts for a trace that already has a row (a resumed run), the recorder loads that row and keeps its `rootSpanID`, counts and `revision` before applying the change. The startup sweep increments the revision of every row it marks interrupted. Live events from before a crash may carry revisions the persisted row never reached; the monitor discards all trace state on a new connection epoch (§7), so such revisions are never compared with post-restart ones.
- Flow run state (approval, input required, cancelled, denied) is not mirrored; the monitor reads it from `runs.get` and run events.
- The recorder keeps in-memory summaries for active traces and for traces changed since the last flush.

**Reads.** `recorder.snapshot(traceID?)` returns the open spans, queued spans and logs, and in-memory summaries. Every read takes the snapshot **before** reading the database, then merges: deduplicate by `spanID` / `logID` (an ended span beats an open one), and keep the higher `revision` per summary. An entry committed between the snapshot and the database read appears in both and is deduplicated; an entry not yet committed is in the snapshot. No read can miss a span or log the recorder has seen.

**Lifecycle.** `dispose()` flushes the queue (bounded by the existing export timeout) before the database closes. On startup, before flow recovery runs, the recorder sets every persisted `active` row to `active: false, outcome: 'interrupted'`. Recovery then resumes active runs; their `flow.run.resume` root segments reactivate the row.

**Existing history.** Pre-upgrade traces have no summary rows and are not listed. They stay readable by `traceID` (`/runs/$runID`, `traces.get`), and `traces.get` synthesises a summary from the spans when no row exists.

**Retention.** Pruning (`prune-runs.ts`) keeps traces referenced by retained runs, as today, plus every trace whose summary is `active`. Both deletion paths delete spans, logs and summary rows in one transaction. Pruned traces are inactive, so the recorder does not write to them again.

### 4. Protocol (`@mokei/host-protocol`)

- The `events` stream gains `span:start`, `span:end`, `log` and `trace:summary`, using `ServiceEventMeta { eventID, time }` (no `contextID`).
- `traces.list({ kind?, active?, outcome?, name?, since?, until?, limit, cursor? })` returns `{ traces: Array<TraceSummary>, cursor? }`, newest first, merged with in-memory summaries.
- `traces.get({ traceID })` returns `{ summary: TraceSummary, spans: Array<StoredSpan | OpenSpan>, logs: Array<TraceLog>, logsTruncated: boolean }`. `OpenSpan` has no `endTime` / `status`. `TraceLog` is `StoredLog` plus `logID`. Logs are capped at the newest 1000; `logsTruncated` is set when more exist. (Until the upstream `@hozon/store-log` query exists, the daemon loads all trace logs and caps the response.)
- `runs.trace` stays as a deprecated adapter with its current response shape, so the CLI's `mokei runs trace` and older monitors keep working: ended spans only, logs projected to the legacy `StoredLog` fields.
- `context:message` events keep their shape with the sanitised `message` (§2).

### 5. Live delivery bounds

- The daemon `events` handler gets a hard per-subscriber bound covering all event types (default 2000 queued events) and respects the writer's `desiredSize`. When the bound is reached, the daemon ends that subscriber's stream. The client reconnects (new `epoch`) and reconciles fully. No event type is silently dropped from a live stream.
- Live payloads obey the same redaction and cap as storage.

### 6. Lifecycle and error handling

- **Termination reasons.** `ContextHost.remove(key, reason?)` and the client binding gain a termination reason, `'stopped' | 'lost'`. Transport closure detected by the RPC layer, a child process exiting on its own, and transport errors map to `'lost'`; an explicit `remove` maps to `'stopped'`. Context and request spans are settled exactly once: on `'lost'`, open request spans and the `mcp.context` span end with `ERROR` and `error.type = "context.lost"`; on `'stopped'`, open request spans end with `error.type = "context.stopped"` and the context span ends `OK`. The `spawn` proxy follows the same rules (child exit without a client abort is `'lost'`).
- **Daemon shutdown** is graceful: contexts stopped (`'stopped'`), recorder flushed.
- **Daemon crash:** the startup sweep (§3) marks interrupted traces; recovery reactivates resumed runs. A trace whose root segment was open at crash time has no stored root span; the monitor renders a placeholder root from its summary.
- **No subscribers:** live emission is a no-op; persistence is unaffected.

### 7. Monitor

**Connection.** One host-level connection owner (`HostConnectionProvider`) holds the single `events` subscription and the `epoch`, and dispatches events by type to the flow layer (`run:state`, `inbox:*`, `service:status`) and the trace layer (`span:*`, `log`, `trace:summary`). It replaces the subscriptions in `FlowProvider` and `useHostEvents`; `FlowProvider` consumes events from it. Subscribe-before-query buffering lives in the connection owner, so each consumer applies buffered events after its initial read.

**Routes.** `/traces` and `/traces/$traceID` (optional `?span=$spanID`). `/` redirects to `/traces`. `/runs` redirects to `/traces?kind=flow`; `/runs/$runID` resolves the run's `traceID` and redirects to `/traces/$traceID` (to `/traces?kind=flow` when the run has no trace). Nav: Traces, Flows, Inbox.

**Layout.** Two panes.

- **Trace list** (left): filters for kind, active/outcome, name and time range. An "Active" group pinned at the top, then "Recent" with cursor paging. Each row: kind icon, name, duration (live while active), span count, error count, a dropped marker when `droppedCount > 0`.
- **Trace detail** (right):
  - Header for a `flow` root: run state badge (from `runs.get` and `run:state` events), flow ID, run ID, link to pending inbox items, Cancel action. This absorbs the current run detail page.
  - Header for a `context` root: server name or command, transport, uptime.
  - Tabs: **Waterfall** and **Logs**. In-flight spans render as open bars that grow live. Spans with a link to a context show a "context ↗" link to that context's trace. Notifications appear in Logs. A banner shows when `logsTruncated`.
  - **Span detail** below the waterfall, tabs: Overview (attributes), Request, Response (JSON viewer, truncation banner when `mokei.payload.truncated`), Events, Logs (filtered by span, client-side).

**Data.**

- **List:** `traces.list` plus `trace:summary` events, merged by `traceID` keeping the higher `revision`. Summaries are the only live state kept for unselected traces.
- **Selected trace:** `traces.get`, plus `span:*` and `log` events for that `traceID` only. Merge rules: an ended span replaces an open one, and an open span never replaces an ended one; logs merge by `logID`. Changing selection discards the previous trace's live state.
- **Reconnect** (`epoch` change, including a disconnect from the subscriber bound and a daemon restart): discard all trace state (summaries, selected-trace spans and logs, revision baselines), then re-read the list and the selected trace. Query results and buffered events are tagged with the epoch they belong to; results from a previous epoch are ignored.
- Orphan spans (parent not yet known) render under a placeholder parent row until the parent arrives.
- Removed: `useRunTrace` and its polling, the `/` events table, `useHostEvents`, the Runs routes.
- `TraceWaterfall` and `LogList` are reused and extended (live bars, context links, span selection via URL, `logID` keys).

## Testing

- Shared MCP helper: attribute mapping per method, error mapping, redaction (`_meta` allow-list, secret-pattern keys at depth), capture modes, truncation flag, sanitised `context:message` copy.
- `@mokei/context-client`, with an in-memory span exporter: one span per exchange through the seam (request, setup, subscriptions, each MRTR retry leg with links, incoming requests settled on response / error / cancel), active span set before `traceparent` injection, `jsonrpc.request.id` set, parenting (active span vs bound context span, link to context span), unbound client behaviour.
- `@mokei/host`: context span lifecycle for hosted and registered contexts; `stopped` vs `lost` settle spans exactly once.
- `@mokei/host-node` `spawn` proxy: correlation keyed by direction, cancellation settles spans, late responses ignored, remote `traceparent` link, open requests settled on stop and on child exit; `context:message` events sanitised while forwarded traffic is byte-identical.
- `@mokei/app-node` `LocalTraceRecorder`: emit order; one transaction per flush; retry then drop with `droppedCount`; overflow drops oldest and counts; dirty-summary cap drops the oldest inactive summary and increments `lostSummaryCount` (reported in `info`); resumed root segments continue the persisted revision and counts; startup sweep increments revisions; snapshot-before-read returns entries committed mid-read exactly once; root segments and resume reactivation; startup sweep; flush on dispose; config schema accepts `tracing.payloads`.
- Daemon: `traces.list` filters, paging and in-memory merge; `traces.get` with open spans, synthesised summaries for un-indexed traces, log cap; `runs.trace` adapter returns the legacy shape; pruning keeps active traces and deletes summary rows atomically; subscriber over the bound is disconnected.
- End to end: a flow run that calls a tool produces one trace with `flow.run` above `mcp.tools/call`, linked to the context's trace; a proxied context produces a context trace with paired request spans; crash-restart marks an active run's trace interrupted, then recovery reactivates it.
- Monitor: vitest for summary merge by revision, epoch change discarding all trace state and ignoring previous-epoch query results, selected-trace merge (ended beats open, logs by `logID`, orphans, selection change), connection-owner dispatch and subscribe-before-query buffering, redirects; browser QA of the Traces page against a running daemon (live flow run, live proxied tool call, history filters, reconnect).

## Delivery

One branch, three stages. Each stage builds, passes tests and keeps existing consumers working.

1. **Producers** -- shared MCP helper with redaction and capture; `ContextClient` exchange seam (outgoing and incoming) and tracing binding; context spans and termination reasons in `@mokei/host`; `spawn` proxy correlation and sanitised `context:message`; `mokei.kind` / `mokei.root` on flow and step spans.
2. **Daemon** -- `traces` store and `LocalTraceRecorder` in `@mokei/app-node` replacing the local batch exporter and log sink; `tracing.payloads` config; `span:*`, `log`, `trace:summary` events with the per-subscriber bound; `traces.list` / `traces.get`; `runs.trace` adapter; startup sweep before recovery; pruning changes. The current monitor keeps working on `runs.trace` and `context:message`.
3. **Monitor** -- `HostConnectionProvider`, Traces page, redirects, removal of the `/` events table and the Runs pages.

Release: one patch changeset on the 0.14.x line. No public procedure is removed (`runs.trace` is kept as a deprecated adapter).

## Docs to update

- `docs/agents/architecture.md`: trace model, the two MCP span producers, redaction, `LocalTraceRecorder` (local persistence and live delivery), trace index, `traces.*` methods, `runs.trace` deprecation.
- `docs/agents/plans/next/2026-10-04-flow-monitor-follow-ons.md`: mark the Runs part of the monitor design pass as covered by this spec; Inbox and Flows pages unchanged.
- `docs/agents/plans/backlog/`: the reverse-link index and Session/Agent spans as follow-ons.
