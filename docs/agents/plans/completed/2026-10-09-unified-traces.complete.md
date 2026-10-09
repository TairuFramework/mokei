# Unified traces

**Status:** complete
**Dates:** 2026-10-08 to 2026-10-09

## Goal

One OpenTelemetry trace model for flow runs, flow steps and MCP traffic, delivered live and persisted for debugging and history.
The monitor uses one Traces page for live observation, request and response inspection, and filtered history.

## Key decisions

- **One span model.** `mcp.context` records context lifetime, `mcp.<method>` records exchanges, and `flow.run` / `flow.run.resume` records run segments.
  Step spans, including `decision.predict`, remain children within the trace. `mokei.kind` drives icons and filters without coupling the monitor to producers.
- **Explicit root segments.** Only `mokei.root = true` creates an index summary, including resumed runs parented to an earlier segment.
  This excludes unrelated RPC handler roots from the list. Unindexed spans remain stored and readable by trace ID.
- **Two MCP producers.** `ContextClient` instruments outgoing, setup, subscription, retry and incoming exchanges. The daemon spawn proxy pairs requests and responses in both directions.
  Both use one observation helper, so naming, errors, redaction and capture agree. Proxy correlation distinguishes direction and numeric versus string request IDs.
- **Parents and links preserve causality.** In-process outgoing calls use the active span, otherwise the context span, with a context link when needed.
  Incoming and proxied calls belong to the context trace. Remote callers become links because their spans are not ingested locally.
  Responses are `mcp.response` events. Notifications are context-correlated logs, so they do not create artificial request spans.
- **Stopped versus lost.** Explicit removal and graceful daemon shutdown end contexts as `stopped`, with an OK context span and `context.stopped` on unfinished requests.
  Unexpected closure, transport errors and child exit use `lost`, ending context and unfinished request spans with `context.lost`. Settlement happens once.
- **One local recorder.** `LocalTraceRecorder` owns local spans, correlated logs, summaries and live delivery, replacing the separate local batch exporter and log sink.
  Atomic flushes keep these records consistent. Bounded queues, retries and reported loss make failures visible. Optional OTLP export retains its independent batch processor.
- **A durable trace index.** Summaries track identity, kind, timing, outcome, counts and revision. Resumed segments retain the first root, counts and revision history.
  Hydration merges persisted summaries with pending changes. Startup marks active traces interrupted before recovery, which can reactivate them.
  Retention protects active traces and deletes spans, logs and summaries together.
- **Reads include pending work.** Readers snapshot recorder memory before querying storage, then deduplicate spans and logs and keep newer summaries.
  This preserves unflushed observations and avoids duplicates across a concurrent commit. Older history remains readable by ID without an index backfill.
  `traces.get` returns the newest 1000 logs with a truncation marker. `runs.trace` stays as a deprecated adapter preserving its response shape.
- **Redaction precedes observation.** Secret-bearing keys are redacted recursively. Request metadata retains only `traceparent` and `dev.mokei/flow-run`.
  Storage, live events, OTLP and sanitised `context:message` use the observation copy. Forwarded MCP traffic remains unchanged.
- **Explicit payload defaults.** Daemon configuration defaults to capture on, capped at 65536 bytes. Embedded `ContextHost` and `ContextClient` default to off.
  Capture accepts on, off or a byte cap, and marks truncation. Without recording, producers avoid payload serialisation.
- **Bounded live delivery.** `span:start`, `span:end`, `log` and `trace:summary` events arrive before persistence.
  Each subscriber allows 2000 pending writes. Overflow ends its stream, so reconnecting clients reconcile from queries instead of silently missing events.
- **One monitor connection and Traces page.** A single connection owner dispatches events to flow and trace consumers.
  Consumers subscribe before querying and discard old state on each connection epoch. The two-pane page combines filtered history, live waterfalls and span inspection.
  Flow headers retain run state, cancellation and inbox navigation. Legacy Runs routes redirect to traces.

## Execution rulings and review follow-ups

- **Root eligibility follows the design.** The plan's parentless-span fallback was rejected after browser QA exposed unrelated Enkaku handler traces.
  Only marked root segments create summary rows.
- **Hydration must not block writes.** Unresolved traces keep one merged pending summary delta and stay outside recorder snapshots until hydration resolves.
  Hydration is bounded and retried, with permanent losses reported. This removes conflicting partial summaries while flushes continue.
- **Error and redaction clarification.** Other local failures use OpenTelemetry's `_OTHER` fallback. Transport closure uses `context.lost`.
  Exact exemptions preserve `maxTokens`, `inputTokens`, `outputTokens`, `totalTokens` and `progressToken` under the secret-key pattern.
- **Upstream fixes replaced temporary constraints.** Stream backpressure was requested upstream and adopted from enkaku 0.21.5, making the subscriber bound effective through transport.
  JSON column decoding was requested upstream and adopted from hozon db 0.2.3, preserving nested JSON-looking strings and removing temporary payload escaping.
- **Monitor review fixes.** Query failures expose errors and retry actions. Flow labels and IDs remain searchable, and resumed traces preserve their original name.
  Context navigation selects the context link. Paging state and action errors remain visible. Page lifecycle handling releases connections and reconciles after restoration.
  The startup event buffer is also bounded at 2000 events, then reconnects.
- **Shutdown ordering matters.** Proxied contexts settle as stopped before transport teardown, including shutdown signals received during boot.
- **Release intent remains patch.** Existing minor intents make the combined release plan 0.15.0. This work adds a patch intent without changing those earlier decisions.

## What was built

- **`@mokei/context-rpc`:** allocated request ID observation for exchange tracing.
- **`@mokei/context-client`:** the shared observation helper, tracing bindings, exchange spans, notification logs and payload controls.
- **`@mokei/host`:** context lifetime spans, hosted-client bindings and termination reasons.
- **`@mokei/host-node`:** proxy tracing, sanitised message events, bounded subscriptions, trace handlers and graceful context settlement.
- **`@mokei/flow-host` and `@mokei/decision-flow`:** flow/root and step classification, plus active-trace retention protection.
- **`@mokei/app-node`:** the trace index, local recorder, merged reader, telemetry integration, payload configuration and interruption sweep.
- **`@mokei/flow-host-node`:** transactional trace retention, the legacy run-trace adapter and payload configuration for flow contexts.
- **`@mokei/host-protocol`:** trace query contracts, open spans, identified logs, summaries, live events and tracing loss counters.
- **`mokei` (CLI):** recorder and trace-handler wiring, startup sweep before recovery, and shutdown flushing.
- **`monitor/`:** one host connection, trace hooks, live and placeholder span trees, Traces pages, payload inspection and legacy route redirects.
- **Documentation and release:** architecture and package guidance, a patch release intent, and the follow-ons backlog.

Follow-ons: [unified traces backlog](../backlog/2026-10-08-unified-traces-follow-ons.md).
