# OTel GenAI Semantic Conventions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Stage:** planning
**Mode:** tasks

**Goal:** Make mokei's spans and metrics follow the OpenTelemetry GenAI and MCP semantic conventions.

**Architecture:** Shared semconv constants, tracer/meter helpers and the content-capture gate live
in `@mokei/context-client` (`src/semconv.ts`). MCP spans are fixed in place
(`observation.ts`, `client-tracing.ts`, `proxy-tracing.ts`, `host.ts`). Providers describe themselves
through an optional `ModelProvider.telemetry` field and richer `done` parts. `Session` emits inference
spans and metrics, and `AgentSession` emits `invoke_agent`. Flow runs become `invoke_workflow` spans.
`app-node` adds a Resource and an OTLP metrics pipeline.

**Tech Stack:** TypeScript, `@opentelemetry/api` 1.9, `@opentelemetry/sdk-trace-base`,
`@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-metrics-otlp-http`,
`@opentelemetry/resources`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-otel-genai-semconv-design.md`

## Global Constraints

- Schema URL constant: `SEMCONV_SCHEMA_URL = 'https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev'`.
- Content env var: `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`; only the value `true` (case-insensitive) enables it.
- Successful spans leave status `UNSET`. Never call `setStatus({ code: SpanStatusCode.OK })`.
- Attribute keys mokei invents use the `mokei.` prefix. `_meta` keys keep `dev.mokei/`.
- `@mokei/model-provider`, `@mokei/host`, `@mokei/session`, `@mokei/context-client` stay Node-free; `rn-bundle.test.ts` must keep passing. Read env with `globalThis.process?.env`.
- `@opentelemetry/sdk-*`, exporters and resources are dependencies of `@mokei/app-node` only; other packages get them as devDependencies for tests.
- New catalog entries in `pnpm-workspace.yaml`: `@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-metrics-otlp-http`, `@opentelemetry/resources`, at the latest versions matching the existing `@opentelemetry/*` 2.x / 0.2xx lines.
- No new packages. Kebab-case file names. `pnpm` only. Lint with `rtk proxy pnpm run lint`.
- Cross-package tests resolve built `lib/`: rebuild a changed dependency (`pnpm --filter <pkg> build`) before running dependents' tests.
- Changeset type: `patch`.
- Committed docs never reference local paths or sibling checkouts.

## Review Focus

- **Tracing off (no SDK registered):** every path must stay a no-op with no attribute computation cost; the existing lazy `get attributes()` pattern must be kept. Task 2 adds `no-op tracer computes no attributes`.
- **Content capture with secrets:** `gen_ai.tool.call.arguments` and `gen_ai.input.messages` go through `redactPayload`; an `apiKey` argument shows `[redacted]`. Task 2 and Task 8 pin it.
- **Stream abandoned mid-way:** a consumer that stops reading a chat stream (or aborts) must still end the inference span, with `error.type=cancelled`. Task 8 pins it.
- **Provider error part:** a `{ type: 'error' }` part ends the span with `error.type` set to the error's `name` (or `_OTHER`), and records duration metrics with `error.type`. Task 8 pins it.
- **Tool call ID never leaks to the wire:** local trace attributes must never appear in the JSON-RPC message sent to the MCP server. Task 9 pins it.

---

### Task 1: Semconv helpers and content gate

**Files:**
- Create: `packages/context-client/src/semconv.ts`
- Modify: `packages/context-client/src/index.ts` (export the new module)
- Test: `packages/context-client/test/semconv.test.ts`

**Interfaces:**
- Produces:
  - `SEMCONV_SCHEMA_URL: string`
  - `MCP_DURATION_BUCKETS`, `GEN_AI_DURATION_BUCKETS`, `AGENT_DURATION_BUCKETS`, `AGENT_COUNT_BUCKETS`, `WORKFLOW_DURATION_BUCKETS`, `TOKEN_BUCKETS: ReadonlyArray<number>` (values from the spec Metrics table)
  - `getMokeiTracer(scope: string): Tracer` -> `trace.getTracer(`mokei.${scope}`, undefined, { schemaUrl: SEMCONV_SCHEMA_URL })`
  - `getMokeiMeter(scope: string): Meter` -> same with `metrics.getMeter`
  - `resolveContentCapture(payloads: PayloadCapture | undefined): PayloadCapture` — returns `payloads` unless it is `undefined`/`'off'` and the env var is `true`, then `'on'`
  - `endSpanError(span: Span, errorType: string, message?: string): void` — sets `error.type`, status `ERROR` with message, ends span

- [ ] **Step 1: Write failing tests** — `resolveContentCapture`: `(undefined)` → `'off'` with env unset; `('off')` → `'on'` with env `TRUE`; `(1024)` → `1024` with env `true`; `('off')` → `'off'` with env `yes`. `getMokeiTracer('x')` with an in-memory provider produces spans whose `instrumentationScope` is `{ name: 'mokei.x', schemaUrl: SEMCONV_SCHEMA_URL }`. `endSpanError` yields status `{ code: ERROR, message }` and `error.type`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/context-client exec vitest run test/semconv.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `src/semconv.ts` as above.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `feat(context-client): semconv helpers and GenAI content gate`

### Task 2: MCP span shape

**Files:**
- Modify: `packages/context-client/src/observation.ts`, `packages/context-client/src/client-tracing.ts`, `packages/context-client/src/client.ts` (status messages, binding reads)
- Test: `packages/context-client/test/observation.test.ts`, `packages/context-client/test/client-tracing.test.ts`

**Interfaces:**
- Consumes: Task 1 `getMokeiTracer`, `resolveContentCapture`, `endSpanError`.
- Produces:
  - `requestSpanName(method: string, params?: unknown): string` — `tools/call get-weather`, `prompts/get greet`, else `method`
  - `requestAttributes(...)` gains params `protocolVersion?: string`, `network?: NetworkInfo`, `traceAttributes?: Attributes`
  - `type NetworkInfo = { transport: 'pipe' | 'tcp'; protocolName?: 'http'; serverAddress?: string; serverPort?: number }`
  - `responseOutcome(message, side: 'client' | 'server')` → `{ error: false; statusCode?: string } | { error: true; errorType: string; statusCode?: string; message?: string }`
  - `SERVER_NON_ERROR_CODES = new Set([-32700, -32600, -32601, -32602, -32002])`
  - `responseAttributes(method: string, result: unknown, capture): Attributes` — `gen_ai.tool.call.result` for a successful `tools/call`
  - `ClientTracing` gains `getProtocolVersion?: () => string | undefined`, `network?: NetworkInfo`, `parentFrom?: 'context' | 'meta'` (wired in Task 4)

- [ ] **Step 1: Write failing tests** in `observation.test.ts`:
  - span names: `requestSpanName('tools/call', { name: 'get-weather' })` = `'tools/call get-weather'`; `('prompts/get', { name: 'greet' })` = `'prompts/get greet'`; `('initialize')` = `'initialize'`; `('tools/call', {})` = `'tools/call'`.
  - `tools/call` attributes include `gen_ai.operation.name: 'execute_tool'`, `gen_ai.tool.name`; `tools/list` has no `gen_ai.operation.name`.
  - `prompts/get` → `gen_ai.prompt.name`; with capture `'on'` and `arguments: { city: 'Paris' }` → `gen_ai.prompt.variable.city: 'Paris'`.
  - `resources/read` with `{ uri: 'file:///a' }` → `mcp.resource.uri: 'file:///a'`.
  - capture `'on'`, `tools/call` `{ name: 't', arguments: { apiKey: 'k', q: 1 } }` → `gen_ai.tool.call.arguments: '{"apiKey":"[redacted]","q":1}'`; capture `'off'` → key absent.
  - `network: { transport: 'tcp', protocolName: 'http', serverAddress: 'mcp.example.com', serverPort: 443 }` → `network.transport`, `network.protocol.name`, `server.address`, `server.port`; `protocolVersion: '2026-07-28'` → `mcp.protocol.version`.
  - `responseOutcome({ error: { code: -32602, message: 'bad' } }, 'server')` → `{ error: false, statusCode: '-32602' }`; same with `'client'` → `{ error: true, errorType: '-32602', statusCode: '-32602', message: 'bad' }`; `{ result: { isError: true } }` → `errorType: 'tool_error'`, no `statusCode`.
- [ ] **Step 2: Write failing tests** in `client-tracing.test.ts`: a successful `tools/call` span has `status.code === SpanStatusCode.UNSET` and name `tools/call echo`; a JSON-RPC error span has status message equal to the error message and `rpc.response.status_code`; the `mcp.response` event carries `mokei.mcp.response` (not `payload`); success adds `gen_ai.tool.call.result` when capture is on and `isError` is false; `no-op tracer computes no attributes` (spy on a getter counter with no SDK registered).
- [ ] **Step 3: Run** `pnpm --filter @mokei/context-client exec vitest run test/observation.test.ts test/client-tracing.test.ts` — expect FAIL.
- [ ] **Step 4: Implement** the new signatures. `client-tracing.ts` switches to `getMokeiTracer('context-client')`, drops `SpanStatusCode.OK`, uses `endSpanError`, reads `binding.getProtocolVersion?.()` and `binding.network` in the lazy `attributes` getter, and passes `resolveContentCapture(binding?.payloads)` as capture. `client.ts` call sites passing `outcome` adopt the new `responseOutcome` shape.
- [ ] **Step 5: Run** the two test files, then `pnpm --filter @mokei/context-client test` — expect PASS.
- [ ] **Step 6: Commit** `feat(context-client): MCP spans follow GenAI MCP conventions`

### Task 3: Host and proxy context spans

**Files:**
- Modify: `packages/host/src/host.ts:614-660`, `packages/host-node/src/proxy-tracing.ts`
- Test: `packages/host/test/context-tracing.test.ts`, `packages/host-node/test/proxy-tracing.test.ts`

**Interfaces:**
- Consumes: Task 2 `requestSpanName`, `requestAttributes`, `responseOutcome`, `NetworkInfo`; Task 1 `getMokeiTracer`, `endSpanError`.
- Produces: context span attributes `network.transport`, `network.protocol.name`, `server.address`, `server.port`, `mcp.protocol.version`, `mokei.server.name` (replaces `mcp.transport` and `server.name`).

- [ ] **Step 1: Write failing tests**
  - host: an HTTP context to `https://mcp.example.com:8443/api` has a context span with `network.transport: 'tcp'`, `network.protocol.name: 'http'`, `server.address: 'mcp.example.com'`, `server.port: 8443`, `mokei.server.name`, `mcp.protocol.version` equal to `client.protocolVersion`, and no `mcp.transport`/`server.name`; its `tools/call` client span has the same network attributes. A direct context has no `network.*`. A stopped context's span status is `UNSET`.
  - proxy: stdio context span `network.transport: 'pipe'`; request span named `tools/call echo`; an `initialize` response with `protocolVersion: '2025-11-25'` sets `mcp.protocol.version` on the context span and later request spans; an error response sets status message to `error.message`; a server-initiated request answered with `-32601` is not `ERROR` but has `rpc.response.status_code: '-32601'`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/host exec vitest run test/context-tracing.test.ts` and `pnpm --filter @mokei/host-node exec vitest run test/proxy-tracing.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** `#wireContextSubscriptions` takes an optional `url: string` for HTTP contexts (passed from `addHTTPContext`) and derives `NetworkInfo` with `new URL(url)` (default port 443/80 by scheme). It sets `getProtocolVersion: () => client.protocolVersion` on the binding. The proxy's request span uses `requestSpanName(method, message.params)`, side `from === 'client' ? 'client' : 'server'` for `responseOutcome`, and caches `protocolVersion` from an `initialize` result.
- [ ] **Step 4: Rebuild** `pnpm --filter @mokei/context-client build`, then **run** both test files and both packages' full `test` — expect PASS.
- [ ] **Step 5: Commit** `feat(host): context spans carry network and protocol attributes`

### Task 4: Configurable incoming parenting

**Files:**
- Modify: `packages/context-client/src/client-tracing.ts` (`startIncoming`), `packages/host/src/host.ts` (`ContextHostParams.tracing`), `packages/host-node/src/proxy-tracing.ts`, `packages/host-node/src/daemon-server.ts:130`, `packages/flow-host-node/src/service.ts`
- Test: `packages/context-client/test/client-tracing.test.ts`, `packages/host-node/test/proxy-tracing.test.ts`

**Interfaces:**
- Consumes: Task 2 `ClientTracing.parentFrom`.
- Produces: `type TraceParentFrom = 'context' | 'meta'` exported from `@mokei/context-client`; `ContextHostParams.tracing.parentFrom?: TraceParentFrom`; `createProxyTracing({ ..., parentFrom?: TraceParentFrom })`; daemon `tracing.parentFrom`.

- [ ] **Step 1: Write failing tests** — with `parentFrom: 'meta'` and a valid `_meta.traceparent`, the incoming span's `parentSpanContext.spanId` equals the remote span ID and its links contain the context span; without `_meta.traceparent` it falls back to the context span as parent. With the default, the current behaviour holds (existing tests). Same pair for the proxy.
- [ ] **Step 2: Run** the two test files — expect FAIL.
- [ ] **Step 3: Implement** the branch in `startIncoming` and proxy request start; thread `parentFrom` through host params, `setTracing`, daemon `tracing` and `createFlowService` tracing.
- [ ] **Step 4: Run** both packages' `test` — expect PASS.
- [ ] **Step 5: Commit** `feat(context-client): opt-in spec parenting for incoming MCP spans`

### Task 5: MCP metrics

**Files:**
- Create: `packages/context-client/src/mcp-metrics.ts`, `packages/context-client/test/support/metrics.ts`
- Modify: `packages/context-client/src/client-tracing.ts`, `packages/host-node/src/proxy-tracing.ts`, `packages/host/src/host.ts`, `packages/context-client/package.json` (devDependency `@opentelemetry/sdk-metrics`)
- Test: `packages/context-client/test/mcp-metrics.test.ts`, `packages/host/test/context-tracing.test.ts`

**Interfaces:**
- Consumes: Task 1 `getMokeiMeter`, `MCP_DURATION_BUCKETS`.
- Produces:
  - `recordMCPOperation(params: { side: 'client' | 'server'; durationS: number; attributes: Attributes }): void` — `mcp.client.operation.duration` / `mcp.server.operation.duration`
  - `recordMCPSession(params: { durationS: number; attributes: Attributes }): void` — `mcp.client.session.duration`
  - `metricAttributes(spanAttributes: Attributes): Attributes` — keeps only `mcp.method.name`, `gen_ai.tool.name`, `gen_ai.prompt.name`, `gen_ai.operation.name`, `error.type`, `rpc.response.status_code`, `mcp.protocol.version`, `network.transport`, `network.protocol.name`, `server.address`, `server.port`
  - test helper `useTestMetrics(): { collect(): Promise<Map<string, Array<{ value: unknown; attributes: Attributes }>>> }` using `MeterProvider` + a manual `MetricReader`; copy it to other packages' `test/support/metrics.ts` when they need it
- Instruments are created lazily on first record with `advice: { explicitBucketBoundaries: MCP_DURATION_BUCKETS }`, unit `s`.

- [ ] **Step 1: Write failing tests** — a `tools/call` round trip records one `mcp.client.operation.duration` point with `mcp.method.name: 'tools/call'`, `gen_ai.tool.name`, and no `jsonrpc.request.id`/`mcp.session.id`/`mokei.*`; a failed call adds `error.type`; removing a host context records `mcp.client.session.duration`, with `error.type: 'context.lost'` for a lost context; proxy server-initiated requests record `mcp.server.operation.duration`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/context-client exec vitest run test/mcp-metrics.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** and call from exchange `finish`, proxy `finish`, and context-span end in host and proxy (duration from a `performance.now()` taken at start).
- [ ] **Step 4: Run** context-client, host and host-node `test` — expect PASS.
- [ ] **Step 5: Commit** `feat(context-client): MCP operation and session duration metrics`

### Task 6: Provider telemetry surface (model-provider, OpenAI, Anthropic)

**Files:**
- Modify: `packages/model-provider/src/index.ts:187-322`, `packages/openai-provider/src/{provider.ts,client.ts,types.ts}`, `packages/anthropic-provider/src/{provider.ts,client.ts}`
- Test: `packages/model-provider/test/finish-reason.test.ts` (create), `packages/openai-provider/test/provider.test.ts`, `packages/anthropic-provider/test/stream-chat.test.ts`

**Interfaces:**
- Produces:
  - `type ProviderTelemetry = { providerName: string; serverAddress?: string; serverPort?: number; local?: boolean; inputTokensExcludeCache?: boolean; syntheticToolCallIDs?: boolean }`
  - `ModelProvider.telemetry?: ProviderTelemetry`
  - `done` part optional fields: `responseID?: string`, `responseModel?: string`, `cacheReadInputTokens?: number`, `cacheWriteInputTokens?: number`, `reasoningOutputTokens?: number`
  - `normalizeFinishReason(reason: string | undefined): 'stop' | 'length' | 'content_filter' | 'tool_call' | 'error' | string` — maps `stop`, `end_turn`, `stop_sequence` → `stop`; `length`, `max_tokens` → `length`; `tool_calls`, `tool_use` → `tool_call`; `content_filter`, `refusal` → `content_filter`; `abort` → `error`; `undefined` → `error`; other values pass through
  - `telemetryFromBaseURL(providerName: string, baseURL: string): ProviderTelemetry`

- [ ] **Step 1: Write failing tests**
  - `normalizeFinishReason` table above.
  - OpenAI: provider `telemetry` = `{ providerName: 'openai', serverAddress: 'api.openai.com', serverPort: 443 }`; a stream whose final chunk carries `usage` after the `finish_reason` chunk yields one `done` part with the real token counts (`prompt_tokens: 12`, `completion_tokens: 5`), `responseID` and `responseModel` from the chunk, `cacheReadInputTokens` from `usage.prompt_tokens_details.cached_tokens` and `reasoningOutputTokens` from `usage.completion_tokens_details.reasoning_tokens`.
  - Anthropic: `telemetry.providerName === 'anthropic'`, `inputTokensExcludeCache: true`; `done` carries `responseID`/`responseModel` from `message_start`, `cacheReadInputTokens` from `cache_read_input_tokens`, `cacheWriteInputTokens` from `cache_creation_input_tokens`.
- [ ] **Step 2: Run** the three test files — expect FAIL.
- [ ] **Step 3: Implement.** OpenAI emits `done` when the stream ends (holding the finish reason until then) instead of on the `finish_reason` chunk; add the `*_details` fields to `ChatCompletionUsage`. Clients keep `baseURL` so providers can build `telemetry`.
- [ ] **Step 4: Rebuild** model-provider, **run** all three packages' `test` — expect PASS.
- [ ] **Step 5: Commit** `feat(model-provider): provider telemetry and response metadata`

### Task 7: Ollama and llama telemetry

**Files:**
- Modify: `packages/ollama-provider/src/{provider.ts,client.ts}`, `packages/llama-provider/src/provider.ts`
- Test: `packages/ollama-provider/test/client.test.ts`, `packages/llama-provider/test/stream-chat.test.ts`

**Interfaces:**
- Consumes: Task 6 `ProviderTelemetry`, `telemetryFromBaseURL`, `done` fields.
- Produces: Ollama `telemetry = { providerName: 'ollama', serverAddress: 'localhost', serverPort: 11434, syntheticToolCallIDs: true }` by default; `done.responseModel` from the response `model`. Llama `telemetry = { providerName: 'llama.cpp', local: true, syntheticToolCallIDs: true }`.

- [ ] **Step 1: Write failing tests** for the two `telemetry` values and the Ollama `responseModel`.
- [ ] **Step 2: Run** — expect FAIL. **Step 3: Implement.** **Step 4: Run** both packages' `test` — expect PASS.
- [ ] **Step 5: Commit** `feat(providers): ollama and llama telemetry`

### Task 8: Inference spans and metrics in Session

**Files:**
- Create: `packages/session/src/inference-tracing.ts`, `packages/session/src/gen-ai-content.ts`, `packages/session/test/inference-tracing.test.ts`, `packages/session/test/support/{otel.ts,metrics.ts}`
- Modify: `packages/session/src/session.ts` (`streamChatTurn` 332-366, `chat` 372-411, `chunkToServerMessage` 112-140, constructor), `packages/session-node/src/node-session.ts:33`, `packages/session/package.json` (deps `@opentelemetry/api`, `@mokei/context-client`; devDeps sdk-trace-base, sdk-metrics, context-async-hooks)

**Interfaces:**
- Consumes: Task 1 helpers and buckets; Task 6 `ProviderTelemetry`, `done` fields, `normalizeFinishReason`; `capturePayload`, `redactPayload` from context-client.
- Produces:
  - `SessionParams.tracing?: { payloads?: PayloadCapture; parentFrom?: TraceParentFrom }` — forwarded to the host it constructs
  - `streamChatTurn` and `chat` params accept `SamplingParams` and forward them to `provider.streamChat`
  - `traceStreamChat<T>(params: { telemetry?: ProviderTelemetry; request: StreamChatParams; tools?: Array<Tool>; capture: PayloadCapture; start: () => StreamChatRequest }): StreamChatRequest` — returns a request whose stream is a pass-through that ends the span
  - `toInputMessages(messages): Array<GenAIMessage>`, `toSystemInstructions(messages)`, `toOutputMessages(aggregated, finishReason)`, `toToolDefinitions(tools: Array<Tool>)` — JSON shapes from the spec (`{ role, parts: [{ type: 'text', content }] }`, `tool_call {id, name, arguments}`, `tool_call_response {id, response}`, `reasoning {content}`)

- [ ] **Step 1: Write failing tests** in `inference-tracing.test.ts` with a fake provider:
  - span name `chat gpt-x`, kind `CLIENT` (`INTERNAL` when `telemetry.local`), attributes `gen_ai.operation.name: 'chat'`, `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.request.temperature: 0.2`, `gen_ai.request.max_tokens: 100`, `gen_ai.request.stream: true`, `server.address`, `server.port`; `gen_ai.output.type: 'json'` when `output` is set.
  - after `done`: `gen_ai.response.id`, `gen_ai.response.model`, `gen_ai.response.finish_reasons: ['tool_call']` for raw `tool_calls`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, cache and reasoning token attributes only when non-zero, `gen_ai.response.time_to_first_chunk` > 0.
  - `inputTokensExcludeCache` provider with `inputTokens: 10, cacheReadInputTokens: 5, cacheWriteInputTokens: 2` → `gen_ai.usage.input_tokens: 17`.
  - no `gen_ai.input.messages` by default; with capture `'on'` → `gen_ai.input.messages`, `gen_ai.system_instructions` (system message extracted), `gen_ai.output.messages`, `gen_ai.tool.definitions`; an `apiKey` inside a tool-call argument is `[redacted]`; env var `true` with no `payloads` also enables them.
  - error part → status `ERROR`, `error.type` = error `name` (or `_OTHER`); consumer cancels the stream → `error.type: 'cancelled'`; span always ends exactly once.
  - metrics: `gen_ai.client.inference.duration` (with `error.type` on failure), `gen_ai.client.inference.time_to_first_chunk`, `gen_ai.client.inference.time_per_output_chunk` per chunk after the first, `gen_ai.client.inference.usage.input_tokens` counter with `gen_ai.token.modality: 'text'` (and value 0 + `unknown` when no `done`), `gen_ai.client.inference.operation.input_tokens` histogram without modality.
  - `Session.streamChatTurn` keeps `doneReason` on the aggregated message.
- [ ] **Step 2: Run** `pnpm --filter @mokei/session exec vitest run test/inference-tracing.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Span starts when `start()` is called (sampling-relevant attributes at creation); the wrapped stream is a `ReadableStream` whose `pull` reads the inner reader and whose `cancel` ends the span with `cancelled`. Fix `chunkToServerMessage` to copy `reason` into `doneReason`.
- [ ] **Step 4: Run** session and session-node `test` (including `rn-bundle.test.ts`) — expect PASS.
- [ ] **Step 5: Commit** `feat(session): GenAI inference spans and metrics`

### Task 9: Tool call attribution and local `execute_tool` spans

**Files:**
- Modify: `packages/context-rpc/src/rpc.ts:75-118` (`RequestOptions.traceAttributes`), `packages/context-client/src/client.ts` (pass to `startOutgoing`), `packages/context-client/src/client-tracing.ts`, `packages/host/src/host.ts` (`NamespacedToolParams`, `callLocalTool` 820-), `packages/session/src/session.ts` (`executeToolCall` 413-422)
- Test: `packages/host/test/local-tools.test.ts`, `packages/session/test/local-tools.test.ts`, `packages/context-client/test/client-tracing.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; Task 6 `syntheticToolCallIDs`.
- Produces:
  - `RequestOptions.traceAttributes?: Record<string, string>` — removed by `splitRequestOptions`, merged into the outgoing span's attributes
  - `NamespacedToolParams` inherits it; `callLocalTool` starts `execute_tool {name}` (`INTERNAL`) with `gen_ai.operation.name: 'execute_tool'`, `gen_ai.tool.name`, `gen_ai.tool.type: 'function'`, `gen_ai.tool.description` when known, the trace attributes, opt-in `gen_ai.tool.call.arguments`/`gen_ai.tool.call.result`; `error.type` = error `name` or `tool_error` for `isError` results
  - `Session.executeToolCall(params & { traceAttributes?: Record<string, string> })` adds `gen_ai.tool.call.id: toolCall.id` unless the provider's `telemetry.syntheticToolCallIDs`

- [ ] **Step 1: Write failing tests** — a namespaced MCP tool call with `traceAttributes: { 'gen_ai.tool.call.id': 'call_1' }` produces a `tools/call` span with `gen_ai.tool.call.id: 'call_1'` and the server receives `_meta` without that key (inspect the server handler's request); a local tool call produces one `execute_tool notify` span with the attributes above; a throwing local tool sets `error.type`.
- [ ] **Step 2: Run** the three test files — expect FAIL. **Step 3: Implement.** **Step 4: Rebuild** context-rpc, context-client, host; **run** host, session, context-client `test` — expect PASS.
- [ ] **Step 5: Commit** `feat(host): execute_tool spans for local tools and tool call attribution`

### Task 10: `invoke_agent` spans and agent metrics

**Files:**
- Modify: `packages/session/src/agent-types.ts:82-115`, `packages/session/src/agent-session.ts` (`stream` 285-660, `#executeToolCall` 770-)
- Test: `packages/session/test/agent-tracing.test.ts` (create)

**Interfaces:**
- Consumes: Task 8 `traceStreamChat` (via `session.streamChatTurn`); Task 9 `traceAttributes`.
- Produces: `AgentSessionParams.name?: string`, `AgentSessionParams.description?: string`, `AgentRunParams.conversationID?: string`. Each run is wrapped in an `invoke_agent {name}` span (`invoke_agent` when unnamed), kind `INTERNAL`, made active so inference and tool spans become children.

- [ ] **Step 1: Write failing tests** — a run with one tool round produces `invoke_agent helper` → children `chat m`, `tools/call ...` (or `execute_tool ...` for a local tool), `chat m`; root attributes `gen_ai.operation.name: 'invoke_agent'`, `gen_ai.agent.name: 'helper'`, `gen_ai.agent.description`, `gen_ai.request.model`, summed `gen_ai.usage.input_tokens`/`output_tokens`; `gen_ai.conversation.id` present only when `conversationID` is passed; tool spans carry `gen_ai.agent.name` and `gen_ai.conversation.id`; `timeout` and `aborted` finish reasons set `error.type` to `timeout` / `cancelled`; `max-iterations` sets `error.type: 'max_iterations'`. Metrics: `gen_ai.invoke_agent.duration`, `gen_ai.invoke_agent.inference_calls: 2`, `gen_ai.invoke_agent.tool_calls: 1`, `gen_ai.execute_tool.duration` with `gen_ai.tool.name`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/session exec vitest run test/agent-tracing.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** The span must end when the stream completes, errors, or is abandoned (generator `finally`). Keep the existing "yield tool-call-pending before awaiting approval" ordering.
- [ ] **Step 4: Run** session `test` — expect PASS.
- [ ] **Step 5: Commit** `feat(session): invoke_agent spans and agent metrics`

### Task 11: Flow runs as `invoke_workflow`, `mokei.*` run attributes

**Files:**
- Modify: `packages/flow-host/src/tracing.ts`, `packages/app-node/src/{trace-recorder.ts,trace-reader.ts,trace-index.ts}`, `packages/host-protocol/src/trace-schemas.ts`, `monitor/src/traces/{trace-summary.ts,span-tree.ts}`, `monitor/src/components/TraceHeader.tsx`, `integration-tests/suites/flow-daemon.test.ts`
- Test: `packages/flow-host/test/tracing.test.ts`, `packages/app-node/test/{trace-recorder,trace-reader,trace-index}.test.ts`, `monitor/test/*` touching these keys

**Interfaces:**
- Produces: span name `invoke_workflow {flowID}` (`invoke_workflow` without flow ID) for start and resume; attributes `gen_ai.operation.name: 'invoke_workflow'`, `gen_ai.workflow.name` (= flow ID), `mokei.kind: 'flow'`, `mokei.root`, `mokei.run.id`, `mokei.flow.id`, `mokei.run.label`, `mokei.run.resumed: true` on resume; event `mokei.run.state` with attribute `mokei.run.state`; failed state ends with `error.type: 'failed'`; `gen_ai.invoke_workflow.duration` metric on terminal state. Summary attribute keys `mokei.run.id`, `mokei.flow.id`, `mokei.context.id`, `label`.

- [ ] **Step 1: Update tests** to the new names and keys (grep `'run.id'`, `'flow.id'`, `'run.label'`, `'run.state'`, `flow.run` across `packages/*/test`, `monitor/test`, `integration-tests`) and add the `gen_ai.*` and metric assertions.
- [ ] **Step 2: Run** flow-host, app-node, host-protocol, monitor tests — expect FAIL.
- [ ] **Step 3: Implement** the renames with no fallback to old keys (clean break).
- [ ] **Step 4: Rebuild** changed packages; **run** their tests and `pnpm --filter ./integration-tests test -- flow-daemon` — expect PASS.
- [ ] **Step 5: Commit** `feat(flow-host)!: invoke_workflow spans and mokei.* run attributes`

### Task 12: System One `predict` span

**Files:**
- Modify: `packages/decision-flow/src/decide-node.ts:55-125`, `packages/system-one-client/src/http.ts` (expose `url`)
- Test: `packages/decision-flow/test/observability.test.ts`

**Interfaces:**
- Produces: span `predict {model}` (`predict` when no model), kind `CLIENT`, `gen_ai.operation.name: 'predict'`, `gen_ai.provider.name: 'mokei.system_one'`, `gen_ai.request.model` (node model), `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `server.address`/`server.port` when the client exposes `url`, `http.response.status_code`, `mokei.system_one.question.count`, `mokei.system_one.retry_after_ms`, `mokei.kind: 'step'`; metric `gen_ai.client.operation.duration` (`GEN_AI_DURATION_BUCKETS` values copied locally) with `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`, `error.type`. Tracer via a local `trace.getTracer('mokei.decision-flow', undefined, { schemaUrl })` with a local copy of the schema URL constant (decision-flow does not depend on context-client).

- [ ] **Step 1: Update tests** to the new keys and name; assert no `system_one.*` or `http.status_code` keys remain.
- [ ] **Step 2: Run** `pnpm --filter @mokei/decision-flow exec vitest run test/observability.test.ts` — expect FAIL. **Step 3: Implement.** **Step 4: Run** decision-flow and system-one-client `test` — expect PASS.
- [ ] **Step 5: Commit** `feat(decision-flow): predict span follows GenAI conventions`

### Task 13: Telemetry setup, schema URL tracers, config

**Files:**
- Modify: `pnpm-workspace.yaml` (catalog), `packages/app-node/{package.json,src/telemetry.ts,src/config.ts}`, `packages/cli/src/daemon-entry.ts`, `packages/flow-host/src/tracing.ts`, `packages/host/src/host.ts:42`, `packages/host-node/src/proxy-tracing.ts:16`
- Test: `packages/app-node/test/telemetry-otlp.test.ts`, `packages/app-node/test/telemetry.test.ts`, `packages/app-node/test/config.test.ts`

**Interfaces:**
- Consumes: Task 1 `getMokeiTracer`; Task 4 `TraceParentFrom`.
- Produces:
  - `setupMokeiTelemetry` params gain `service?: { name?: string; version?: string }`; `otlp.metricsEndpoint?: string`
  - `MokeiConfig.tracing` gains `parentFrom?: TraceParentFrom` and `otlp.metricsEndpoint?: string` (schema-validated); daemon passes them through
  - every remaining `createTracerFactory('mokei')` site uses `getMokeiTracer(scope)`

- [ ] **Step 1: Write failing tests** — exported spans carry resource `service.name: 'mokei'` (and the configured name); with `otlp.endpoint: 'http://c:4318/v1/traces'` a metric recorded through `metrics.getMeter` reaches a mock server at `/v1/metrics` on `dispose()`; with a custom `metricsEndpoint` it goes there; with `endpoint: 'http://c:4318/custom'` and no `metricsEndpoint` no meter provider is registered; `dispose()` shuts down and unregisters the meter provider; config accepts `parentFrom: 'meta'` and rejects `'other'`.
- [ ] **Step 2: Run** the app-node tests — expect FAIL.
- [ ] **Step 3: Implement** with `resourceFromAttributes`, `MeterProvider({ resource, readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url, headers }) })] })`, `metrics.setGlobalMeterProvider`, and rollback/dispose entries matching the trace provider's. Add the global-meter-already-registered guard alongside the existing tracer guard.
- [ ] **Step 4: Run** app-node, cli, flow-host, host, host-node `test` — expect PASS.
- [ ] **Step 5: Commit** `feat(app-node): resource, OTLP metrics and semconv schema URL`

### Task 14: Docs and changeset

**Files:**
- Modify: `docs/agents/architecture.md` (telemetry section: span catalogue, metrics, content gate, `parentFrom`), `packages/app-node/README.md` (config keys), `packages/flow-host-node/README.md` if it lists span keys
- Create: `.changeset/otel-genai-semconv.md` via `pnpm change` (patch, all public packages per `versioning.fixed`); note the breaking run-attribute rename and the span renames
- Create: upstream request doc for `@sozai/otel` `createTracerFactory(prefix, version?, options?: { schemaUrl?: string })` in the sozai repo's `docs/agents/plans/backlog/`

- [ ] **Step 1:** Write the docs and changeset; `pnpm change status` shows a patch for every public package.
- [ ] **Step 2: Run** `pnpm build && pnpm test && rtk proxy pnpm run lint` — expect all green.
- [ ] **Step 3: Commit** `docs: GenAI semantic conventions telemetry`
