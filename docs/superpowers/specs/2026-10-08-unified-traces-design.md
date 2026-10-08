# Unified traces: flows and MCP calls in one span model

Status: design approved in brainstorming, pending spec review
Branch: `feat/unified-traces`
Related: `docs/agents/plans/next/2026-10-04-flow-monitor-follow-ons.md` (monitor UI design pass), `docs/agents/architecture.md` (flow tracing, `runs.trace`, monitor presence)

## Goal

One trace model for flow runs, flow steps and MCP traffic, delivered live to the monitor and persisted for debugging and history. The monitor is rebuilt around a single Traces page.

Priorities, in order:

1. **Live observation** -- see flows, contexts and MCP calls as they happen, including in-flight calls.
2. **Debugging** -- drill into one trace: parent/child chain, timings, errors, request/response payloads.
3. **History** -- browse and filter past traces.

## Current state

- Flows already produce OpenTelemetry spans: `flow.run` / `flow.run.resume` from `flow-host/src/tracing.ts`, `decision.predict` from `decision-flow`. They are batch-exported into the hozon telemetry store and read per run through `runs.trace`, which the monitor polls every 2 s.
- MCP traffic exists only as `context:start | context:stop | context:message` host events keyed by `contextID`, emitted by the daemon for contexts it spawns. They are live-only, never persisted, unpaired (no request/response correlation, no durations) and carry no span IDs. The monitor shows them in a flat table on `/`.
- `ContextClient` already injects W3C `traceparent` / `tracestate` / `baggage` into request `_meta` (SEP-414) via `currentTraceMeta()`, but no span is recorded around the request, so flow and MCP data never join.
- The hozon `TelemetryStore` supports `getSpans(traceID)` only. There is no way to list traces.

## Scope

In scope:

- Spans for every MCP request/response pair made through `ContextClient`, and a lifetime span per context.
- Live span and log delivery over the existing host `events` stream.
- A persisted trace index for listing and filtering.
- Monitor rebuild: Traces page replacing the `/` events table and the Runs pages.

Out of scope (follow-ons):

- `Session` / `AgentSession` spans (`llm.chat`, `agent.turn`). The naming and `mokei.kind` attribute leave room for them.
- Ingesting server-side spans from sibling MCP server processes (local OTLP receiver).
- Removing `context:message` events from the wire (the monitor stops consuming them; removal comes later).

## Design

### 1. Span model

All spans are OpenTelemetry spans. A new `mokei.kind` attribute drives UI icons and filters.

| Span name | `mokei.kind` | Opened by | Parent |
|---|---|---|---|
| `mcp.context` | `context` | `ContextHost` (`@mokei/host`) on context start, ended on stop | Root of a new trace |
| `mcp.<method>` (e.g. `mcp.tools/call`) | `mcp` | `ContextClient` around each outgoing request | Active span if any, otherwise the owning context's `mcp.context` span |
| `flow.run` / `flow.run.resume` | `flow` | `flow-host/src/tracing.ts` (unchanged apart from the attribute) | Root, link to caller (unchanged) |
| `decision.predict`, other step spans | `step` | Existing step nodes | The run span |

**Trace membership.** Each context gets its own trace. A request made while another span is active (for example a tool call issued by a flow run) joins that span's trace and carries a link to the context's `mcp.context` span, so it stays reachable from the context side.

**MCP request span attributes** (OTel MCP semantic conventions where they exist):

- `mcp.method.name`, `gen_ai.tool.name` (tools), `mcp.session.id`, `jsonrpc.request.id`
- `mokei.context.id`, `mokei.kind = "mcp"`
- `mokei.mcp.request`: the serialised request params, set at span start so in-flight calls show their arguments live. Subject to payload capture (below).
- On a JSON-RPC error or a tool result with `isError: true`: span status `ERROR`, `error.type` set (JSON-RPC error code or `tool_error`).

**Response payload** is recorded as an `mcp.response` span event with a `payload` attribute, subject to payload capture.

**Notifications** (either direction) are recorded as `mcp.notification` events on the `mcp.context` span, with `mcp.method.name` and `direction` (`client` / `server`) attributes. Payloads follow the capture setting.

**Context span attributes:** `mokei.context.id`, `mokei.kind = "context"`, server name, transport, and the `mcp.session.id` once known.

**Payload capture.** `ContextHost` accepts `tracing.payloads: 'on' | 'off' | number` (byte cap). `'on'` means the default cap of 65536 bytes. Payloads longer than the cap are cut, and the attribute or event gets `mokei.payload.truncated = true`. `'off'` records no payloads, so spans keep only metadata. The daemon exposes this as its `telemetry.payloads` config, default `'on'`. When no OTel SDK is registered, spans are no-ops and payloads are never serialised.

### 2. Persistence

Spans keep flowing through the existing `BatchSpanProcessor` into the hozon telemetry store, and logs into the hozon log store.

Two new daemon-owned hozon tables:

- **`traces`** -- one row per root trace:
  `{ traceID, rootSpanID, kind, name, status: 'running' | 'ok' | 'error', startTime, endTime?, attributes: { 'run.id'?, 'flow.id'?, 'mokei.context.id'?, label? }, spanCount, errorCount }`.
  Written when a root span starts; updated as spans end (counts, status) and when the root ends (`endTime`, final status). This is what `traces.list` queries, and it makes long-lived running traces (contexts) visible before their root span is exported.
- **`trace_links`** -- `{ targetTraceID, targetSpanID, traceID, spanID }`, written when a span carrying links ends. Lets a context trace list the calls made from flows that link to it.

Retention: the existing trace pruning (`deleteBefore` with `keepTraceIDs`) also prunes `traces` and `trace_links` rows. Running traces and traces with an open inbox item are kept, as today.

### 3. Live pipeline

A `LiveSpanProcessor` (OTel `SpanProcessor`) is registered in `setupMokeiTelemetry` (`@mokei/app-node`) alongside the hozon batch processor:

- `onStart`: emit `span:start` with `{ traceID, spanID, parentSpanID?, name, startTime, attributes, links }`. When the span is a root, insert the `traces` row.
- `onEnd`: emit `span:end` with the full `StoredSpan`. Update the `traces` row; write `trace_links` rows for links.

Traced log records (those with a `traceID`) are also emitted live as `log` events with the `StoredLog` shape.

The processor never throws into the OTel pipeline: emit failures are dropped (and logged at debug level). Index writes are serialised per trace to keep counts consistent.

### 4. Protocol (`@mokei/host-protocol`)

- `events` stream gains `span:start`, `span:end` and `log` events, using `ServiceEventMeta { eventID, time }` (no `contextID`).
- `traces.list({ kind?, status?, name?, since?, until?, limit, cursor? })` returns `{ traces: Array<TraceSummary>, cursor? }`, newest first, running traces included.
- `traces.get({ traceID })` returns `{ summary: TraceSummary, spans: Array<StoredSpan>, logs: Array<StoredLog>, linkedSpans: Array<{ traceID, spanID, name, startTime, endTime }> }`. `linkedSpans` comes from `trace_links` when the trace is a context trace.
- `runs.trace` is removed. The monitor is its only consumer, and `FlowRunSnapshot.traceID` already points at the run's trace.
- `context:message` events stay on the wire, unchanged.

### 5. Monitor

**Routes.** `/traces` and `/traces/$traceID` (optional `?span=$spanID`). `/` redirects to `/traces`. `/runs` redirects to `/traces?kind=flow`; `/runs/$runID` resolves the run's `traceID` and redirects to `/traces/$traceID` (to `/traces?kind=flow` when the run has no trace). Nav: Traces, Flows, Inbox.

**Layout.** Two panes.

- **Trace list** (left): filters for kind, status, name and time range. A "Running" group pinned at the top, then "Recent" with cursor paging. Each row shows kind icon, name, duration (live for running), span count and error count.
- **Trace detail** (right):
  - Header for a `flow` root: run state badge, flow ID, run ID, link to pending inbox items, Cancel action. This absorbs the current run detail page.
  - Header for a `context` root: server name, transport, uptime, enabled tool count.
  - Tabs: **Waterfall** and **Logs**. In-flight spans render as open bars that grow live. For context traces, linked calls made from flows are listed as rows that navigate to the flow trace.
  - **Span detail** below the waterfall, tabs: Overview (attributes), Request, Response (JSON viewer, truncation banner when `mokei.payload.truncated`), Events, Logs (filtered by span).

**Data layer.**

- A live trace store (Jotai) holds `traceID -> { spans: Map<spanID, span>, logs }`, filled from `span:start` / `span:end` / `log` events. It retains running traces and the selected trace; ended, unselected traces are evicted from the live store once they appear in the stored list.
- The list is `traces.list` (through `useReconciledQuery`) merged with live root `span:start` events.
- The selected trace is `traces.get` merged with live spans by `spanID`. Merge rules: an ended span replaces an open one; stored data replaces live data for the same span.
- On reconnect (`epoch` change) the list and the selected trace are re-read, covering batch-export lag and missed events.
- Orphan spans (parent not yet known) render under a placeholder parent row until the parent arrives.
- `useRunTrace` and its 2 s polling are removed. The `/` events table, `useHostEvents` and the Runs routes are removed.
- `TraceWaterfall` and `LogList` are reused and extended (live bars, linked rows, span selection via URL).

### 6. Error handling and lifecycle

- **Context ends abnormally** (crash, transport error, daemon shutdown without `context:stop`): `ContextHost` ends any open `mcp.context` span with status `ERROR` and `error.type = "context.lost"`. Open request spans for that context end with `ERROR` and `error.type = "context.lost"`.
- **Daemon restart:** on startup, `traces` rows left `running` by a previous process are set to `status: 'error'` with attribute `mokei.interrupted = true`.
- **Live/stored races:** handled by the monitor merge rules and orphan placeholders; reconnect re-reads close gaps.
- **No subscribers / closed stream:** `LiveSpanProcessor` drops events silently; persistence is unaffected.
- **Backpressure:** live events use the existing `events` SSE stream and its existing backpressure behaviour; no new buffering.

## Testing

- `@mokei/context-client`: unit tests with an in-memory span exporter -- span names and attributes per method, parenting (active span vs context span), link to the context span, error status for JSON-RPC errors and `isError` results, payload capture modes (`on`, `off`, byte cap) and truncation flag.
- `@mokei/host`: context span lifecycle, including abnormal end (`context.lost`).
- `@mokei/app-node`: `LiveSpanProcessor` emit order and payloads, no throw on emit failure.
- Daemon (`@mokei/host-node` / `@mokei/flow-host-node`): trace index written on root start, updated on end, interrupted on restart; `trace_links` rows; `traces.list` filters and paging; `traces.get` including `linkedSpans`; pruning covers the new tables.
- End to end: a flow run that calls a tool produces one trace with `flow.run` above `mcp.tools/call`, and the context trace's `linkedSpans` includes that call.
- Monitor: vitest for the live/stored merge reducer (ended beats open, stored beats live, orphans, eviction) and the redirect logic; browser QA of the Traces page against a running daemon (live flow run, live tool call, history filters, reconnect).

## Delivery

One branch, three stages. Each stage builds, passes tests and is usable on its own.

1. **Producers** -- MCP request spans in `@mokei/context-client`, context spans in `@mokei/host`, payload capture option, `mokei.kind` on flow and step spans.
2. **Daemon** -- `LiveSpanProcessor`, `traces` and `trace_links` tables, `span:start` / `span:end` / `log` events, `traces.list` / `traces.get`, `telemetry.payloads` config, removal of `runs.trace`, startup interruption sweep, pruning.
3. **Monitor** -- Traces page, live trace store, redirects, removal of the `/` events table and the Runs pages.

Release: one patch changeset on the 0.14.x line covering the published packages touched.

## Docs to update

- `docs/agents/architecture.md`: trace model, MCP spans, live span events, trace index, `traces.*` methods replacing `runs.trace`.
- `docs/agents/plans/next/2026-10-04-flow-monitor-follow-ons.md`: mark the monitor design pass as covered by this spec for Runs; Inbox and Flows pages unchanged.
