# OpenTelemetry GenAI semantic conventions alignment

Align mokei telemetry with the OpenTelemetry GenAI and MCP semantic conventions published in
`open-telemetry/semantic-conventions-genai` (schema `https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev`,
status `development`). Source docs: `docs/gen-ai/mcp.md`, `client-inference.md`,
`gen-ai-agent-spans.md`, `gen-ai-spans.md`, `gen-ai-metrics.md`, `gen-ai-token-metrics.md`,
`gen-ai-events.md`, `anthropic.md`, `openai.md`, and `docs/registry/attributes/{gen-ai,mcp}.md`.

## Decisions

- **Incoming MCP span parenting** is configurable: `parentFrom: 'context' | 'meta'`, default
  `'context'` (current behaviour, keeps one trace per context for the monitor). `'meta'` follows
  the spec: the `_meta` trace context is the parent and the context span becomes a link.
- **Flow attribute rename is a clean break.** `run.id`, `flow.id`, `run.label`, `run.state` become
  `mokei.run.id`, `mokei.flow.id`, `mokei.run.label`, `mokei.run.state` everywhere, including the
  stored trace index and the `host-protocol` summary schema. Old stored rows are not migrated.
- **GenAI content capture** (`gen_ai.input.messages`, `gen_ai.output.messages`,
  `gen_ai.system_instructions`, `gen_ai.tool.definitions`, `gen_ai.tool.call.arguments`,
  `gen_ai.tool.call.result`, `gen_ai.prompt.variable.<name>`) is gated by the existing `payloads`
  option. `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` enables it with the default cap
  when `payloads` is unset or `'off'`. Redaction and the byte cap apply to every content attribute.
- **Inference instrumentation lives in `Session`**, the single path every chat call takes. Providers
  only describe themselves (`ModelProvider.telemetry`) and surface response metadata on the `done`
  part. `@mokei/model-provider` stays free of OpenTelemetry.
- **MCP tool calls are the `execute_tool` span.** A `tools/call` client span carries
  `gen_ai.operation.name=execute_tool`; the agent passes `gen_ai.tool.call.id`, `gen_ai.agent.name`
  and `gen_ai.conversation.id` down as local-only trace attributes, so no second span is created.
  Local (`local:`) tools get their own `execute_tool` span.
- **Metrics** are emitted through `@opentelemetry/api` meters and exported only when OTLP is
  configured. The local trace recorder stays spans-only.

## MCP spans

Span name `{mcp.method.name} {target}`: target is the tool name for `tools/call`, the prompt name
for `prompts/get`, otherwise none. Status stays `UNSET` on success; on error it is `ERROR` with the
JSON-RPC error message as description.

| Attribute | Rule |
|---|---|
| `mcp.method.name`, `jsonrpc.request.id`, `mcp.session.id`, `gen_ai.tool.name` | kept |
| `gen_ai.operation.name` | `execute_tool` on `tools/call` only |
| `gen_ai.prompt.name` | `prompts/get` |
| `mcp.resource.uri` | `resources/read`, `resources/subscribe`, `resources/unsubscribe`, `notifications/resources/updated` |
| `mcp.protocol.version` | negotiated revision when known |
| `network.transport` | `pipe` (stdio) or `tcp` (HTTP); replaces `mcp.transport` |
| `network.protocol.name` | `http` for HTTP contexts |
| `server.address`, `server.port` | client spans of HTTP contexts |
| `rpc.response.status_code` | JSON-RPC error code as string |
| `error.type` | code as string, `tool_error`, `cancelled`, `context.lost`, `context.stopped`, `_OTHER` |
| `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result` | opt-in content; result only on success |
| `gen_ai.prompt.variable.<name>` | opt-in content, `prompts/get` arguments |

Server-side spans (direction `server`) do not mark `-32700`, `-32600`, `-32601`, `-32602`,
`-32002` as errors; they still record `rpc.response.status_code`. The context span renames
`server.name` to `mokei.server.name`. The `mcp.response` event attribute `payload` becomes
`mokei.mcp.response`.

## GenAI spans

- **Inference** `chat {model}`, kind `CLIENT` (llama: `INTERNAL`): `gen_ai.operation.name=chat`,
  `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.request.{temperature,max_tokens,top_p}`,
  `gen_ai.request.stream=true`, `gen_ai.output.type=json` for structured output, `server.address`,
  `server.port`, `gen_ai.response.{id,model,finish_reasons}`, `gen_ai.response.time_to_first_chunk`,
  `gen_ai.usage.{input,output}_tokens`, `gen_ai.usage.cache_read.input_tokens`,
  `gen_ai.usage.cache_write.input_tokens`, `gen_ai.usage.reasoning.output_tokens`, `error.type`.
  Provider names: `openai`, `anthropic`, `ollama`, `llama.cpp`. Anthropic input tokens include
  cache read and write.
- **Agent** `invoke_agent {name}` (or `invoke_agent`), kind `INTERNAL`: `gen_ai.operation.name`,
  `gen_ai.agent.name`, `gen_ai.agent.description`, `gen_ai.conversation.id` (only when the
  application supplies one), `gen_ai.request.model`, `gen_ai.usage.*`, `error.type`.
- **Local tool** `execute_tool {name}`, kind `INTERNAL`.
- **Flow run** `invoke_workflow {flowID}` (or `invoke_workflow`), kind `INTERNAL`,
  `gen_ai.operation.name=invoke_workflow`, `gen_ai.workflow.name`.
- **System One** `predict {model}`, kind `CLIENT`: `gen_ai.operation.name=predict`,
  `gen_ai.provider.name=mokei.system_one`, `gen_ai.request.model`, `gen_ai.response.model`,
  `gen_ai.usage.*`, `http.response.status_code` (replaces `http.status_code`),
  `mokei.system_one.question.count`, `mokei.system_one.retry_after_ms`.

## Metrics

| Metric | Instrument, unit | Buckets |
|---|---|---|
| `mcp.client.operation.duration`, `mcp.server.operation.duration`, `mcp.client.session.duration` | histogram, `s` | `[0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]` |
| `gen_ai.client.inference.duration`, `gen_ai.client.inference.time_to_first_chunk`, `gen_ai.client.inference.time_per_output_chunk`, `gen_ai.execute_tool.duration`, `gen_ai.client.operation.duration` | histogram, `s` | `[0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92]` |
| `gen_ai.invoke_agent.duration` | histogram, `s` | `[0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12.8, 25.6, 51.2, 102.4, 204.8, 409.6]` |
| `gen_ai.invoke_agent.inference_calls`, `gen_ai.invoke_agent.tool_calls` | histogram, `{inference_call}` / `{tool_call}` | `[1, 2, 4, 8, 16, 32, 64, 128]` |
| `gen_ai.invoke_workflow.duration` | histogram, `s` | `[1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200]` |
| `gen_ai.client.inference.usage.{input,output,cache_read.input,cache_write.input,reasoning.output}_tokens` | counter, `{token}` | -- (`gen_ai.token.modality=text`, or `unknown` with value 0 when no usage) |
| `gen_ai.client.inference.operation.{input,output}_tokens` | histogram, `{token}` | `[1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864]` |

## Telemetry setup

`setupMokeiTelemetry` sets a Resource (`service.name`, default `mokei`; `service.version`),
registers a `MeterProvider` with an OTLP HTTP metric exporter when OTLP is configured (endpoint
`otlp.metricsEndpoint`, else `otlp.endpoint` with a trailing `/v1/traces` replaced by
`/v1/metrics`, else metrics off). Tracers and meters carry the GenAI schema URL through the `@sozai/otel`
`createTracerFactory` / `createMeterFactory` options.
