# OTel GenAI semantic conventions

**Status:** complete
**Dates:** 2026-10-18

## Goal

Align mokei spans and metrics with the OpenTelemetry GenAI and MCP semantic conventions
(`open-telemetry/semantic-conventions-genai`, schema `https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev`,
status `development`), so standard GenAI backends and dashboards read mokei telemetry without mapping.

## Key decisions

- **Shared semconv helpers in `@mokei/context-client`.** Schema URL, bucket boundaries, the
  content-capture gate, `endSpanError` and `errorTypeOf` live in one module. Tracers and meters come from
  `getMokeiTracer` / `getMokeiMeter`, built on the `@sozai/otel` 0.3.4 `createTracerFactory` /
  `createMeterFactory` options. Plain `trace.getTracer` in `@opentelemetry/api` 1.9.x drops `schemaUrl`.
- **MCP spans follow the MCP conventions.** Name `{mcp.method.name} {target}`, status unset on success,
  `network.*`, `server.*`, `mcp.protocol.version`, `rpc.response.status_code` and `error.type`. Server
  spans do not mark protocol-level codes (-32700, -32600, -32601, -32602, -32002) as errors. The context
  span uses `mokei.server.name`. `tools/call` client spans are the `execute_tool` span; local tools get
  their own.
- **Incoming parenting is configurable.** `parentFrom: 'context' | 'meta'`, default `'context'` (one
  trace per context, as the monitor expects). `'meta'` follows the spec: the `_meta` trace context is
  the parent and the context span becomes a link.
- **Inference instrumentation lives in `Session`.** It emits `chat {model}` spans and inference metrics.
  Providers stay OpenTelemetry-free: they describe themselves through `ModelProvider.telemetry` and report
  response ID, model, finish reasons and cache/reasoning tokens on `done`. Anthropic input tokens include
  cache read and write.
- **Agents, flows and System One get GenAI spans.** `AgentSession` emits `invoke_agent` (no
  `gen_ai.provider.name`, as for in-process agents), flow runs emit `invoke_workflow {flowID}`, and decide
  nodes emit `predict {model}` with `gen_ai.provider.name=mokei.system_one`. Agent tool-call IDs, agent
  name and conversation ID reach MCP spans as local-only `traceAttributes`, never sent on the wire.
- **Run attributes renamed, clean break.** `run.id`, `flow.id`, `run.label`, `run.state` became
  `mokei.run.*` / `mokei.flow.id` everywhere, including the trace index and `host-protocol`. Stored rows
  are not migrated.
- **Content capture is opt-in.** GenAI content attributes follow the existing `payloads` option, or
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` when `payloads` is unset or off. The env var
  also enables raw MCP payload capture. Redaction, the byte cap and truncation flags apply to every content
  attribute. Tool definitions keep their schema property names but stay size-capped.
- **Metrics through the OTel API.** MCP operation and session durations, `gen_ai.client.inference.*`,
  token counters with `gen_ai.token.modality`, agent, tool and workflow histograms. `app-node` registers a
  Resource (`service.name`, `service.version`) and an OTLP HTTP metrics pipeline only when OTLP is
  configured (`metricsEndpoint`, else the traces endpoint with `/v1/metrics`). The local trace recorder
  stays spans-only.

## Known trade-offs

- Release intents stay `patch` (0.14.x band) although span names, attributes and success status changed.

## Status

All planned work shipped. Follow-ons: [OTel GenAI semconv follow-ons](2026-10-18-otel-genai-follow-ons.complete.md).
