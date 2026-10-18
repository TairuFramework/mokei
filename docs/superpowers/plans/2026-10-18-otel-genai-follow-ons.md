# OTel GenAI Semconv Follow-ons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Stage:** qa
**Mode:** tasks

**Goal:** Count each logical MCP/GenAI operation once and close the small telemetry gaps left by the GenAI semconv alignment.

**Architecture:** `@mokei/context-client` defers `gen_ai.operation.name` on `tools/call` spans to settle time, so suspended MRTR rounds drop it; the same helper serves the daemon proxy, which also flags proxied (already traced) requests and skips their MCP metrics. Context spans gain `mokei.context.transport` for the monitor. `Session` inference spans end on abort and on garbage collection. `decision-flow` moves to the `@sozai/otel` factories.

**Tech Stack:** TypeScript, `@opentelemetry/api` 1.9, `@sozai/otel` 0.3.4, vitest, React (monitor).

**Spec:** `docs/superpowers/specs/2026-10-18-otel-genai-follow-ons-design.md`

## Global Constraints

- Node-free packages (`model-provider`, `host`, `session`, `context-client`) keep passing their `rn-bundle` tests.
- Release intent: patch (0.14.x). Edit the existing `.changeset/otel-genai-semconv.md`; add no new intent.
- No new packages. `@sozai/otel` is added to `@mokei/decision-flow` as `catalog:`.
- Cross-package tests resolve built `lib/`: rebuild the changed dependency (`pnpm --filter <pkg> build`) before testing dependents.
- Lint: `rtk proxy pnpm run lint`. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- New attribute names, verbatim: `mokei.mcp.proxied`, `mokei.mcp.round`, `mokei.context.transport` (values `direct` | `stdio` | `http`).

## Review Focus

1. A `tools/call` that fails with a JSON-RPC error or `isError: true` on its first and only round still carries `gen_ai.operation.name=execute_tool` (deferral must cover every settle path, including `fail`, `failRPC` and `settleAll`). Test in Task 1.
2. A caller-driven MRTR flow (`allowInputRequired: true`, caller retries itself) marks its suspended leg `mokei.mcp.round=0` without `execute_tool` and emits no local-failure span. Test in Task 1.
3. A proxied request with a malformed `_meta.traceparent` is not treated as traced: span not flagged, metrics recorded. Test in Task 2.
4. An inference stream whose request signal was already aborted before the first read ends its span exactly once as `cancelled`. Test in Task 4.
5. Stored context spans without `mokei.context.transport` (older rows) still label from `network.*`. Test in Task 3.

---

### Task 1: MRTR round marking and local failure span (`context-client`)

**Files:**
- Modify: `packages/context-client/src/observation.ts` (`requestAttributes`, new `settleAttributes`)
- Modify: `packages/context-client/src/client-tracing.ts` (`start`, `ExchangeSpan` settle paths, `startOutgoing`, new `recordLocalFailure`)
- Modify: `packages/context-client/src/client.ts:331-345, 640-745` (round symbol, leg tracking, local failure)
- Test: `packages/context-client/test/client-tracing.test.ts`, `packages/context-client/test/mrtr.test.ts`, `packages/context-client/test/observation.test.ts`

**Interfaces:**
- Produces (exported from `observation.ts` and the package index):
  - `requestAttributes(params & { deferOperationName?: boolean })`: when `true`, `tools/call` omits `gen_ai.operation.name`. Default `false` (metric labels keep it).
  - `settleAttributes(params: { method: string; inputRequired: boolean; round?: number }): Attributes` — returns `{ 'gen_ai.operation.name': 'execute_tool' }` for `tools/call` when `!inputRequired`; adds `'mokei.mcp.round': round` when `round !== undefined`.
- Produces (`client-tracing.ts`):
  - `startOutgoing(method, params, options?: { links?; traceAttributes?; round?: number })`.
  - `recordLocalFailure(params: { method: string; params: unknown; links: Array<Link>; traceAttributes?: Record<string, string>; round: number; error: unknown }): void`.

- [ ] **Step 1: Write failing tests**

In `observation.test.ts`:
- `requestAttributes({ method: 'tools/call', params: { name: 't' }, direction: 'client', deferOperationName: true })` has no `gen_ai.operation.name`; without the flag it equals `'execute_tool'`.
- `settleAttributes({ method: 'tools/call', inputRequired: false })` → `{ 'gen_ai.operation.name': 'execute_tool' }`; `{ inputRequired: true, round: 0 }` → `{ 'mokei.mcp.round': 0 }`; `{ method: 'prompts/get', inputRequired: false, round: 2 }` → `{ 'mokei.mcp.round': 2 }`.
- `prompts/get` with `arguments: { topic: 'x'.repeat(100) }` and `capture: 10` → `gen_ai.prompt.variable.topic` has 10 bytes and `mokei.payload.truncated === true` (spec decision 4).

In `mrtr.test.ts` (or `client-tracing.test.ts`, alongside the existing MRTR tracing tests), with an in-memory span exporter and a server that suspends `tools/call` once then completes:
- `test('suspended tools/call rounds drop execute_tool and carry the round index')`: two `tools/call` spans; first has `mokei.mcp.round === 0` and no `gen_ai.operation.name`; second has `mokei.mcp.round === 1`, `gen_ai.operation.name === 'execute_tool'`, and a link to the first span's context.
- `test('a single-round tools/call keeps execute_tool and no round')`: one span, `execute_tool`, no `mokei.mcp.round`.
- `test('a failed single-round tools/call keeps execute_tool')`: JSON-RPC error response → span has `execute_tool` and `error.type`; repeat for `isError: true` (`tool_error`). (Review Focus 1)
- `test('caller-driven rounds mark the suspended leg without a local failure span')`: `allowInputRequired: true` → span `mokei.mcp.round === 0`, no `execute_tool`; no `INTERNAL` span. (Review Focus 2)
- `test('a failure between rounds emits one execute_tool INTERNAL span')`: server suspends; the embedded elicitation handler throws → exactly one span named `execute_tool <tool>`, kind `INTERNAL`, `gen_ai.operation.name === 'execute_tool'`, `gen_ai.tool.name`, `mokei.mcp.round === 0`, `error.type` from `errorTypeOf`, status `ERROR`, link to the first round. Repeat with an abort between rounds → `error.type === 'cancelled'`.
- `test('a wire failure on a retry leg emits no local failure span')`: retry leg returns a JSON-RPC error → no `INTERNAL` span.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/context-client && pnpm exec vitest run test/observation.test.ts test/mrtr.test.ts test/client-tracing.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

- `observation.ts`: add `deferOperationName` and `settleAttributes` as above.
- `client-tracing.ts`: span start uses `deferOperationName: true`; the metric path in `finish` keeps the default. Every settle path (`succeed`, `fail`, `failRPC`, `settleAll`) sets `settleAttributes({ method, inputRequired, round })` before ending the span, where `inputRequired = isInputRequiredResult(result)` on `succeed` (import from `./mrtr.js`) and `false` otherwise, and `round` is the `startOutgoing` option, or `0` when the result is `input_required` and no round was passed. Incoming (server) spans also defer and settle the same way. `recordLocalFailure` starts a span `execute_tool ${toolName}` (or `execute_tool`), kind `INTERNAL`, parent `context.active()`, with `gen_ai.operation.name`, `gen_ai.tool.name`, `mokei.mcp.round`, `traceAttributes`, the links, then `endSpanError(span, errorTypeOf(error), message)` (`errorTypeOf` already returns `cancelled` for `AbortError`; map a caller-signal abort reason to `cancelled` too).
- `client.ts`: add `const ROUND = Symbol('round')` to `TracedRequestOptions`; pass `round: options[ROUND]` to `startOutgoing`. Around `runInputRequiredFlow`, track `legs` (starts at 1) and `suspended` (starts `true`): the `retry` callback passes `[ROUND]: legs`, increments `legs`, sets `suspended = false` before awaiting and `suspended = isInputRequiredResult(result)` after. On a rejected flow, when `suspended && method === 'tools/call'`, call `recordLocalFailure` with `round: legs - 1`, links `[{ context: first }]`, `options?.traceAttributes`, then rethrow.

- [ ] **Step 4: Run tests**

Run: `cd packages/context-client && pnpm exec vitest run`
Expected: all pass (including `rn-bundle`/lib tests).

- [ ] **Step 5: Commit**

```bash
git add packages/context-client
git commit -m "feat(context-client): mark MRTR rounds and trace failures between rounds"
```

### Task 2: Daemon proxy — proxied flag, metric skip, rounds, content gate (`host-node`)

**Files:**
- Modify: `packages/host-node/src/proxy-tracing.ts`
- Modify: `packages/host-node/src/daemon-server.ts:183-210` (sanitise with `resolveContentCapture`)
- Test: `packages/host-node/test/proxy-tracing.test.ts`, `packages/host-node/test/daemon-server.test.ts`

**Interfaces:**
- Consumes: `requestAttributes({ deferOperationName })`, `settleAttributes` from Task 1 (rebuild `@mokei/context-client` first).

- [ ] **Step 1: Write failing tests**

In `proxy-tracing.test.ts`:
- `test('a traced request is flagged proxied and records no MCP operation metric')`: client `tools/call` with `_meta.traceparent` = valid W3C value → span has `mokei.mcp.proxied === true`; collected metrics contain no `mcp.client.operation.duration` point for it; span still named `tools/call <tool>`, kind `CLIENT`.
- `test('an untraced request records the metric and is not flagged')`: no `_meta` → metric point present, no `mokei.mcp.proxied`.
- `test('a malformed traceparent is treated as untraced')`: `_meta.traceparent = 'garbage'` → not flagged, metric present. (Review Focus 3)
- `test('a proxied input_required response drops execute_tool')`: response `result` is an `input_required` result → span has no `gen_ai.operation.name` and no `mokei.mcp.round`; a normal result → `execute_tool`.
- `test('context span carries mokei.context.transport stdio')`.

In `daemon-server.test.ts`:
- `test('context:message honours the GenAI content env var')`: `payloads` unset, `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` (set with `vi.stubEnv`) → a proxied message's `context:message` data keeps its payload content; without the env var it is sanitised as today (`'off'`).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mokei/context-client build && cd packages/host-node && pnpm exec vitest run test/proxy-tracing.test.ts test/daemon-server.test.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

- `proxy-tracing.ts`: a request is traced when `remoteContext !== undefined` (already computed from `extractW3CTraceContext`). Store `proxied` on the open entry; set `'mokei.mcp.proxied': true` in span attributes when traced; in `finish`, skip `recordMCPOperation` when `entry.proxied`. Spans start with `deferOperationName: true`; on settle set `settleAttributes({ method, inputRequired: isInputRequiredResult(message.result) })` (no round). Context span adds `'mokei.context.transport': 'stdio'`.
- `daemon-server.ts`: compute `const contentCapture = resolveContentCapture(tracing?.payloads)` once per context and pass it to both `sanitizeMessage` calls.

- [ ] **Step 4: Run tests**

Run: `cd packages/host-node && pnpm exec vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/host-node
git commit -m "feat(host-node): flag proxied calls, skip their metrics, honour content env var"
```

### Task 3: Context transport attribute and monitor label (`host`, `monitor`)

**Files:**
- Modify: `packages/host/src/host.ts:655-680` (context span attributes)
- Modify: `monitor/src/components/TraceHeader.tsx:81-89` (`transportLabel`)
- Test: `packages/host/test/` (existing context-span tracing test file), `monitor/test/traces-pages.test.tsx:186-200`

- [ ] **Step 1: Write failing tests**

- Host: context spans for `direct`, `stdio` and `http` contexts carry `mokei.context.transport` equal to `'direct'`, `'stdio'`, `'http'`; the direct one has no `network.transport`.
- Monitor: extend the `test.each` at `traces-pages.test.tsx:186` with `[{ 'mokei.context.transport': 'direct' }, 'in-process']`, `[{ 'mokei.context.transport': 'stdio' }, 'stdio']`, `[{ 'mokei.context.transport': 'http' }, 'http']`; keep the `network.*`-only rows (Review Focus 5); add `[{}, 'Unknown transport']`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/host && pnpm exec vitest run` and `cd monitor && pnpm exec vitest run test/traces-pages.test.tsx`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

- `host.ts`: add `'mokei.context.transport': transport` to the context span attributes.
- `transportLabel`: read `mokei.context.transport` first (`direct` → `'in-process'`, `stdio` → `'stdio'`, `http` → `'http'`), then the existing `network.*` mapping, then `'Unknown transport'`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @mokei/host build && cd packages/host && pnpm exec vitest run && cd ../../monitor && pnpm exec vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/host monitor
git commit -m "feat(monitor): label in-process contexts from mokei.context.transport"
```

### Task 4: Inference span end on abort and abandonment; provider name docs (`session`, `model-provider`)

**Files:**
- Modify: `packages/session/src/inference-tracing.ts:117-260`
- Modify: `packages/model-provider/README.md` (new `## Telemetry` section)
- Test: `packages/session/test/inference-tracing.test.ts`

- [ ] **Step 1: Write failing tests**

- `test('aborting the request ends the span as cancelled without further reads')`: start a traced stream, read one chunk, call `request.abort()`, do not read again → span ended with `error.type === 'cancelled'`; `gen_ai.client.operation.duration` has one point with `error.type: 'cancelled'`.
- `test('an already aborted signal ends the span once')`: request `signal` aborted before the first read → exactly one ended span, `cancelled`. (Review Focus 4)
- `test('an abandoned stream ends its span when collected')`: run with `node --expose-gc` semantics via `globalThis.gc` (skip the test with `test.skipIf(typeof globalThis.gc !== 'function')` and add `--expose-gc` to this package's vitest `execArgv`/`poolOptions` if not present); drop all references to the stream, `gc()`, await a tick loop → span ended, `error.type === '_OTHER'`, status message `'stream abandoned'`; no `gen_ai.client.operation.duration` point recorded for it.
- `test('a custom provider telemetry name is reported')`: provider with `telemetry: { providerName: 'acme' }` → span `gen_ai.provider.name === 'acme'`; without `telemetry` the attribute is absent.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/session && pnpm exec vitest run test/inference-tracing.test.ts`
Expected: FAIL on abort/abandon tests (the provider-name test may already pass; keep it as a pin).

- [ ] **Step 3: Implement**

- `finish(failure?, options?: { metrics?: boolean })`: `metrics: false` skips metric recording.
- Register `abort` listeners on `inner.signal` and `request.signal` (`{ once: true }`) that call `finish({ type: 'cancelled' })`; remove them in `finish`. Check `aborted` at registration.
- When `typeof FinalizationRegistry !== 'undefined'`, a module-level registry whose held value is the `finish` closure; register the returned decorated stream (target) with an unregister token; `finish` unregisters. The callback calls `finish({ type: '_OTHER', message: 'stream abandoned' }, { metrics: false })`. The held value must not reference the stream.
- README `## Telemetry`: a custom provider sets `telemetry` (`telemetryFromBaseURL('acme', baseURL)` or `{ providerName: 'acme' }`); without it, spans omit `gen_ai.provider.name`.

- [ ] **Step 4: Run tests**

Run: `cd packages/session && pnpm exec vitest run`
Expected: all pass, including `rn-bundle.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/session packages/model-provider/README.md
git commit -m "feat(session): end inference spans on abort and abandonment"
```

### Task 5: decision-flow on `@sozai/otel` factories

**Files:**
- Modify: `packages/decision-flow/package.json` (add `"@sozai/otel": "catalog:"` to `dependencies`), `pnpm-lock.yaml`
- Modify: `packages/decision-flow/src/decide-node.ts:31-60`
- Test: `packages/decision-flow/test/observability.test.ts` (existing schema URL assertions at ~420 must keep passing; add a span `instrumentationScope.schemaUrl` assertion if absent)

- [ ] **Step 1: Write the failing/pinning test** — `predict` span's `instrumentationScope.name === 'mokei.decision-flow'` and `schemaUrl === 'https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev'`.
- [ ] **Step 2: Run** `cd packages/decision-flow && pnpm exec vitest run test/observability.test.ts` — the pin may already pass; it guards the refactor.
- [ ] **Step 3: Implement** — `pnpm install`; replace the provider calls with module-level `createTracerFactory('mokei', undefined, { schemaUrl })` / `createMeterFactory(...)` called with `'decision-flow'`; keep `recordDuration`'s provider-change check by comparing `metrics.getMeterProvider()` as today. Delete the "drop the options argument" comment.
- [ ] **Step 4: Run** `cd packages/decision-flow && pnpm exec vitest run` — all pass.
- [ ] **Step 5: Commit** `git add packages/decision-flow pnpm-lock.yaml && git commit -m "refactor(decision-flow): tracer and meter through @sozai/otel factories"`

### Task 6: Docs and release intent

**Files:**
- Modify: `docs/agents/architecture.md` (~line 391, proxy duplicate / MRTR legs paragraph; context span attributes)
- Modify: `.changeset/otel-genai-semconv.md`

- [ ] **Step 1:** Architecture: replace the "proxy and instrumented caller both emit" note with: traced proxied requests carry `mokei.mcp.proxied` and record no MCP operation metric; MRTR rounds carry `mokei.mcp.round`, only the final round is `execute_tool`, failures between rounds emit one `INTERNAL` `execute_tool` span; context spans carry `mokei.context.transport`; inference spans end on abort or abandonment (span only).
- [ ] **Step 2:** Changeset: add the same points as bullets under the existing entry.
- [ ] **Step 3:** `rtk proxy pnpm run lint` and `rtk proxy pnpm test` — all pass.
- [ ] **Step 4: Commit** `git add docs/agents/architecture.md .changeset && git commit -m "docs: OTel GenAI follow-ons"`
