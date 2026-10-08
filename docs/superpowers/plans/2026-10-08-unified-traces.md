# Unified Traces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One OpenTelemetry trace model for flow runs, flow steps and MCP traffic, recorded locally by a single recorder, streamed live, and shown on a new monitor Traces page.

**Architecture:** MCP spans come from two producers sharing one observation helper: an exchange seam in `ContextClient` (in-process clients, bound to a `mcp.context` span opened by `ContextHost`) and a correlator in the daemon's `spawn` proxy. A `LocalTraceRecorder` in `@mokei/app-node` replaces the local batch exporter and log sink: it keeps open spans in memory, writes ended spans, logs and trace summaries in one transaction per flush, and emits live `span:*` / `log` / `trace:summary` events. The monitor gets one host-level connection and a two-pane Traces page.

**Tech Stack:** TypeScript, OpenTelemetry JS (`@opentelemetry/api`, `sdk-trace-base`), `@sozai/otel`, hozon stores (Kysely migrations), LogTape, Enkaku RPC over HTTP/SSE, React + TanStack Router + Mantine + Jotai, vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-unified-traces-design.md`

## Global Constraints

- Payload capture setting `tracing.payloads: 'on' | 'off' | number`; `'on'` (default) = cap of 65536 bytes.
- Redaction `_meta` allow-list: `traceparent`, `dev.mokei/flow-run`. Secret-key pattern: `/authorization|token|secret|password|api[-_]?key|cookie|credential/i`, value replaced with `"[redacted]"`, at any depth (objects and arrays).
- Recorder defaults: write queue 10000 entries; flush every 250 ms or at 200 entries; retry backoff 250 ms, 1 s, 4 s then drop; dirty-summary cap 1000.
- Daemon events per-subscriber bound: 2000 queued events, then end that subscriber's stream.
- `traces.get` log cap: newest 1000; `logsTruncated` when more exist.
- Span attribute names: `mokei.kind` (`context` | `mcp` | `flow` | `step`), `mokei.root`, `mokei.context.id`, `mokei.direction`, `mokei.mcp.request`, `mokei.payload.truncated`, `mcp.method.name`, `gen_ai.tool.name`, `mcp.session.id`, `jsonrpc.request.id`, `error.type`.
- Span names: `mcp.context`, `mcp.<method>`; response event `mcp.response`; notification log category `['mokei', 'mcp', 'notification']`.
- `error.type` values: JSON-RPC error code as string, `tool_error`, `cancelled`, `context.lost`, `context.stopped`.
- No new packages. Kebab-case file names; React components PascalCase, hooks camelCase. `pnpm` only.
- Own field names use `ID` casing (`traceID`, `spanID`, `logID`); external wire fields keep their casing (`requestId`).
- `_meta` keys use the `dev.mokei/` namespace.
- Committed docs never reference local paths, worktrees or sibling checkouts.
- Release: one patch changeset on the 0.14.x line.
- Lint with `rtk proxy pnpm run lint`. Package tests: `pnpm --filter <pkg> test`; single file: `pnpm --filter <pkg> exec vitest run <file>`. Cross-package tests resolve built `lib/`: run `pnpm --filter <dep> build` after changing a dependency.

## Review Focus

1. **Tool results carrying large binary content** (base64 images, file reads of several MB): capture must cut at the cap with the truncation flag, never serialise the whole value twice, and never cut inside a UTF-16 surrogate pair. Test in Task 1.
2. **Secrets nested in arrays and in tool arguments** (`{ headers: [{ name: 'x', apiKey: 's' }] }`, `env: { GITHUB_TOKEN: ... }`): redaction recurses through arrays and matches keys case-insensitively. Test in Task 1.
3. **JSON-RPC IDs `1` and `"1"` in flight at once, and both peers using ID `0`**: the proxy correlator keeps them distinct. Test in Task 6.
4. **Daemon restarted while the monitor stays open**: the monitor drops every trace from the old epoch and never shows a pre-restart revision over a post-restart one. Test in Task 16.
5. **A context emitting thousands of progress notifications**: the live subscriber is disconnected at the bound rather than growing memory, and `traces.get` stays capped at 1000 logs. Tests in Tasks 12 and 13.

---

## Stage 1 -- Producers

### Task 1: MCP observation helper

**Files:**
- Create: `packages/context-client/src/observation.ts`
- Modify: `packages/context-client/src/index.ts` (export the module)
- Test: `packages/context-client/test/observation.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PayloadCapture = 'on' | 'off' | number
  export type MessageDirection = 'client' | 'server' // peer that sent the request
  export const DEFAULT_PAYLOAD_CAP = 65536
  export function resolvePayloadCap(capture: PayloadCapture | undefined): number | null // null = off
  export function redactPayload(value: unknown): unknown
  export function capturePayload(value: unknown, capture: PayloadCapture | undefined):
    { payload: string; truncated: boolean } | undefined
  export function requestSpanName(method: string): string // `mcp.${method}`
  export function requestAttributes(params: {
    method: string; params?: unknown; id?: string | number; direction: MessageDirection
    contextID?: string; sessionID?: string; capture?: PayloadCapture
  }): Attributes
  export function responseOutcome(message: { result?: unknown; error?: { code: number } }):
    { error: false } | { error: true; errorType: string }
  export function sanitizeMessage(message: unknown, capture: PayloadCapture | undefined): unknown
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('redactPayload drops non-allow-listed _meta keys', () => {
  expect(redactPayload({ _meta: { traceparent: 't', baggage: 'b', tracestate: 's',
    'dev.mokei/flow-run': 'r', 'dev.mokei/grant': 'g' }, a: 1 }))
    .toEqual({ _meta: { traceparent: 't', 'dev.mokei/flow-run': 'r' }, a: 1 })
})
test('redactPayload replaces secret-pattern keys at any depth, through arrays', () => {
  expect(redactPayload({ env: { GITHUB_TOKEN: 'x' }, headers: [{ name: 'n', apiKey: 'k' }],
    Authorization: 'Bearer y', nested: { 'api-key': 'z', client_secret: 'w' } }))
    .toEqual({ env: { GITHUB_TOKEN: '[redacted]' }, headers: [{ name: 'n', apiKey: '[redacted]' }],
      Authorization: '[redacted]', nested: { 'api-key': '[redacted]', client_secret: '[redacted]' } })
})
test('capturePayload honours on, off and byte caps', () => {
  expect(capturePayload({ a: 1 }, 'off')).toBeUndefined()
  expect(capturePayload({ a: 1 }, 'on')).toEqual({ payload: '{"a":1}', truncated: false })
  const big = { data: 'x'.repeat(70000) }
  const on = capturePayload(big, 'on')
  expect(on?.truncated).toBe(true)
  expect(new TextEncoder().encode(on?.payload).length).toBeLessThanOrEqual(65536)
  expect(capturePayload(big, 100)?.payload.length).toBeLessThanOrEqual(100)
})
test('capturePayload never splits a surrogate pair', () => {
  const out = capturePayload({ s: '😀'.repeat(50) }, 41)
  expect(out?.payload).not.toMatch(/[\uD800-\uDBFF]$/)
})
test('requestAttributes maps a tools/call request', () => {
  expect(requestAttributes({ method: 'tools/call', params: { name: 'search', arguments: { q: 1 } },
    id: 7, direction: 'client', contextID: 'c1', sessionID: 's1', capture: 'on' }))
    .toEqual({ 'mokei.kind': 'mcp', 'mcp.method.name': 'tools/call', 'gen_ai.tool.name': 'search',
      'jsonrpc.request.id': '7', 'mokei.direction': 'client', 'mokei.context.id': 'c1',
      'mcp.session.id': 's1', 'mokei.mcp.request': '{"name":"search","arguments":{"q":1}}' })
})
test('requestAttributes sets mokei.payload.truncated when the request is cut', () => {
  expect(requestAttributes({ method: 'tools/call', params: { s: 'x'.repeat(200) },
    direction: 'client', capture: 50 })['mokei.payload.truncated']).toBe(true)
})
test('responseOutcome maps JSON-RPC errors and tool errors', () => {
  expect(responseOutcome({ result: {} })).toEqual({ error: false })
  expect(responseOutcome({ error: { code: -32602 } })).toEqual({ error: true, errorType: '-32602' })
  expect(responseOutcome({ result: { isError: true } })).toEqual({ error: true, errorType: 'tool_error' })
})
test('sanitizeMessage redacts and caps, and reduces to the envelope when off', () => {
  const m = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { token: 't' } }
  expect(sanitizeMessage(m, 'on')).toEqual({ ...m, params: { token: '[redacted]' } })
  expect(sanitizeMessage(m, 'off')).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/call' })
  expect(m.params.token).toBe('t') // input not mutated
})
```

- [ ] **Step 2: Run to verify failure** -- `pnpm --filter @mokei/context-client exec vitest run test/observation.test.ts` -- FAIL, module not found.
- [ ] **Step 3: Implement `observation.ts`.** `redactPayload` returns a new structure (never mutates). `capturePayload` serialises the redacted value once with `JSON.stringify`, then cuts by UTF-8 byte length (`TextEncoder`), backing off to a code-point boundary; when cut and the result is not valid JSON that is fine -- it is a string attribute. `sanitizeMessage` with a cap keeps the message shape and replaces `params` / `result` with the capped string when truncated plus `"dev.mokei/truncated": true`. `Attributes` from `@opentelemetry/api` (add `@opentelemetry/api` catalog dependency).
- [ ] **Step 4: Run to verify pass** -- same command -- PASS.
- [ ] **Step 5: Commit** -- `git commit -m "feat(context-client): MCP observation helper with redaction and payload capture"`

### Task 2: Expose allocated request IDs from `ContextRPC`

**Files:**
- Modify: `packages/context-rpc/src/rpc.ts` (`RequestOptions`, `request()` ~:693, `_registerStreamExchange` ~:738)
- Test: `packages/context-rpc/test/rpc.test.ts`

**Interfaces:**
- Produces: `RequestOptions.onRequestID?: (id: RequestID) => void` and the same option on `_registerStreamExchange`'s `options`. Called synchronously with the allocated ID before the request frame is written.

- [ ] **Step 1: Failing test** -- `test('request reports the allocated ID before writing')`: spy `_write`; call `rpc.request('ping', {}, { onRequestID })`; assert `onRequestID` called once with the `id` of the first written frame, and called before `_write`. Same for `_registerStreamExchange`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/context-rpc exec vitest run test/rpc.test.ts` -- FAIL.
- [ ] **Step 3: Implement** -- call `options?.onRequestID?.(id)` right after allocation in both methods.
- [ ] **Step 4: Run** -- PASS. Then `pnpm --filter @mokei/context-rpc build`.
- [ ] **Step 5: Commit** -- `feat(context-rpc): report allocated request IDs`

### Task 3: `ContextClient` tracing binding and outgoing request spans

**Files:**
- Create: `packages/context-client/src/client-tracing.ts`
- Modify: `packages/context-client/src/client.ts` (`request()` :585-666), `packages/context-client/src/types.ts` (`ClientParams` :118), `packages/context-client/package.json` (add `@opentelemetry/api`; devDeps `@opentelemetry/sdk-trace-base`, `@opentelemetry/context-async-hooks`)
- Create: `packages/context-client/test/support/otel.ts`
- Test: `packages/context-client/test/client-tracing.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; Task 2 `onRequestID`.
- Produces:
  ```ts
  export type TerminationReason = 'stopped' | 'lost'
  export type ClientTracing = { contextID: string; contextSpan?: Span; payloads?: PayloadCapture }
  // ClientParams gains: tracing?: ClientTracing
  // ContextClient gains:
  setTracing(binding: ClientTracing): void
  endTracing(reason: TerminationReason): void // settles every open exchange span once
  ```
  `client-tracing.ts` exports `createExchangeTracer(getBinding: () => ClientTracing | undefined)` returning `{ startOutgoing(method, params, options?: { links?: Array<Link> }): ExchangeSpan; startIncoming(method, params, id, meta?): ExchangeSpan; settleAll(reason): void }` where `ExchangeSpan = { span: Span; context: Context; setID(id): void; succeed(result): void; fail(errorType: string, message?: string): void }` (each settle method is idempotent).
- Test support `test/support/otel.ts`: `useTestTracing(): { exporter: InMemorySpanExporter }` registering a `BasicTracerProvider` with `SimpleSpanProcessor` and `AsyncLocalStorageContextManager` in `beforeAll`, reset in `beforeEach`, disabled in `afterAll` (same pattern as `flow-host/test/tracing.test.ts:27-60`).

- [ ] **Step 1: Failing tests** (client against an in-memory server pair from existing test helpers):
  - `tools/call produces one mcp.tools/call span with attributes and response event` -- assert name, `jsonrpc.request.id` equals the written frame's id, `gen_ai.tool.name`, one `mcp.response` event with `payload`.
  - `the request span is active when traceparent is injected` -- written frame `_meta.traceparent` contains the span's `spanId`.
  - `parent is the active span, with a link to the context span` -- inside `tracer.startActiveSpan('outer')`: span parent = outer; `links[0].context.spanId` = binding `contextSpan` id.
  - `without an active span the parent is the bound context span, no link`.
  - `unbound client parents only to the active span and has no mokei.context.id`.
  - `JSON-RPC error sets ERROR status and error.type '-32601'`; `isError result sets error.type 'tool_error'`.
  - `each MRTR retry leg is its own span linked to the first leg` (use an input-required server fixture).
  - `payloads 'off' records no mokei.mcp.request and no mcp.response payload`.
  - `endTracing('lost') ends an in-flight span with ERROR and error.type 'context.lost'; a later response does not end it again`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/context-client exec vitest run test/client-tracing.test.ts` -- FAIL.
- [ ] **Step 3: Implement.** Tracer: `createTracerFactory('mokei')('context-client')`. In `request()`, start the span before `currentTraceMeta()` and run the rest of the method inside `withActiveContext(exchange.context, ...)`; pass `onRequestID: exchange.setID` to `super.request`. Settle on resolve/reject; JSON-RPC errors map through `responseOutcome`, timeouts and aborts to `error.type = 'cancelled'`. Retry legs: thread the first leg's `SpanContext` through a private `RequestOptions` field so legs 2..n get `links: [{ context: first }]`.
- [ ] **Step 4: Run** -- PASS. `pnpm --filter @mokei/context-client test` -- PASS (no regressions).
- [ ] **Step 5: Commit** -- `feat(context-client): trace outgoing MCP requests`

### Task 4: Setup, subscription and incoming request spans

**Files:**
- Modify: `packages/context-client/src/client.ts` (`#initialize` :697, `#sendDiscover` :883, `#probe` :831, `#setupDiscover` :788, `#openListen` :1140, `_handleRequest` :1291), `packages/context-client/src/setup-reader.ts` (`driveInitialize` :144, `driveDiscover` :177)
- Test: `packages/context-client/test/client-tracing.test.ts`

**Interfaces:**
- Consumes: Task 3 `createExchangeTracer`.
- Produces: `SetupReader` `io` gains `trace?: (method: string, id: RequestID) => ExchangeSpan` used by both drive functions; `driveInitialize` now sends `_meta` from `currentTraceMeta()` inside the span's context.

- [ ] **Step 1: Failing tests:**
  - `initialize produces an mcp.initialize span and the frame carries traceparent`.
  - `discover produces an mcp.server/discover span` (2026 revision fixture).
  - `subscriptions/listen produces one span settled when the stream settles`.
  - `incoming elicitation/create produces a server-direction span parented to the context span, linked to the request _meta.traceparent`.
  - `incoming request cancelled by notifications/cancelled ends with error.type 'cancelled'`.
  - `notifications in either direction become traced log records on the bound context span` -- category `['mokei','mcp','notification']`, properties `{ method, direction, payload }` (payload redacted and capped; absent when `'off'`); an unbound client logs nothing.
- [ ] **Step 2: Run** -- FAIL.
- [ ] **Step 3: Implement** using the exchange tracer at each path; `_handleRequest` wraps the handler: `startIncoming`, `succeed`/`fail`, and `fail('cancelled')` when `signal` aborts. Notifications: hook `_handleNotification` (incoming) and `notify` (outgoing); log through `getMokeiLogger(['mokei','mcp','notification'])` inside the context span's context (add the `@mokei/logger` dependency if absent).
- [ ] **Step 4: Run** -- PASS; `pnpm --filter @mokei/context-client test` -- PASS; `pnpm --filter @mokei/context-client build`.
- [ ] **Step 5: Commit** -- `feat(context-client): trace setup, subscription and incoming exchanges`

### Task 5: Context spans and termination reasons in `ContextHost`

**Files:**
- Modify: `packages/host/src/host.ts` (`ContextHostParams` :149, `registerHostedContext` :345, `createContext` :482, `addHTTPContext` :547, `remove` :691), `packages/host/package.json` (add `@sozai/otel`, `@opentelemetry/api`)
- Modify: `packages/host-node/src/node-host.ts` (`onStreamError` :160-179, `onExit` :180-188)
- Test: `packages/host/test/context-tracing.test.ts`, `packages/host-node/test/node-host.test.ts`

**Interfaces:**
- Consumes: Task 3 `ClientTracing`, `setTracing`, `endTracing`, `TerminationReason`, `PayloadCapture`.
- Produces:
  ```ts
  // ContextHostParams gains: tracing?: { payloads?: PayloadCapture }
  remove(key: string, reason?: TerminationReason): Promise<void> // default 'stopped'
  ```
  Context span: name `mcp.context`, root, attributes `mokei.kind: 'context'`, `mokei.root: true`, `mokei.context.id: key`, `mcp.transport` (`stdio` | `http` | `direct`), server name once initialized, `mcp.session.id` when known.

- [ ] **Step 1: Failing tests:**
  - `createContext opens an mcp.context root span and binds the client` -- a tools/call made through `host` is a child of it.
  - `registerHostedContext binds a caller-built client`.
  - `remove(key) ends the context span OK and open requests with error.type 'context.stopped'`.
  - `remove(key, 'lost') ends the context span and open requests with error.type 'context.lost'`.
  - `client closed without remove settles as lost, exactly once` -- transport EOF, then `remove(key)`: one ended context span with `context.lost`.
  - host-node: `child exit removes the context with reason lost`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/host exec vitest run test/context-tracing.test.ts` -- FAIL.
- [ ] **Step 3: Implement.** Host subscribes to the client's `closed` event; if the key is still registered, it settles spans as `'lost'` (then the normal removal path runs). `remove` settles with its reason before disposing. One `settled` flag per context. `node-host.ts` passes `'lost'` from `onExit` and `onStreamError`.
- [ ] **Step 4: Run** -- PASS; `pnpm --filter @mokei/host test` and `pnpm --filter @mokei/host-node test` -- PASS; build both.
- [ ] **Step 5: Commit** -- `feat(host): context lifetime spans and termination reasons`

### Task 6: `spawn` proxy correlation and sanitised `context:message`

**Files:**
- Create: `packages/host-node/src/proxy-tracing.ts`
- Modify: `packages/host-node/src/daemon-server.ts` (`HandlersContext`, `spawn` :88-166, `HostDaemonParams` :212)
- Test: `packages/host-node/test/proxy-tracing.test.ts`, `packages/host-node/test/daemon-server.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers, Task 3 `TerminationReason`.
- Produces:
  ```ts
  export function createProxyTracing(params: { contextID: string; command: string; args: Array<string>;
    payloads?: PayloadCapture }): {
    observe(from: MessageDirection, message: unknown): void
    end(reason: TerminationReason): void
  }
  // HandlersContext and HostDaemonParams gain: tracing?: { payloads?: PayloadCapture }
  ```

- [ ] **Step 1: Failing tests (proxy-tracing):**
  - `pairs a client request with the server response` -- one `mcp.tools/call` span, parent = `mcp.context`, `mokei.direction: 'client'`.
  - `keys by direction and id type` -- client request id `1`, client request id `"1"`, server request id `1`, all open at once; responses settle the right spans (Review Focus 3).
  - `notifications/cancelled ends the span with error.type 'cancelled' and a late response is ignored`.
  - `request _meta.traceparent becomes a link, not a parent`.
  - `notifications become traced log records on the context span` (category `['mokei','mcp','notification']`, properties `{ method, direction }`).
  - `end('stopped') ends open spans with context.stopped and the context span OK; end('lost') uses context.lost and ERROR`.
- [ ] **Step 2: Failing tests (daemon-server):** `context:message events carry the sanitised copy while forwarded bytes are unchanged` (send a request with `params.token`; the server stub receives `token: 't'`; the event has `'[redacted]'`); `child exit without client abort ends the proxy tracing as lost`.
- [ ] **Step 3: Run** `pnpm --filter @mokei/host-node exec vitest run test/proxy-tracing.test.ts test/daemon-server.test.ts` -- FAIL.
- [ ] **Step 4: Implement.** Tracer `createTracerFactory('mokei')('host-node')`. Notification logs through `getMokeiLogger` within the context span's context. In `spawn`, `stopContext` gets a reason: `'lost'` from the child `'exit'` listener when `ctx.signal` is not aborted, `'stopped'` otherwise. The `tap` handlers call `tracing.observe` and dispatch `sanitizeMessage(message, payloads)`.
- [ ] **Step 5: Run** -- PASS; `pnpm --filter @mokei/host-node test` -- PASS.
- [ ] **Step 6: Commit** -- `feat(host-node): trace proxied MCP contexts and sanitise context:message`

### Task 7: Kind and root attributes on flow and step spans

**Files:**
- Modify: `packages/flow-host/src/tracing.ts` (:43-47), `packages/decision-flow/src/decide-node.ts` (:72)
- Test: `packages/flow-host/test/tracing.test.ts`, `packages/decision-flow/test/observability.test.ts`

- [ ] **Step 1: Failing tests** -- `flow.run and flow.run.resume carry mokei.kind 'flow' and mokei.root true`; `decision.predict carries mokei.kind 'step'`.
- [ ] **Step 2: Run** -- FAIL.
- [ ] **Step 3: Implement** -- add the attributes.
- [ ] **Step 4: Run** `pnpm --filter @mokei/flow-host test && pnpm --filter @mokei/decision-flow test` -- PASS.
- [ ] **Step 5: Commit** -- `feat(flow-host): mark flow and step spans with mokei.kind`

## Stage 2 -- Daemon

### Task 8: Protocol schemas and procedures

**Files:**
- Create: `packages/host-protocol/src/trace-schemas.ts`
- Modify: `packages/host-protocol/src/index.ts` (`hostEventSchema` :84-191, `hostInfoResultSchema` :203-215, `protocol` :239, type groups :390-392)
- Test: `packages/host-protocol/test/trace-schemas.test.ts`

**Interfaces:**
- Produces (JSON schemas `as const satisfies Schema`, types via `FromSchema`):
  ```ts
  TraceSummary = { traceID; rootSpanID; activeSegmentSpanID?; kind: 'context'|'mcp'|'flow'|'step';
    name; active: boolean; outcome: 'ok'|'error'|'interrupted'|null; startTime; endTime?;
    attributes: { 'run.id'?; 'flow.id'?; 'mokei.context.id'?; label? };
    spanCount; errorCount; droppedCount; revision }
  OpenSpan = Omit<StoredSpan, 'endTime' | 'status' | 'events'>
  TraceLog = StoredLog & { logID: string }
  TracesListParams = { kind?; active?; outcome?; name?; since?; until?; limit: number; cursor?: string }
  TracesListResult = { traces: Array<TraceSummary>; cursor?: string }
  TracesGetResult = { summary: TraceSummary; spans: Array<StoredSpan | OpenSpan>;
    logs: Array<TraceLog>; logsTruncated: boolean }
  TracingInfo = { lostSummaryCount: number; droppedCount: number }
  ```
  Events (`serviceEventMetaSchema` meta): `span:start` (data `OpenSpan`), `span:end` (`StoredSpan`), `log` (`TraceLog`), `trace:summary` (`TraceSummary`). Procedures `traces.list`, `traces.get` (`{ traceID }`). `hostInfoResultSchema` gains optional `tracing: TracingInfo`. New `TraceProcedure = 'traces.list' | 'traces.get'`, excluded from `FlowProcedure`; `TraceProtocol = Pick<Protocol, TraceProcedure>`.

- [ ] **Step 1: Failing tests** -- validators accept a sample of each event and result; `FlowProcedure` does not include `traces.list` (type-level test in `test:types`).
- [ ] **Step 2: Run** `pnpm --filter @mokei/host-protocol test` -- FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** -- PASS; build.
- [ ] **Step 5: Commit** -- `feat(host-protocol): trace events and traces procedures`

### Task 9: `traces` summary store

**Files:**
- Create: `packages/app-node/src/trace-index.ts`
- Modify: `packages/app-node/src/database.ts` (`mokeiStoreDefinitions`), `packages/app-node/src/index.ts`
- Test: `packages/app-node/test/trace-index.test.ts`

**Interfaces:**
- Consumes: Task 8 `TraceSummary`.
- Produces:
  ```ts
  export const traceIndexStoreDefinition: StoreDefinition<TraceIndexTables, TraceIndexStore> // name 'trace-index'
  export function getTraceIndexStore(provider: StoreProvider): Promise<TraceIndexStore>
  export type TraceIndexStore = {
    upsert(summaries: Array<TraceSummary>): Promise<void>
    get(traceID: string): Promise<TraceSummary | undefined>
    list(params: TracesListParams): Promise<TracesListResult>
    listActiveIDs(): Promise<Array<string>>
    markInterrupted(): Promise<number> // active -> inactive, outcome 'interrupted', revision + 1
    deleteByTrace(traceIDs: Array<string>): Promise<number>
    deleteBefore(time: number, params?: { keepTraceIDs?: Array<string> }): Promise<number>
  }
  ```
  Table `traces`: columns for each `TraceSummary` field (`attributes` as json), primary key `trace_id`, indexes on `(start_time)`, `(active)`, `(kind, start_time)`. Follow `flow-host-node/src/run-store.ts:10-64`. `list` orders by `start_time desc, trace_id desc`, cursor = opaque base64 of `[startTime, traceID]`; `name` filter is a case-insensitive substring.

- [ ] **Step 1: Failing tests** (`openMokeiDatabase({ path: ':memory:' })`): upsert then get round-trips; upsert replaces only when `revision` is higher; `list` filters by kind, active, outcome, name, since/until, and pages with cursor; `markInterrupted` flips only active rows and bumps revision; `deleteBefore` honours `keepTraceIDs`; `database.test.ts` lists the new store.
- [ ] **Step 2: Run** `pnpm --filter @mokei/app-node exec vitest run test/trace-index.test.ts` -- FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** -- PASS.
- [ ] **Step 5: Commit** -- `feat(app-node): traces summary store`

### Task 10: `LocalTraceRecorder` -- spans, summaries and the write queue

**Files:**
- Create: `packages/app-node/src/trace-recorder.ts`, `packages/app-node/src/stored-span.ts`
- Test: `packages/app-node/test/trace-recorder.test.ts`

**Interfaces:**
- Consumes: Task 8 types, Task 9 store.
- Produces:
  ```ts
  export function toStoredSpan(span: ReadableSpan): StoredSpan // reimplements @hozon/otel's private converter
  export function toOpenSpan(span: ReadableSpan): OpenSpan
  export type TraceRecorderEvent =
    | { type: 'span:start'; data: OpenSpan } | { type: 'span:end'; data: StoredSpan }
    | { type: 'log'; data: TraceLog } | { type: 'trace:summary'; data: TraceSummary }
  export type TraceRecorderParams = {
    provider: StoreProvider
    onEvent?: (event: TraceRecorderEvent) => void
    queueLimit?: number          // 10000
    flushIntervalMs?: number     // 250
    flushBatchSize?: number      // 200
    retryDelaysMs?: Array<number> // [250, 1000, 4000]
    dirtySummaryLimit?: number   // 1000
    reportError?: (message: string, error: unknown) => void
  }
  export class LocalTraceRecorder implements SpanProcessor {
    constructor(params: TraceRecorderParams)
    onStart(span: Span, parentContext: Context): void
    onEnd(span: ReadableSpan): void
    sink: Sink & { flush(): Promise<void> } // Task 11
    snapshot(traceID?: string): RecorderSnapshot
    sweepInterrupted(): Promise<number>
    info(): TracingInfo
    forceFlush(): Promise<void>
    shutdown(): Promise<void>
  }
  export type RecorderSnapshot = { open: Array<OpenSpan>; spans: Array<StoredSpan>;
    logs: Array<TraceLog>; summaries: Array<TraceSummary> }
  ```
  Summary rules (spec §3): root segment = `mokei.root === true` or no parent. On a root segment start for a trace with no in-memory summary, load the persisted row first (keep `rootSpanID`, counts, `revision`); otherwise create one with `rootSpanID` = this span. `kind` from the root's `mokei.kind` (default `'step'`), `name` from the root, attributes copied from `run.id`, `flow.id`, `mokei.context.id`, `run.label` (as `label`). Every change bumps `revision` and emits `trace:summary`. A non-root span end for a trace with no summary loads or synthesises one (`active: false`).

- [ ] **Step 1: Failing tests** (real `BasicTracerProvider` with the recorder as its processor, in-memory database, fake timers):
  - `emits span:start then span:end then trace:summary in order`.
  - `flush writes spans and summaries in one transaction` -- spy `provider.withTransaction`, one call per flush; after flush `getTelemetryStore(...).getSpans` and `getTraceIndexStore(...).get` both see the data.
  - `flushes at 200 entries without waiting for the interval`.
  - `write failure retries at 250/1000/4000 ms, then drops and increments droppedCount` (stub the store to throw).
  - `queue overflow drops the oldest entries and counts them`.
  - `dirty-summary cap drops the oldest inactive summary and increments lostSummaryCount; active summaries are kept`.
  - `snapshot returns entries until their transaction commits, and an entry committed mid-read is returned once after merge` (pause the flush transaction with a deferred).
  - `resume segment reactivates the persisted row, keeping rootSpanID and continuing revision`.
  - `running trace with a failed child is active with errorCount 1`.
  - `sweepInterrupted marks persisted active rows interrupted and bumps revision`.
  - `shutdown flushes the queue`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/app-node exec vitest run test/trace-recorder.test.ts` -- FAIL.
- [ ] **Step 3: Implement.** `onStart` / `onEnd` only mutate memory and enqueue. Flush is serialised (one in flight). Within the transaction use `getTelemetryStore(tx)`, `getLogStore(tx)`, `getTraceIndexStore(tx)`. Entries are removed from the queue only after commit.
- [ ] **Step 4: Run** -- PASS.
- [ ] **Step 5: Commit** -- `feat(app-node): local trace recorder`

### Task 11: Recorder log sink, config and telemetry wiring

**Files:**
- Modify: `packages/app-node/src/trace-recorder.ts` (the `sink`), `packages/app-node/src/telemetry.ts` (:29-147), `packages/app-node/src/config.ts`, `packages/app-node/src/index.ts`
- Test: `packages/app-node/test/trace-recorder.test.ts`, `packages/app-node/test/telemetry*.test.ts`, `packages/app-node/test/config.test.ts`

**Interfaces:**
- Consumes: Task 10.
- Produces:
  ```ts
  // MokeiConfig.tracing gains: payloads?: PayloadCapture (default 'on' after load)
  export function setupMokeiTelemetry(params: {
    provider: StoreProvider
    onEvent?: (event: TraceRecorderEvent) => void
    otlp?: { endpoint: string; headers?: Record<string, string> }
    logs?: { level?: LogLevel; file?: boolean }
    reportCategories?: ReadonlyArray<ReadonlyArray<string>>
  }): { recorder: LocalTraceRecorder; dispose(): Promise<void> }
  ```
  The `logStore` / `telemetryStore` params are replaced by `provider`. Logs persist `logID` as `properties['dev.mokei/logID']`; `TraceLog.logID` is read back from there.

- [ ] **Step 1: Failing tests:**
  - sink: `traced log records get a logID, are queued and emitted as log events`; `untraced records are ignored`; `the hozon category and report categories are excluded` (same filters as `createLogStoreSink` today).
  - telemetry: `the recorder replaces the local batch exporter` (a span ends, flush, stored); `OTLP keeps its own batch processor`; `dispose flushes the recorder before returning`. Update the existing telemetry tests to the new params.
  - config: `tracing.payloads accepts 'on', 'off' and a positive integer; defaults to 'on'; rejects 'maybe'`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/app-node test` -- FAIL.
- [ ] **Step 3: Implement.** Sink is synchronous; trace context from `trace.getActiveSpan()`; message via `renderLogMessage`, properties via `toJSONValue` (both from `@hozon/logtape` / `@sozai/json`, as the existing sink does).
- [ ] **Step 4: Run** -- PASS; build `@mokei/app-node`.
- [ ] **Step 5: Commit** -- `feat(app-node): recorder log sink and telemetry wiring`

### Task 12: Trace reader

**Files:**
- Create: `packages/app-node/src/trace-reader.ts`
- Modify: `packages/app-node/src/index.ts`
- Test: `packages/app-node/test/trace-reader.test.ts`

**Interfaces:**
- Consumes: Tasks 9-11.
- Produces:
  ```ts
  export type TraceReader = {
    list(params: TracesListParams): Promise<TracesListResult>
    get(traceID: string): Promise<TracesGetResult | undefined>
  }
  export function createTraceReader(params: { provider: StoreProvider; recorder: LocalTraceRecorder;
    logLimit?: number /* 1000 */ }): TraceReader
  ```
  Both methods take `recorder.snapshot()` **before** reading the database, then merge: spans by `spanID` (ended beats open), logs by `logID`, summaries by higher `revision`. `list` overlays in-memory summaries that match the filters (and inserts active ones in order). `get` synthesises a summary from the spans when no row and no in-memory summary exist (`revision: 0`, `active: false`, `outcome` from the root status). Logs sorted by timestamp, newest `logLimit` kept.

- [ ] **Step 1: Failing tests:** `get returns open spans from the recorder`; `get returns a span committed between snapshot and read exactly once`; `get synthesises a summary for a trace with spans but no row`; `get caps logs at 1000 and sets logsTruncated` (1500 notification logs, Review Focus 5); `list overlays a newer in-memory summary over the stored row`; `get returns undefined for an unknown trace`.
- [ ] **Step 2: Run** -- FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** -- PASS; build.
- [ ] **Step 5: Commit** -- `feat(app-node): trace reader merging recorder and store`

### Task 13: Daemon server -- live events, subscriber bound, trace handlers, info

**Files:**
- Create: `packages/host-node/src/trace-handlers.ts`
- Modify: `packages/host-node/src/daemon-server.ts` (events handler :55-83, `info` :84, `EVENT_TYPES` :170-178, `HostDaemonParams` :212)
- Test: `packages/host-node/test/daemon-server.test.ts`, `packages/host-node/test/trace-handlers.test.ts`

**Interfaces:**
- Consumes: Task 8 protocol types; a `TraceReader`-shaped object (structural type declared in `trace-handlers.ts`, no `app-node` import).
- Produces:
  ```ts
  export function createTraceHandlers(params: { reader: { list(p: TracesListParams): Promise<TracesListResult>;
    get(traceID: string): Promise<TracesGetResult | undefined> } }): ProcedureHandlers<TraceProtocol>
  // HostDaemonParams gains: tracingInfo?: () => TracingInfo; eventBufferLimit?: number (2000)
  ```
  `traces.get` for an unknown trace rejects with a `NotFound` error code consistent with existing handlers.

- [ ] **Step 1: Failing tests:**
  - `forwards span:start, span:end, log and trace:summary events`.
  - `a subscriber that does not read is disconnected after 2000 queued events; others keep receiving` (Review Focus 5).
  - `info includes tracing when tracingInfo is provided`.
  - trace-handlers: `traces.list and traces.get delegate to the reader; unknown trace is NotFound`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/host-node test` -- FAIL.
- [ ] **Step 3: Implement.** Per subscriber: a counter of writes not yet resolved plus `writer.desiredSize`; when the counter reaches the limit, abort the subscription (closing the stream) instead of writing.
- [ ] **Step 4: Run** -- PASS; build.
- [ ] **Step 5: Commit** -- `feat(host-node): live trace events, subscriber bound and traces handlers`

### Task 14: Flow host -- retention and the `runs.trace` adapter

**Files:**
- Modify: `packages/flow-host-node/src/trace-store.ts` (:8-47), `packages/flow-host/src/prune-runs.ts` (:8, :56-58), `packages/flow-host/src/trace-store.ts` (type + memory store), `packages/flow-host-node/src/handlers.ts` (:41-49)
- Test: `packages/flow-host/test/prune-runs.test.ts`, `packages/flow-host-node/test/trace-store.test.ts`, `packages/flow-host-node/test/handlers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // flow-host TraceStore gains: listActiveTraceIDs(): Promise<Array<string>>
  // createFlowTraceStore(provider, params?: { index?: { deleteByTrace(ids): Promise<number>;
  //   deleteBefore(time, p?: { keepTraceIDs? }): Promise<number>; listActiveIDs(): Promise<Array<string>> } })
  ```
  The CLI passes the Task 9 store as `index`. Deletions run inside the existing `withTransaction` and delete summary rows for the same trace IDs.

- [ ] **Step 1: Failing tests:** `pruneRuns keeps traces that are active in the index`; `deleteTraces and deleteBefore remove summary rows in the same transaction`; `runs.trace returns only ended spans and logs without logID` (store a span and a log with `dev.mokei/logID`; result validates against the existing `runs.trace` result schema).
- [ ] **Step 2: Run** `pnpm --filter @mokei/flow-host test && pnpm --filter @mokei/flow-host-node test` -- FAIL.
- [ ] **Step 3: Implement.** `runs.trace` strips `dev.mokei/logID` from `properties`.
- [ ] **Step 4: Run** -- PASS; build both.
- [ ] **Step 5: Commit** -- `feat(flow-host): keep active traces and prune summaries`

### Task 15: Daemon entry wiring and end-to-end tests

**Files:**
- Modify: `packages/cli/src/daemon-entry.ts` (:54, :85-131), `packages/flow-host-node/src/service.ts` (pass `tracing.payloads` to the flow host's `ContextHost`)
- Test: `packages/cli/test/daemon-entry.test.ts`, `integration-tests/` (new `unified-traces.test.ts`, following the existing daemon integration tests there)

**Interfaces:**
- Consumes: everything above.
- Wiring order in `startMokeiDaemonWithDependencies`: `loadConfig` → `openDatabase` → `setupTelemetry({ provider, onEvent: (e) => events.dispatchEvent(new CustomEvent(e.type, { detail: { meta: { eventID, time }, data: e.data } })) })` → `await recorder.sweepInterrupted()` → `createFlowService` (with `tracing.payloads` and the index for `createFlowTraceStore`) → `serveHostDaemon({ ..., handlers: composeHandlers(createFlowHandlers(service), createMonitorHandlers(presence), createTraceHandlers({ reader: createTraceReader({ provider, recorder }) })), tracing: { payloads }, tracingInfo: () => recorder.info() })` → `service.start()`. `events` must be created before `setupTelemetry`.

- [ ] **Step 1: Failing tests:**
  - daemon-entry: `sweepInterrupted runs before service.start` (dependency order spy).
  - integration: `a flow run that calls a tool yields one trace with flow.run above mcp.tools/call, linked to the context trace`; `a spawned proxied context yields a context trace with paired request spans`; `restart marks an active run's trace interrupted, then recovery reactivates it`; `live events arrive on the events stream before the trace is persisted`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/cli test` and the integration test file -- FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** -- PASS; `pnpm test` -- PASS; `rtk proxy pnpm run lint` -- clean.
- [ ] **Step 5: Commit** -- `feat(cli): wire the trace recorder into the daemon`

## Stage 3 -- Monitor

### Task 16: Host connection owner

**Files:**
- Create: `monitor/src/host/HostConnectionProvider.tsx`, `monitor/src/host/useHostConnection.ts`
- Modify: `monitor/src/flow/FlowProvider.tsx` (:72, :101, :128, :137), `monitor/src/routes/__root.tsx` (:82-100)
- Delete: `monitor/src/hooks.ts` (`useHostEvents`), `monitor/src/state.ts` (`hostEventsAtom`), `useEventsStream` in `monitor/src/host/hooks.ts`
- Test: `monitor/test/HostConnectionProvider.test.tsx`, update `monitor/test/FlowProvider.test.tsx`; delete `monitor/test/host-events.test.tsx` and the `useHostEvents` cases in `monitor/test/hooks.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  type HostConnection = {
    client: Client<Protocol>; epoch: number; connected: boolean
    subscribe<T extends HostEvent['type']>(types: Array<T>,
      listener: (event: Extract<HostEvent, { type: T }>, epoch: number) => void): () => void
    info: HostInfoResult | undefined
  }
  export function useHostConnection(): HostConnection
  ```
  Exactly one `events` stream per epoch. `FlowProvider` reads `client`, `epoch`, `connected` and events from it (its own two streams are removed); its `on(listener)` API stays for existing consumers. Every event is delivered with the epoch it arrived in.

- [ ] **Step 1: Failing tests:** `opens one events stream and dispatches by type`; `reconnect increments epoch and reopens one stream`; `FlowProvider receives run:state through the connection` (existing FlowProvider tests adapted); `events from a previous epoch are not delivered after reconnect` (Review Focus 4).
- [ ] **Step 2: Run** `pnpm --filter monitor exec vitest run test/HostConnectionProvider.test.tsx test/FlowProvider.test.tsx` -- FAIL.
- [ ] **Step 3: Implement.** Move the connection, restart and 403 handling from `FlowProvider` into the new provider; `__root.tsx` order becomes `JotaiProvider > MantineProvider > HostConnectionProvider > FlowProvider > PresenceProvider > MonitorApp`.
- [ ] **Step 4:** Replace the body of `monitor/src/routes/index.tsx` (the events table, which used `useHostEvents`) with a redirect to `/runs`; Task 19 retargets it to `/traces`. Run `pnpm --filter monitor test` -- PASS.
- [ ] **Step 5: Commit** -- `feat(monitor): single host connection owner`

### Task 17: Trace data hooks and merge reducers

**Files:**
- Create: `monitor/src/traces/trace-merge.ts`, `monitor/src/traces/useTraceList.ts`, `monitor/src/traces/useTrace.ts`
- Test: `monitor/test/trace-merge.test.ts`, `monitor/test/trace-hooks.test.tsx`

**Interfaces:**
- Consumes: Task 16 `useHostConnection`; Task 8 types.
- Produces:
  ```ts
  // trace-merge.ts
  export function mergeSummaries(current: Map<string, TraceSummary>, incoming: Array<TraceSummary>): Map<string, TraceSummary>
  export type TraceState = { summary?: TraceSummary; spans: Map<string, StoredSpan | OpenSpan>; logs: Map<string, TraceLog>; logsTruncated: boolean }
  export function applySpan(state: TraceState, span: StoredSpan | OpenSpan): TraceState // ended beats open; open never replaces ended
  export function applyLog(state: TraceState, log: TraceLog): TraceState
  export function applySnapshot(state: TraceState, result: TracesGetResult): TraceState
  // hooks
  export function useTraceList(filters: TraceListFilters): { traces: Array<TraceSummary>; loadMore(): void; loading: boolean }
  export type TraceListFilters = { kind?: TraceSummary['kind']; active?: boolean; outcome?: TraceSummary['outcome']; name?: string; since?: number; until?: number }
  export function useTrace(traceID: string | undefined): { state: TraceState | undefined; loading: boolean; notFound: boolean }
  ```
  Both hooks subscribe through the connection before querying, buffer events until the query resolves, tag the query with its epoch, drop results whose epoch is stale, and reset all state when the epoch changes. `useTrace` keeps only events whose `traceID` matches and resets on `traceID` change. `useTraceList` pages with 50 per call; active traces sort first, then `startTime` desc.

- [ ] **Step 1: Failing tests:** reducers -- higher revision wins, equal or lower ignored; ended span replaces open, open does not replace ended; logs dedupe by `logID`; snapshot merged with buffered events. Hooks -- `events received before the query resolves are applied after it`; `a query result from a previous epoch is ignored`; `epoch change clears summaries even if old revisions were higher` (Review Focus 4); `selection change discards the previous trace`.
- [ ] **Step 2: Run** `pnpm --filter monitor exec vitest run test/trace-merge.test.ts test/trace-hooks.test.tsx` -- FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** -- PASS.
- [ ] **Step 5: Commit** -- `feat(monitor): trace list and trace hooks`

### Task 18: Generic span tree, waterfall and log list

**Files:**
- Modify: `monitor/src/flow/span-tree.ts` → move to `monitor/src/traces/span-tree.ts`; `monitor/src/components/TraceWaterfall.tsx` (:19); `monitor/src/components/LogList.tsx` (:5, :45)
- Test: `monitor/test/span-tree.test.ts`, `monitor/test/TraceWaterfall.test.tsx`, `monitor/test/LogList.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function buildTraceTree(spans: Array<StoredSpan | OpenSpan>, summary: TraceSummary | undefined, now: number):
    { roots: Array<SpanNode>; start: number; end: number }
  // SpanNode gains: open: boolean; placeholder: boolean; kind?: string; contextLink?: { traceID: string; spanID: string }
  TraceWaterfallProps = { spans: Array<StoredSpan | OpenSpan>; summary?: TraceSummary; selectedSpanID?: string;
    onSelectSpan(spanID?: string): void; onOpenContext(traceID: string): void; now: number }
  LogListProps = { logs: Array<TraceLog>; spanID?: string }
  ```
  Open spans end at `now` and render with an open bar style. Orphans go under one placeholder node per missing parent ID. When the summary's root span is missing (crash), a placeholder root is built from the summary. `contextLink` is set to the first entry of `span.links` when the span has `mokei.kind: 'mcp'` and at least one link (the producers only link MCP request spans to their context span or a remote caller; a link whose trace is not found opens a not-found state on the trace page). `LogList` keys rows by `logID`.

- [ ] **Step 1: Failing tests:** `open span extends to now`; `orphan renders under a placeholder parent`; `missing root renders a placeholder root from the summary`; `mcp span with a link exposes contextLink`; `LogList keys by logID and filters by spanID`.
- [ ] **Step 2: Run** -- FAIL.
- [ ] **Step 3: Implement**; the waterfall re-renders open bars on a 1 s interval tick passed in as `now`.
- [ ] **Step 4: Run** -- PASS.
- [ ] **Step 5: Commit** -- `feat(monitor): generic trace tree with live and placeholder spans`

### Task 19: Traces pages, redirects and nav

**Files:**
- Create: `monitor/src/routes/traces.tsx` (layout + list), `monitor/src/routes/traces.$traceID.tsx`, `monitor/src/components/TraceList.tsx`, `monitor/src/components/TraceHeader.tsx`, `monitor/src/components/SpanDetail.tsx`
- Modify: `monitor/src/routes/index.tsx` (redirect to `/traces`), `monitor/src/routes/runs.index.tsx` (redirect to `/traces?kind=flow`), `monitor/src/routes/runs.$runID.tsx` (resolve `traceID`, redirect), `monitor/src/components/AppHeader.tsx` (:6-11 → Traces, Flows, Inbox)
- Delete: `monitor/src/flow/useRunTrace.ts`, the old runs page bodies
- Test: `monitor/test/traces-pages.test.tsx`; replace `monitor/test/runs-pages.test.tsx` with redirect tests

**Interfaces:**
- Consumes: Tasks 16-18; existing `useRun`, `useInbox*`, `RunStateBadge`, `SchemaForm`.
- Produces: search params on `/traces`: `kind`, `active`, `outcome`, `name`, `since`, `until`; on `/traces/$traceID`: `span`.
  - `TraceList` groups "Active" and "Recent", shows kind icon, name, live duration, span count, error count, and a dropped marker when `droppedCount > 0`.
  - `TraceHeader` for `flow`: `RunStateBadge` from `useRun(attributes['run.id'])`, flow ID, run ID, pending inbox link, Cancel; for `context`: server name or command, transport, uptime.
  - `SpanDetail` tabs: Overview, Request (`mokei.mcp.request`), Response (`mcp.response` event payload), Events, Logs; a truncation banner when `mokei.payload.truncated`.
  - A banner when `logsTruncated`.

- [ ] **Step 1: Failing tests:** `/ redirects to /traces`; `/runs redirects to /traces?kind=flow`; `/runs/$runID redirects to the run's trace, or to /traces?kind=flow without one`; `trace list shows active traces first and applies the kind filter from the URL`; `selecting a span sets ?span and shows its request and response`; `flow header shows run state and Cancel`; `context header shows transport`; `truncation banners show for truncated payloads and logs`.
- [ ] **Step 2: Run** `pnpm --filter monitor exec vitest run test/traces-pages.test.tsx test/runs-pages.test.tsx` -- FAIL.
- [ ] **Step 3: Implement**; regenerate `routeTree.gen.ts` through the Vite plugin (`pnpm --filter monitor build`).
- [ ] **Step 4: Run** `pnpm --filter monitor test` -- PASS; `pnpm --filter monitor build` -- succeeds.
- [ ] **Step 5: Commit** -- `feat(monitor): Traces page replacing events and runs pages`

### Task 20: Docs, changeset and browser QA

**Files:**
- Modify: `docs/agents/architecture.md`, `docs/agents/plans/next/2026-10-04-flow-monitor-follow-ons.md`
- Create: `docs/agents/plans/backlog/2026-10-08-unified-traces-follow-ons.md` (reverse-link index, Session/Agent spans, newest-first log paging pending the hozon query, removing `context:message`), a `.changeset/` intent via `pnpm change` (patch, all public packages)

- [ ] **Step 1:** Update `architecture.md`: trace model and span table, the two MCP span producers, redaction, `LocalTraceRecorder`, trace index, `traces.*` and live events, `runs.trace` deprecation, subscriber bound. Mark the Runs part of the monitor design pass as covered in the follow-ons plan. Write the backlog file.
- [ ] **Step 2:** `pnpm change` -- patch intent; `pnpm change status` shows 0.14.x patch bumps only.
- [ ] **Step 3: Browser QA** against a running daemon (`./bin/dev.js` after `pnpm build`) with the monitor dev server: start a flow that calls a tool and watch it live; spawn a proxied context from the CLI and call a tool; open a span's Request and Response; filter history by kind and outcome; stop and restart the daemon with the page open and confirm the page reconciles. Record any failures as fixes before committing.
- [ ] **Step 4:** `pnpm build && pnpm test && rtk proxy pnpm run lint` -- all pass.
- [ ] **Step 5: Commit** -- `docs: unified traces architecture, follow-ons and changeset`
