# Unified traces: flows and MCP calls in one span model

Status: design approved in brainstorming; revised after two review rounds, pending user spec review
Branch: `feat/unified-traces`
Related: `docs/agents/plans/next/2026-10-04-flow-monitor-follow-ons.md` (monitor UI design pass), `docs/agents/architecture.md` (flow tracing, `runs.trace`, monitor presence)

## Goal

One trace model for flow runs, flow steps and MCP traffic, delivered live to the monitor and persisted for debugging and history. The monitor is rebuilt around a single Traces page.

Priorities, in order:

1. **Live observation** -- see flows, contexts and MCP calls as they happen, including in-flight calls.
2. **Debugging** -- drill into one trace: parent/child chain, timings, errors, request/response payloads.
3. **History** -- browse and filter past traces.

## Current state

- Flows already produce OpenTelemetry spans: `flow.run` / `flow.run.resume` from `flow-host/src/tracing.ts`, `decision.predict` from `decision-flow`. They are batch-exported into the hozon telemetry store and read per run through `runs.trace`, which the monitor polls every 2 s and the CLI uses for `mokei runs trace`.
- MCP traffic shown in the monitor comes from the daemon's `spawn` procedure (`host-node/src/daemon-server.ts`), which is a raw stream proxy: the MCP client runs in another process (CLI, desktop host) and the daemon forwards JSON-RPC messages to a spawned stdio server, dispatching `context:start | context:stop | context:message` events. These are live-only, never persisted, unpaired (no request/response correlation, no durations) and carry no span IDs. The monitor shows them in a flat table on `/`.
- In-process clients (the flow host's `ContextClient`, embedded hosts) inject W3C `traceparent` / `tracestate` / `baggage` into request `_meta` (SEP-414) via `currentTraceMeta()`, but no span is recorded around the request, so flow and MCP data never join.
- The hozon `TelemetryStore` supports `getSpans(traceID)` only. There is no way to list traces. Spans reach it through a `BatchSpanProcessor`, so only ended spans are stored, after a batch delay.

## Scope

In scope:

- Spans for MCP request/response pairs from two producers: in-process `ContextClient`s and the daemon's `spawn` proxy.
- A lifetime span per context.
- Live span and log delivery over the existing host `events` stream, with an in-memory registry of spans not yet persisted.
- A persisted trace index for listing and filtering.
- Monitor rebuild: Traces page replacing the `/` events table and the Runs pages.

Out of scope (follow-ons):

- `Session` / `AgentSession` spans (`llm.chat`, `agent.turn`). The naming and `mokei.kind` attribute leave room for them.
- Ingesting spans from other processes (a local OTLP receiver). Remote parents are recorded as links, not ingested.
- Removing `context:message` events from the wire (the monitor stops consuming them; removal comes later).

## Design

### 1. Span model

All spans are OpenTelemetry spans. A `mokei.kind` attribute drives UI icons and filters.

| Span name | `mokei.kind` | Producer | Parent |
|---|---|---|---|
| `mcp.context` | `context` | `ContextHost` (`@mokei/host`) for hosted contexts; the daemon `spawn` handler for proxied contexts | Root of a new trace |
| `mcp.<method>` (e.g. `mcp.tools/call`) | `mcp` | `ContextClient` (in-process) or the `spawn` proxy (proxied) | See "Parenting" |
| `flow.run` / `flow.run.resume` | `flow` | `flow-host/src/tracing.ts` (unchanged apart from the attribute) | Root, link to caller (unchanged) |
| `decision.predict`, other step spans | `step` | Existing step nodes | The run span |

**Parenting.**

- In-process request: the active span if there is one (for example a tool call issued inside `withRun`), otherwise the client's bound `mcp.context` span. When the parent is not the context span, the request span carries a link to the context span so it stays reachable from the context side.
- Proxied request: always the proxied context's `mcp.context` span. When the request `_meta.traceparent` is present, the span carries a link to that remote span (not ingested locally, so a link rather than a parent avoids orphans).

**Context binding (in-process).** `ContextHost` gives each hosted context's `ContextClient` an explicit tracing binding at creation: `{ contextID, contextSpan, payloads }`. Clients created by callers and registered through `registerHostedContext` get the same binding at registration. A client without a binding (standalone use) produces request spans parented only to the active span, with no context link.

**Instrumentation seam (in-process).** Request spans are created at one shared exchange seam in `ContextClient` covering every outgoing request: `request()`, the setup/initialize exchange, subscription exchanges, and each retry leg of MRTR retries (one span per leg, the retry legs linked to the first). The request span is made active before `currentTraceMeta()` runs, so the propagated `traceparent` points at it. The base RPC exposes the allocated JSON-RPC ID to the seam so `jsonrpc.request.id` is set.

**Proxy correlation.** The `spawn` handler already taps both directions. A per-context correlator opens a span when a request passes and ends it on the matching response. Both peers allocate IDs independently, so the correlation key is `(direction, typeof id, id)`: client-to-server requests match server responses, and server-to-client requests (sampling, elicitation, `direction = "server"`) match client responses. A `notifications/cancelled` for an open request ends its span with `ERROR` and `error.type = "cancelled"`; a late response for an already-settled key is ignored. Requests still open when the context ends are settled per §6.

**Shared helper.** Both producers use one module that maps a JSON-RPC message to span name, attributes, status and payload records, so attribute naming, error mapping, redaction and capture rules are defined once.

**MCP request span attributes** (OTel MCP semantic conventions where they exist):

- `mcp.method.name`, `gen_ai.tool.name` (tools), `mcp.session.id`, `jsonrpc.request.id`
- `mokei.context.id`, `mokei.kind = "mcp"`, `mokei.direction = "client" | "server"`
- `mokei.mcp.request`: the serialised, redacted request params, set at span start so in-flight calls show their arguments live.
- On a JSON-RPC error or a tool result with `isError: true`: span status `ERROR`, `error.type` set (JSON-RPC error code or `tool_error`).

**Response payload** is recorded as a single `mcp.response` span event with a `payload` attribute (one event per span, well under the SDK event limit).

**Notifications** (either direction) are recorded as traced log records, not span events: category `['mokei', 'mcp', 'notification']`, `traceID` / `spanID` of the `mcp.context` span, properties `{ method, direction, payload? }`. Logs are streamed live and persisted independently of the long-lived context span, and are not subject to the span event limit.

**Context span attributes:** `mokei.context.id`, `mokei.kind = "context"`, server name or command, transport, and `mcp.session.id` once known.

### 2. Payload capture and redaction

- Setting: `tracing.payloads: 'on' | 'off' | number` (byte cap) in the daemon config, added to the existing `tracing` section of `@mokei/app-node` config (`additionalProperties: false` schema updated). `'on'` (the default) means a cap of 65536 bytes. `ContextHost` accepts the same option for non-daemon hosts and passes it in the client binding; the daemon passes it to both `ContextHost` and the `spawn` proxy.
- Payloads longer than the cap are cut, and the attribute or event gets `mokei.payload.truncated = true`. `'off'` records no payloads; spans keep metadata only.
- **Redaction always applies before any sink** (hozon store, live stream, OTLP exporter), in the shared helper:
  - `_meta` keys other than `traceparent` and `dev.mokei/flow-run` are dropped. This removes authorization grants added by `flow-host/src/launch.ts`, and also `baggage` and `tracestate`, which are opaque serialised strings that key-based redaction cannot inspect.
  - Object keys matching `/authorization|token|secret|password|api[-_]?key|cookie|credential/i` at any depth have their value replaced with `"[redacted]"`.
- When no OTel SDK is registered, spans are no-ops and payloads are never serialised.

### 3. Persistence

Spans keep flowing through the existing `BatchSpanProcessor` into the hozon telemetry store, and logs into the hozon log store.

Log records get a stable `logID` (assigned when the record is created, before live delivery) persisted with the record, so live and stored copies merge by identity.

Two new hozon stores, defined in `@mokei/app-node` next to the telemetry and log store definitions and registered in `mokeiStoreDefinitions` (so every database opened by `openMokeiDatabase` migrates them before telemetry starts):

- **`traces`** -- one row per trace:
  `{ traceID, rootSpanID, activeSegmentSpanID, kind, name, active: boolean, outcome: 'ok' | 'error' | 'interrupted' | null, startTime, endTime?, attributes: { 'run.id'?, 'flow.id'?, 'mokei.context.id'?, label? }, spanCount, errorCount }`.
  - `active` is whether the root span (or, for a resumed run, the latest root segment) is open. `outcome` is null while active, then set from the root's status when it ends. `spanCount` counts ended spans; `errorCount` counts ended spans with `ERROR` status. A running trace with failed children is `active: true, errorCount > 0`.
  - Flow run state (approval, input required, cancelled, denied) is not mirrored here; the monitor header reads it from `runs.get` and run events.
- **`trace_links`** -- `{ targetTraceID, targetSpanID, traceID, spanID }`, written when a span carrying links ends.

Both stores are accessed through an injected `TraceIndex` API (`upsertRoot`, `spanEnded`, `rootEnded`, `markInterrupted`, `list`, `links`, `deleteByTrace`, `deleteBefore`) created by `@mokei/app-node` and passed to `setupMokeiTelemetry` and to the flow trace store. Index writes are queued and serialised per trace; `setupMokeiTelemetry`'s `dispose()` drains the queue before the database closes.

**Root segments.** A span is a root segment when it has no parent, or when it is a `flow.run.resume` span (which is parented to the previous run span and continues its trace). Producers mark root segments with `mokei.root = true`, and the processor uses only that attribute, in both `onStart` and `onEnd`. `rootSpanID` is the first root segment's span ID and never changes; the row also keeps `activeSegmentSpanID`. A resume segment's start calls `upsertRoot`, which reactivates the existing row (`active: true`, `outcome: null`, `activeSegmentSpanID` updated) instead of inserting a new one; its end calls `rootEnded`.

**Existing history.** No backfill: the hozon telemetry store cannot enumerate traces, and pre-upgrade traces have no index rows. `traces.list` starts at upgrade. Pre-upgrade run traces stay reachable: `/runs/$runID` and `traces.get` read spans directly by `traceID`, and `traces.get` synthesises a summary from the spans when no index row exists.

**Retention.** Pruning (`prune-runs.ts`) keeps traces referenced by retained runs, as today, plus every trace whose index row is `active`. Both deletion paths (`deleteTraces` and `deleteBefore`) delete spans, logs, the `traces` rows and every `trace_links` row whose source or target trace is deleted, in one transaction.

### 4. Live pipeline

A `LiveSpanProcessor` (OTel `SpanProcessor`) is registered in `setupMokeiTelemetry` alongside the hozon batch processor:

- `onStart`: add the span to the **pending registry** and emit `span:start` with `{ traceID, spanID, parentSpanID?, name, startTime, attributes, links }`. Request payloads are set as start attributes, so they are present at `onStart`. For root spans, queue `upsertRoot`.
- `onEnd`: replace the registry entry with the ended `StoredSpan`, emit `span:end` with it, and queue `spanEnded` (and `rootEnded` for roots; links go to `trace_links`).

**Pending registry.** An in-memory map of spans that are open, or ended but not yet confirmed persisted. The hozon exporter is wrapped so that a successful export removes the exported spans from the registry. `traces.get` merges stored spans with the registry's entries for that trace, so a read during batch lag or for a long-lived open context is complete. On daemon shutdown the registry is discarded after the final flush.

Traced log records are emitted live as `log` events with the `StoredLog` shape plus `logID`. The log sink is wrapped the same way as the span exporter: each traced log is held in the pending registry by `logID` until the store write succeeds, and `traces.get` merges pending logs too.

The processor never throws into the OTel pipeline: emit failures are dropped (logged at debug level). Persistence is unaffected by live delivery.

### 5. Protocol (`@mokei/host-protocol`)

- The `events` stream gains `span:start`, `span:end` and `log` events, using `ServiceEventMeta { eventID, time }` (no `contextID`).
- `traces.list({ kind?, active?, outcome?, name?, since?, until?, limit, cursor? })` returns `{ traces: Array<TraceSummary>, cursor? }`, newest first.
- `traces.get({ traceID })` returns `{ summary: TraceSummary, spans: Array<StoredSpan | OpenSpan>, logs: Array<TraceLog>, logsCursor?, linkedSpans: Array<{ traceID, spanID, name, startTime, endTime? }> }`, where spans include pending-registry entries (`OpenSpan` has no `endTime`/`status`) and `TraceLog` is `StoredLog` plus `logID`. Logs are the newest 500 (stored plus pending); `logsCursor` is set when older logs exist. `linkedSpans` comes from `trace_links` for spans linking into this trace.
- `traces.logs({ traceID, spanID?, cursor?, limit })` pages older logs, newest first.
- `runs.trace` stays as a deprecated adapter with its current response shape, so the CLI's `mokei runs trace` and older monitors keep working. It reads stored data only: ended spans, and logs projected to the legacy `StoredLog` fields (no `logID`).
- `context:message` events stay on the wire, unchanged.

### 6. Lifecycle and error handling

- **Termination reasons.** `ContextHost.remove(key, reason?)` and the client binding gain an explicit termination reason (`'stopped' | 'lost'`). Transport closure detected by the RPC layer, a child process exiting on its own, and errors map to `'lost'`; an explicit `remove` maps to `'stopped'`. Context and request spans are settled exactly once per context: on `'lost'`, open request spans and the `mcp.context` span end with `ERROR` and `error.type = "context.lost"`; on `'stopped'`, open request spans end with `error.type = "context.stopped"` and the context span ends `OK`. The `spawn` proxy follows the same rules (child exit without a client abort is `'lost'`).
- **Daemon shutdown** is graceful: hosted and proxied contexts are stopped (`'stopped'`), spans flushed, index queue drained.
- **Daemon crash.** On startup, before flow recovery runs, `markInterrupted` sets every `active` index row to `active: false, outcome: 'interrupted'`. Flow recovery then resumes active runs; their `flow.run.resume` spans reactivate the row (§3). Traces whose root span was never exported (it was open at crash time) keep their index row as the summary, and the monitor renders a placeholder root from it.
- **Live/stored races** are handled by the pending registry (§4) and the monitor merge rules (§8).
- **No subscribers / closed stream:** `LiveSpanProcessor` drops events; persistence is unaffected.

### 7. Live delivery bounds

- The daemon `events` handler gets a hard per-subscriber bound covering all event types (default 2000 queued events). Writes respect the writer's `desiredSize`. When the bound is reached, the daemon ends that subscriber's stream instead of dropping individual events. The client sees a disconnect, reconnects (new `epoch`) and reconciles fully from `traces.list` / `traces.get` and the existing run and inbox reads. No event type is silently lost.
- Payload attributes on live events obey the same cap as storage.

### 8. Monitor

**Routes.** `/traces` and `/traces/$traceID` (optional `?span=$spanID`). `/` redirects to `/traces`. `/runs` redirects to `/traces?kind=flow`; `/runs/$runID` resolves the run's `traceID` and redirects to `/traces/$traceID` (to `/traces?kind=flow` when the run has no trace). Nav: Traces, Flows, Inbox.

**Layout.** Two panes.

- **Trace list** (left): filters for kind, active/outcome, name and time range. An "Active" group pinned at the top, then "Recent" with cursor paging. Each row shows kind icon, name, duration (live while active), span count and error count.
- **Trace detail** (right):
  - Header for a `flow` root: run state badge (from `runs.get` and `run:state` events), flow ID, run ID, link to pending inbox items, Cancel action. This absorbs the current run detail page.
  - Header for a `context` root: server name or command, transport, uptime.
  - Tabs: **Waterfall** and **Logs**. In-flight spans render as open bars that grow live. For context traces, `linkedSpans` are listed as rows that navigate to the linking trace. Notifications appear in Logs.
  - **Span detail** below the waterfall, tabs: Overview (attributes), Request, Response (JSON viewer, truncation banner when `mokei.payload.truncated`), Events, Logs (filtered by span).

**Data layer.**

- A host-level trace subscription, independent of the flow service: it subscribes to the `events` stream for `span:*` and `log` events and buffers them until the initial `traces.list` / `traces.get` reads resolve (subscribe before query), then applies them. It does not go through `useReconciledQuery` or the flow client's event filter, so it works when the flow service is unavailable.
- A live trace store (Jotai) holds `traceID -> { spans: Map<spanID, span>, logs: Map<logID, log> }`. It keeps active traces and the selected trace; for an ended trace that is not selected, entries are evicted once a later `traces.get` or list read returns the trace as inactive (the daemon's pending registry makes that read complete). Per-trace retention is capped (default 2000 spans and 1000 logs); past the cap the oldest ended spans and oldest logs are dropped from the live store and re-read on selection. The Logs tab shows the newest logs and loads older ones through `traces.logs`.
- Merge rules: an ended span replaces an open one; a stored or registry copy replaces a live copy of the same `spanID`; logs merge by `logID`.
- On reconnect (`epoch` change), including a disconnect caused by the subscriber bound, the list and the selected trace are re-read.
- Orphan spans (parent not yet known) render under a placeholder parent row until the parent arrives.
- `useRunTrace` and its 2 s polling are removed. The `/` events table, `useHostEvents` and the Runs routes are removed.
- `TraceWaterfall` and `LogList` are reused and extended (live bars, linked rows, span selection via URL, `logID` keys).

## Testing

- Shared MCP span helper: attribute mapping per method, error mapping, redaction (`_meta` grant keys, secret-pattern keys at depth), capture modes and truncation flag.
- `@mokei/context-client`: with an in-memory span exporter -- one span per exchange through the seam (request, setup, subscriptions, each MRTR retry leg with links), active span set before `traceparent` injection, `jsonrpc.request.id` set, parenting (active span vs bound context span, link to context span), unbound client behaviour.
- `@mokei/host`: context span lifecycle for hosted and registered contexts; termination reasons (`stopped` vs `lost`) settle spans exactly once.
- `@mokei/host-node` `spawn` proxy: request/response correlation by JSON-RPC ID in both directions, remote `traceparent` link, unanswered requests ended on stop and on child exit.
- `@mokei/app-node`: `LiveSpanProcessor` emit order, pending registry cleared only on successful export, no throw on emit failure; `TraceIndex` writes (upsert, resume reactivation, counts, interrupted sweep), queue drained on dispose; config schema accepts `tracing.payloads`.
- Daemon: `traces.list` filters and paging; `traces.get` merges pending spans and logs, synthesises a summary for un-indexed traces, caps logs with `logsCursor`; `traces.logs` paging; `linkedSpans`; `runs.trace` adapter returns only ended spans and legacy log fields; pruning keeps active traces and removes index and link rows atomically; a subscriber over the bound is disconnected, not fed partial events. Proxy correlation: direction-scoped IDs, cancellation settles spans, late responses ignored. Redaction drops `baggage` and `tracestate`. Resume segments marked `mokei.root` reactivate the index row.
- End to end: a flow run that calls a tool produces one trace with `flow.run` above `mcp.tools/call`, and the context trace's `linkedSpans` includes that call. A proxied context spawned through `spawn` produces a context trace with paired request spans. Crash-restart: an active run's trace is marked interrupted, then reactivated by recovery.
- Monitor: vitest for the merge reducer (ended beats open, stored beats live, logs by `logID`, orphans, eviction, retention cap), the subscribe-before-query buffer and the redirect logic; browser QA of the Traces page against a running daemon (live flow run, live proxied tool call, history filters, reconnect).

## Delivery

One branch, three stages. Each stage builds, passes tests and keeps existing consumers working.

1. **Producers** -- shared MCP span helper with redaction and capture; `ContextClient` exchange seam and tracing binding; context spans and termination reasons in `@mokei/host`; `spawn` proxy correlation; `mokei.kind` on flow and step spans; log `logID`.
2. **Daemon** -- `traces` / `trace_links` stores and `TraceIndex` in `@mokei/app-node`; `LiveSpanProcessor` and pending registry; `tracing.payloads` config; `span:*` and `log` events with a hard per-subscriber bound; `traces.list` / `traces.get` / `traces.logs`; `runs.trace` adapter; startup interruption sweep before recovery; pruning changes. The current monitor keeps working on `runs.trace` and `context:message`.
3. **Monitor** -- host-level trace subscription, live trace store, Traces page, redirects, removal of the `/` events table and the Runs pages.

Release: one patch changeset on the 0.14.x line. No public procedure is removed (`runs.trace` is kept as a deprecated adapter).

## Docs to update

- `docs/agents/architecture.md`: trace model, the two MCP span producers, redaction, live span events and pending registry, trace index, `traces.*` methods, `runs.trace` deprecation.
- `docs/agents/plans/next/2026-10-04-flow-monitor-follow-ons.md`: mark the Runs part of the monitor design pass as covered by this spec; Inbox and Flows pages unchanged.
