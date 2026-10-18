# OTel GenAI semantic conventions follow-ons

**Origin:** [OTel GenAI semantic conventions](../completed/2026-10-18-otel-genai-semconv.complete.md).

## Follow-ons

- Label in-process (`direct`) contexts in the monitor context header; they show "Unknown transport".
- Verify that truncated `gen_ai.prompt.variable.<name>` attributes on `prompts/get` set the truncation flag.
- Apply `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` to daemon `context:message` events, which only follow `payloads` today.
- Give custom `ModelProvider` implementations a way to report `gen_ai.provider.name`; spans omit it today.
- End the inference span of a chat stream abandoned without being drained or cancelled.
- Deduplicate `tools/call` spans and MCP client metrics when the daemon proxy and an instrumented caller both export to one backend.
- Decide whether MRTR retry legs should share one `execute_tool` span instead of one per leg.
- Move `@mokei/decision-flow` to the `@sozai/otel` tracer and meter factories; it still builds them through the provider directly.
