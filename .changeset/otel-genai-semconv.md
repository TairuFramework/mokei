---
'@mokei/anthropic-provider': patch
'@mokei/app-node': patch
'@mokei/context-client': patch
'@mokei/context-rpc': patch
'@mokei/decision-flow': patch
'@mokei/flow-host': patch
'@mokei/flow-host-node': patch
'@mokei/host': patch
'@mokei/host-node': patch
'@mokei/host-protocol': patch
'@mokei/llama-provider': patch
'@mokei/model-provider': patch
'@mokei/ollama-provider': patch
'@mokei/openai-provider': patch
'@mokei/session': patch
'@mokei/session-node': patch
'@mokei/system-one-client': patch
'mokei': patch
---

Align telemetry with the OpenTelemetry GenAI and MCP semantic conventions (schema `gen-ai-dev/1.42.0-dev`).

New: `chat {model}` inference, `invoke_agent` and local `execute_tool` spans; MCP and GenAI metrics; OTLP metrics export (`tracing.otlp.metricsEndpoint`, `service` option); `tracing.parentFrom` (`context` or `meta`) for incoming MCP span parenting; GenAI content capture through `tracing.payloads` or `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`. Successful spans now leave status `UNSET`.

Breaking, span names: `mcp.<method>` becomes `<method> [target]`, `flow.run` and `flow.run.resume` become `invoke_workflow {flowID}`, `decision.predict` becomes `predict {model}`.

Breaking, attributes: `run.id`, `flow.id`, `run.label`, `run.state` become `mokei.run.id`, `mokei.flow.id`, `mokei.run.label`, `mokei.run.state`, with no migration of stored traces; `mcp.transport` becomes `network.transport`; `server.name` becomes `mokei.server.name`; `system_one.*` becomes `gen_ai.*` or `mokei.system_one.*`; the `mcp.response` event attribute `payload` becomes `mokei.mcp.response`.
