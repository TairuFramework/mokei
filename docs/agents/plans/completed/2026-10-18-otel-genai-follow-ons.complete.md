# OTel GenAI semconv follow-ons

**Status:** complete
**Dates:** 2026-10-18

## Goal

Close the follow-ons of the [OTel GenAI semantic conventions](2026-10-18-otel-genai-semconv.complete.md)
alignment before merge: count each logical MCP/GenAI operation once, and fill the small telemetry gaps
found in its final review.

## Key decisions

- **Proxied calls are flagged, not dropped.** A daemon-proxied request whose `_meta` carries a valid W3C
  `traceparent` was already measured by an instrumented caller. The proxy keeps its span (same name, kind,
  parent and links), sets `mokei.mcp.proxied = true`, and records no `mcp.*.operation.duration` point.
  Untraced callers keep span and metric. Span-based counts should exclude proxied spans. Chosen over making
  the proxy span a child of the caller, which would break the monitor's one-trace-per-context view.
- **MRTR rounds stay per-request spans.** Each wire round keeps its span (MCP semconv is per request); a
  round that suspends with `input_required` gets `mokei.mcp.round = n` and no `gen_ai.operation.name`, and
  only the final round is `execute_tool`. On `tools/call`, `gen_ai.operation.name` is therefore set at
  settle, not span start (an attribute cannot be removed once set). Chosen over a wrapper `execute_tool`
  span around every tool call. Metric labels keep `execute_tool` for every `tools/call` wire request.
- **Failed logical calls stay visible.** A call that fails locally after a suspension (embedded request
  failure, round cap, total timeout, abort, refused suspension) emits one `INTERNAL` `execute_tool {tool}`
  error span linked to the first round. The daemon proxy applies the same `input_required` rule without
  round numbers.
- **Context transport is explicit.** Context spans carry `mokei.context.transport` (`direct` | `stdio` |
  `http`); the monitor labels `direct` as in-process and falls back to `network.*` for older rows.
- **Inference spans always end.** An abort of the request signal ends the `chat` span as `cancelled` with
  metrics; a stream garbage-collected while open ends span-only (`error.type=_OTHER`, `stream abandoned`),
  since collection time would skew histograms. The `FinalizationRegistry` is guarded for React Native.
- **Smaller closures.** The content env var also gates daemon `context:message` events; custom providers
  report `gen_ai.provider.name` through the public `ModelProvider.telemetry` (documented, never guessed);
  `@mokei/decision-flow` builds its tracer and meter through the `@sozai/otel` factories.

## Status

All eight follow-ons shipped on the same branch. Remaining review notes are cosmetic (test naming, extra
pin tests) and were not carried forward.
