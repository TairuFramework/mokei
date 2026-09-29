# Decision-flow Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@mokei/decision-flow-server`: an MCP server whose flows call sibling MCP tools from `tool` nodes, decide through System One, ask the user through elicitation, and run as MCP tasks, wired into an `AgentSession` with one approval per run.

**Architecture:** Three small upstream changes (session approval `meta`, a `Predictor` type in `@mokei/decision-flow`, `predict` `outputSchema` in `mcp-servers/system-one`), then the new package built bottom-up: tool caller, `tool` node kind, MCP predictor, definition checks, grants, server tools, run driver, recovery, session wiring. The driver iterates a flow-graph `FlowRun` inside `req.task.run`, checkpointing every committed `RunState` into the task's `resumeData`.

**Tech Stack:** TypeScript (NodeNext ESM), `@sozai/flow-graph` 0.1.0, `@mokei/context-server` task manager, `@mokei/context-client` tasks, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-decision-flow-server-design.md`

## Global Constraints

- pnpm only; lint with `rtk proxy pnpm run lint`; kebab-case file names.
- New package `@mokei/decision-flow-server` in `packages/decision-flow-server` (approved). Add it to `versioning.fixed` in `pnpm-workspace.yaml` (alphabetical, after `@mokei/decision-flow`). No other new package.
- Changeset: one intent, `patch` for `@mokei/decision-flow-server`, `@mokei/decision-flow`, `@mokei/session`, `@mokei/mcp-system-one`. `pnpm change status` must resolve to 0.14.x.
- `@mokei/host` is not modified.
- Meta keys, verbatim: `io.mokei/flow-depth`, `io.mokei/idempotency-key`, `io.mokei/attempt`, `io.mokei/flow-grant`.
- Depth limit: a run at depth 4 or more is refused.
- Grant lifetime: 5 minutes. Grant token: `crypto.randomUUID()`.
- Tool name for a registered flow: `flow_` + `id` with every non `[A-Za-z0-9_]` character replaced by `_` (`support/triage` → `flow_support_triage`).
- Operation keys: tool call `<runID>:<invocationID>`; predictor call `<runID>:<invocationID>:predict`; input key `<runID>:<invocationID>:input:<inputSeq>`.
- Error copy, verbatim: `Invalid flow depth`, `Flow denied`, `Flow checkpoint failed` (code `-32603`), `Flow definition changed` (`-32603`), `Flow no longer valid` (`-32603`, `data: { formatted }`).
- Package template: copy `packages/decision-flow` `package.json` scripts, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`.

## Rulings on spec gaps (found while planning)

- **Allow policy.** `ContextTool.allow` is not enforced anywhere on `main`. The catalogue is `host.getCallableTools()` (enabled context tools plus local tools) minus excluded contexts, minus context tools with `allow === 'never'`. `'ask'` tools stay callable: the run approval covers them.
- **Input `invocationID`.** Use the invocation ID flow-graph recorded for the pending node in the top frame (`frame.attempts[node]?.invocationID`); when absent (the `input` kind does not retry), use `` `${node}.${frame.invocation}` ``. Both are stable across crash recovery because they come from the checkpointed `RunState`.
- **Server check order** for task tools: depth, then definition check, then grant consumption, then `req.task.run`.
- **`'ask'` / `'never'` through `wrapApproval`.** The wrapper is a `ToolApprovalFn`, so `AgentSession` emits `tool-call-pending` itself; the wrapper returns `{ approved: false, reason }` with today's reasons (`Tool approval required but no handler configured`, `Tool execution disabled`).

## Review Focus

1. The agent's turn is aborted while a flow waits on a sibling task: the flow task is cancelled and the sibling task gets `tasks/cancel` (Task 11 test `agent abort cancels run and sibling task`).
2. The same arguments arrive with keys in a different order than approved: the grant still matches, because the digest is over canonical JSON (Task 6 test `grant matches reordered argument keys`).
3. A sibling context is removed after the run starts: the next dispatch fails `tool_unavailable`, not a thrown host error (Task 3 test `removed context is tool_unavailable at dispatch`).
4. A checkpoint after the client cancelled the task stops the run quietly, with no `-32603` settlement (Task 8 test `checkpoint after cancel stops without failing`).
5. A local sibling tool receives `io.mokei/flow-depth` in `meta` (Task 3 test `local tool receives call meta`).

---

### Task 1: Session approval `meta` reaches the tool call

**Files:**
- Modify: `packages/session/src/agent-types.ts` (`ToolApprovalDecision`)
- Modify: `packages/session/src/agent-session.ts` (`#streamToolApproval` ~L703, consumer ~L533, `#executeToolCall` ~L757)
- Modify: `packages/session/src/session.ts` (`ExecuteToolCallParams` L26, `executeToolCall` L409)
- Test: `packages/session/test/agent-approval-meta.test.ts`

**Interfaces:**
- Produces: `ToolApprovalDecision = { approved: boolean; reason?: string; meta?: Record<string, JSONValue> }`; `ExecuteToolCallParams` gains `_meta?: Record<string, JSONValue>`; `Session.executeToolCall` forwards `_meta` to `contextHost.callNamespacedTool({ ..., _meta })`.

- [ ] **Step 1: Write failing tests** with a direct context whose tool echoes `req.meta`, and a mock provider issuing two tool calls:
  - `approval meta is sent as _meta on that call only`: approval fn returns `{ approved: true, meta: { 'io.mokei/flow-grant': 't1' } }` for the first call and `true` for the second; assert first handler saw `{ 'io.mokei/flow-grant': 't1' }`, second saw `{}`.
  - `meta survives a consumer resuming after tool-call-approved` using `stream()` and awaiting between events.
  - `run() forwards approval meta` (same assertion via `run()`).
  - `executeToolCall forwards _meta` on `Session` directly.
- [ ] **Step 2:** `pnpm --filter @mokei/session exec vitest run test/agent-approval-meta.test.ts` — FAIL (meta not forwarded).
- [ ] **Step 3:** Implement. `#streamToolApproval` returns `{ approved, reason?, meta? }` (only from the `ToolApprovalFn` object branch); the loop keeps `meta` beside the tool call and passes it to `#executeToolCall(toolCall, emitEvent, run, meta)`, which passes `_meta: meta` to `session.executeToolCall`.
- [ ] **Step 4:** rerun — PASS; `pnpm --filter @mokei/session test` — PASS.
- [ ] **Step 5:** Commit `feat(session): forward approval meta as tool call _meta`.

### Task 2: `Predictor` type and `call` field in `@mokei/decision-flow`; `predict` structured output

**Files:**
- Modify: `packages/decision-flow/src/decide-node.ts`, `src/decision-graph.ts`, `src/index.ts`
- Modify: `mcp-servers/system-one/src/config.ts` (predict L81-112)
- Test: `packages/decision-flow/test/predictor.test.ts`, `packages/decision-flow/test/public-api.test-d.ts`, `mcp-servers/system-one/test/config.test.ts`

**Interfaces:**
- Produces (`@mokei/decision-flow`):
  ```ts
  export type PredictCall = { runID: string; invocationID: string; attempt: number }
  export type PredictParams = SystemOnePredictParams<QuestionMap> & { call?: PredictCall }
  export type Predictor = { predict(params: PredictParams): Promise<PredictResult<QuestionMap>> }
  ```
  `decideKind({ client: Predictor })` and `DecisionFlowGraphOptions.client: Predictor`; `decideKind` passes `call: { runID, invocationID, attempt }` from its `ExecuteContext`.
- Produces (`@mokei/mcp-system-one`): `predictOutputSchema` exported from `src/config.ts`/`index.ts`; `predict` returns `structuredContent: PredictResult` plus the unchanged JSON text content.

- [ ] **Step 1: Failing tests:** `decide passes call identity to the predictor` (fake predictor records params; assert `call` equals the execute context's runID/invocationID/attempt 1); type test: `SystemOneClient` is assignable to `Predictor`; system-one `predict returns structuredContent matching outputSchema` (validate with `createValidator(predictOutputSchema)` from `@sozai/schema`; text content still `JSON.stringify(result)`).
- [ ] **Step 2:** run both packages' vitest — FAIL.
- [ ] **Step 3:** Implement. `predictOutputSchema`: object `{ model: string, answers: object, usage: { inputTokens: number, outputTokens: number }, extras?: object }`, `required: ['model','answers','usage']`, no top-level `error`. Use `createTool` `outputSchema`.
- [ ] **Step 4:** `pnpm --filter @mokei/decision-flow test && pnpm --filter @mokei/mcp-system-one test` — PASS.
- [ ] **Step 5:** Commit `feat(decision-flow): accept a Predictor with call identity; structured predict output`.

### Task 3: Package scaffold and `ToolCaller`

**Files:**
- Create: `packages/decision-flow-server/{package.json,tsconfig.json,tsconfig.test.json,vitest.config.ts,LICENSE}`, `src/index.ts`, `src/call-meta.ts`, `src/tool-caller.ts`
- Modify: `pnpm-workspace.yaml` (`versioning.fixed`)
- Test: `packages/decision-flow-server/test/tool-caller.test.ts`

Dependencies: `@mokei/context-client`, `@mokei/context-protocol`, `@mokei/context-rpc`, `@mokei/context-server`, `@mokei/decision-flow`, `@mokei/system-one-client` (workspace:^); `@sozai/flow-graph`, `@sozai/schema` (catalog:). Dev: `@mokei/host`, `@mokei/session`, `@types/node`. Types-only use of host/session goes through `import type`.

**Interfaces:**
- Produces (`call-meta.ts`): constants `FLOW_DEPTH_META`, `IDEMPOTENCY_KEY_META`, `ATTEMPT_META`, `FLOW_GRANT_META`, `MAX_FLOW_DEPTH = 4`; `readFlowDepth(meta: Record<string, JSONValue>): number | undefined` (absent → 0, non-negative integer → value, otherwise `undefined`); `callMeta(params: { depth: number; key: string; attempt: number }): Record<string, JSONValue>`.
- Produces (`tool-caller.ts`): `CatalogTool`, `ToolCaller`, `ToolCallOutcome` exactly as in the spec; `hostToolCaller(host: ContextHost, options?: { exclude?: Array<string> }): ToolCaller`; `markDecisionFlowContext(host, key): void`, `unmarkDecisionFlowContext(host, key): void` (module `WeakMap<ContextHost, Set<string>>`); `ToolUnavailableError` (code `tool_unavailable`).
- `callTool`: recheck live catalogue → `ToolUnavailableError`; remote via `host.contexts[key].client.callTool({ name, arguments, _meta: meta, signal, task: 'handle' })`, `isCreateTaskResult` → `{ task: { taskId } }`; local via `host.callLocalTool`. `waitTask`/`cancelTask` via the context client's `tasks.wait(taskId, { signal })` / `tasks.cancel(taskId)`.

- [ ] **Step 1: Failing tests** (host from `new ContextHost()`, siblings via `addDirectContext` + `setup`, one sibling with a task tool using `createTaskManager`):
  - `lists enabled callable tools minus decision-flow contexts and allow never`
  - `refuses a disabled tool at dispatch with tool_unavailable`
  - `removed context is tool_unavailable at dispatch`
  - `returns a task handle from a task sibling and waits for it`
  - `cancelTask sends tasks/cancel`
  - `local tool receives call meta` (assert `meta['io.mokei/flow-depth'] === 1`)
  - `readFlowDepth`: absent → 0, `2` → 2, `-1`/`1.5`/`'x'` → undefined.
- [ ] **Step 2:** `pnpm install && pnpm --filter @mokei/decision-flow-server exec vitest run` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** rerun — PASS.
- [ ] **Step 5:** Commit `feat(decision-flow-server): scaffold package and host tool caller`.

### Task 4: `tool` node kind

**Files:**
- Create: `src/tool-node.ts`, `src/tool-errors.ts`
- Test: `test/tool-node.test.ts` (fake `ToolCaller`)

**Interfaces:**
- Consumes: `ToolCaller`, `CatalogTool`, `callMeta` (Task 3).
- Produces: `ToolNode` (spec type); `toolKind(params: { caller: ToolCaller; catalogue: Array<CatalogTool>; depth: number; approved?: ReadonlySet<string> }): NodeKind<ToolNode>` (`approved` absent at check time); `ToolNodeError extends Error { code: ToolErrorCode; retryable: boolean }` with codes `tool_error | tool_call_failed | tool_rejected | tool_invalid_args | tool_invalid_output | tool_unavailable | tool_not_approved | tool_task_failed | tool_task_cancelled`; `ToolSuspendData = { tool: string; taskId: string }`; resume value `{ ok: true; result: CallToolResult } | { ok: false; status: 'failed' | 'cancelled'; error?: JSONValue }`.
- Kind fields: `retries: true`, `describeError` → `{ type: code }`, `retryable` → `error.retryable`, `targets` from `next` / `cases[].to` / `default` / `onError`.

- [ ] **Step 1: Failing tests** (each code's table row from the spec, including where it appears):
  - check: `unknown_tool` with hint listing IDs; constant args validated against `inputSchema`; referenced paths checked against `outputSchema`; `tool_output_reserved_field`; `next` xor `cases`+`default`.
  - `runs in order: resolve, validate args, approved set, dispatch` (fake caller records; invalid args never dispatch; unapproved never dispatch).
  - result mapping: with `outputSchema` requires valid `structuredContent`; without: `structuredContent`, else text parsed as JSON, else string.
  - `JSON-RPC -32603 and transport errors are retryable tool_call_failed; other RPC errors are tool_rejected`.
  - `onError handles failure with results[node].error.lastFailure.type` and `unhandled failure surfaces in RunError.lastFailure`.
  - `suspends on a sibling task handle and resumes ok/failed/cancelled`.
  - `call meta carries depth+1, <runID>:<invocationID> and attempt`, and the key is identical across two retry attempts.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3:** Implement with `createFlowGraph({ kinds: [toolKind(...)] })` in tests. Validators via `createValidator` from `@sozai/schema`, built once per kind instance.
- [ ] **Step 4:** run — PASS.
- [ ] **Step 5:** Commit `feat(decision-flow-server): tool node kind`.

### Task 5: MCP predictor

**Files:** Create `src/predictor.ts`; Test `test/predictor.test.ts`

**Interfaces:**
- Produces: `type PredictorFactory = ((run: { depth: number }) => Predictor) & { tool: string }`; `createMCPPredictor(caller: ToolCaller, options?: { tool?: string }): PredictorFactory` (default `'system-one:predict'`); `resolvePredictor(p: Predictor | PredictorFactory, run: { depth: number }): Predictor`.

- [ ] **Step 1: Failing tests:** against the real `createSystemOneConfig({ client: fakeSystemOneClient })` on a host: prediction returned from `structuredContent`; `older text-only result is SystemOneResponseError` (sibling tool without `outputSchema`); fake caller `isError` → `SystemOneError` with the text; task handle that completes → prediction; task that fails → `SystemOneError`; `signal abort cancels the sibling task`; meta key `<runID>:<invocationID>:predict`.
- [ ] **Step 2:** FAIL. **Step 3:** implement (steps 1–3 of the spec's predictor section, in that order). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(decision-flow-server): MCP-backed predictor`.

### Task 6: Definition checks, plan and grants

**Files:** Create `src/definition-checks.ts`, `src/plan.ts`, `src/grants.ts`; Test `test/definition-checks.test.ts`, `test/grants.test.ts`

**Interfaces:**
- Produces (`definition-checks.ts`): `toElicitationSchema(schema: unknown): { requestedSchema: JSONObject; wrapped: boolean } | undefined`; `checkInputNodes(definition: FlowDefinition): Array<FlowIssue>` (codes `input_schema_not_elicitable`, `input_prompt_not_string`); `checkFlow(params: { definition: unknown; caller: ToolCaller; predictor: Predictor | PredictorFactory; elicitation: boolean }): { ok: boolean; issues: Array<FlowIssue>; formatted: string; graphFor(run: { depth: number; approved: ReadonlySet<string> }): FlowGraph }` — graph via `createDecisionFlowGraph({ client, kinds: [toolKind(...)] })`; adds a `severity: 'warning'` issue `input_without_elicitation` when `elicitation` is false and the flow has `input` nodes.
- Produces (`plan.ts`): `flowPlan(definition: FlowDefinition, predictor: Predictor | PredictorFactory): Array<string>` (tool node IDs, plus `factory.tool` when a `decide` node exists and the predictor is a factory; sorted, unique).
- Produces (`grants.ts`): `createGrantStore(options?: { now?: () => number; ttlMs?: number }): GrantStore`; `GrantStore = { issue(params: { toolName: string; arguments: JSONValue; tools: Array<string> }): string; consume(params: { token: unknown; toolName: string; arguments: JSONValue }): { tools: Array<string> } | undefined }`. Digest: `digestDefinition(arguments)` from `@sozai/flow-graph`.

- [ ] **Step 1: Failing tests:** flat object schema sent as is; primitive/enum wrapped as `{ type: 'object', properties: { value }, required: ['value'] }`; nested/array/absent → `input_schema_not_elicitable`; missing or constant non-string prompt → `input_prompt_not_string`; `flowPlan` lists tool IDs and predictor tool; grants: `single-use`, `expired after 5 minutes`, `mismatched tool name or arguments refused`, `grant matches reordered argument keys`, expired grants purged on issue and consume.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(decision-flow-server): definition checks, run plan and approval grants`.

### Task 7: Server tools without the driver

**Files:** Create `src/server.ts`, `src/flow-tools.ts`; Test `test/server.test.ts` (in-memory `ContextServer` + `ContextClient` over `DirectTransports`, as in `packages/context-client/test/tasks-client.test.ts`)

**Interfaces:**
- Consumes: Tasks 3–6.
- Produces:
  ```ts
  type ApprovalHook = (params: { toolName: string; arguments: Record<string, JSONValue>; meta: Record<string, JSONValue> }) => { tools: Array<string> } | undefined
  type DecisionFlowServerParams = {
    caller: ToolCaller
    predictor: Predictor | PredictorFactory
    tasks: TaskManager
    flows?: Array<FlowDefinition>
    approval: ApprovalHook
    elicitation?: () => boolean   // default () => false
  }
  function createDecisionFlowServer(params: DecisionFlowServerParams): { config: Omit<ServerConfig, 'tasks'> & { tasks: TaskManager }; tools: ToolDefinitions; recoveryTools: ToolDefinitions; recover: NonNullable<TaskManagerParams['recover']> }
  function flowToolName(id: string): string
  ```
  `config`: `name: 'decision-flow'`, `protocolVersions: ['2026-07-28']`. `recover` is a stub here (Task 9); the task work is a stub `startRun` injected from Task 8 — define `startRun(params): TaskWork` signature in `src/driver.ts` now as `throw new Error('not implemented')`.
- Construction fails for: non-object registered `input` schema; name collision; registered flow failing its check.

- [ ] **Step 1: Failing tests:** `check_flow` returns `{ ok, issues, formatted }` and the elicitation warning; `run_flow` invalid definition → `isError` with formatted issues, no task (`tasks/get` unknown); depth absent/invalid/≥4 → `isError` `Invalid flow depth` / refusal, no task; no or bad grant → `Flow denied`, no task; client without tasks extension → `-32021`; registered-flow tool names and input schemas (object and absent → `{ type: 'object' }`); construction failures.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(decision-flow-server): check_flow, run_flow and registered flow tools`.

### Task 8: Run driver

**Files:** Modify `src/driver.ts`; Test `test/driver.test.ts`, `test/driver-input.test.ts`

**Interfaces:**
- Produces: `type ResumeDataV1 = { v: 1; flow: { definition: FlowDefinition } | { id: string; digest: string }; approved: Array<string>; depth: number; runState: RunState; siblings: Array<{ tool: string; taskId: string }>; inputSeq?: number }`; `startRun(params: { handle: TaskHandle; graph: FlowGraph; run: FlowRun; resumeData: ResumeDataV1; caller: ToolCaller }): Promise<CallToolResult>` used as the task work by Task 7's tools and Task 9's recovery.
- Behaviour, per spec Drive / Suspensions / End / Sibling cleanup:
  - checkpoint before advancing past each committed state; checkpoint rejecting because the task is terminal or `handle.signal` aborted → stop silently; any other rejection → abort run, cancel siblings, throw `RPCError({ code: -32603, message: 'Flow checkpoint failed' })`.
  - `node:enter` → `handle.setStatus('Running node <id>')`.
  - input: key per Global Constraints; `requestInput({ [key]: { method: 'elicitation/create', params: { message, requestedSchema } } }, { signal })` with a signal aborting at `pending.deadline`; `accept` → unwrap if wrapped → `graph.resume({ event: { type: 'value', value } })`; `decline`/`cancel` → cleanup siblings, `handle.cancel()`; deadline → `{ type: 'timeout' }`; non-string resolved prompt → no request, complete `isError` with `structuredContent: { error: { type: 'input_prompt_not_string', node } }`.
  - sibling task: add to `siblings`, checkpoint, `caller.waitTask`, remove, resume with the Task 4 resume value.
  - retry: timer to `pending.resumeAt`, then `graph.resume({ event: { type: 'retry' } })`.
  - end mapping: `ended` → `structuredContent: { outcome, output }` + text summary; `error` → `isError: true`, `structuredContent: { error: RunError }`; `aborted` → `handle.cancel()`.

- [ ] **Step 1: Failing tests** (server from Task 7 with a controlled `TaskStore` wrapper and deferred sibling tools):
  - inline and registered runs to completion; flow `error` completes `isError`.
  - input: flat object, wrapped primitive, decline, cancel, real deadline expiry withdrawing the request followed by a late `tasks/update` rejected, non-string prompt.
  - `client cancel cancels every listed sibling task`; same for run `error`, retry total timeout and checkpoint failure.
  - `checkpoint after cancel stops without failing`.
  - failure windows: crash after sibling acted before checkpoint → one repeat with the same operation key; retry after timeout → same key, next attempt; handle returned before checkpoint → orphan documented, re-call uses same key.
  - `concurrent runs at different depths send their own flow-depth`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(decision-flow-server): run driver with checkpoints and suspensions`.

### Task 9: Recovery

**Files:** Create `src/recovery.ts`; Modify `src/server.ts`; Test `test/recovery.test.ts`

**Interfaces:**
- Produces: the server's `recover(record, resume)` and `recoveryTools` (live tools plus a `Proxy`/lookup resolving any other `flow_` name to a recovery-only definition with the flow result output schema and a handler that throws).
- Order exactly as spec Recovery steps 0–3; input re-entry per spec, with `TaskInputKeyReusedError` incrementing `inputSeq`, checkpointing, and re-asking.

- [ ] **Step 1: Failing tests** (persist a record through a shared `createMemoryTaskStore()`, dispose the first manager, create a second with `recover`, then `await tasks.recover(recoveryTools)`):
  - `running` → `graph.recover`; each suspended reason; each terminal status settles from stored state even after flow change/removal/catalogue drift.
  - digest change and removed non-terminal flow → failed `Flow definition changed`; catalogue drift → failed `Flow no longer valid` with `data.formatted`; siblings cancelled in each.
  - input: crash after suspension checkpoint (issued on recovery), after `requestInput` persisted (attached), after answer before checkpoint (`inputSeq` incremented), second crash after the incremented key issued (attached), deadline already past (timeout, no request).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(decision-flow-server): recover persisted runs`.

### Task 10: Session wiring and approval bridge

**Files:** Create `src/wiring.ts`; Test `test/wiring.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 6, 7.
- Produces:
  ```ts
  type AddDecisionFlowParams = { key: string; flows?: Array<FlowDefinition>; predictor?: Predictor | PredictorFactory; store?: TaskStore }
  type DecisionFlowWiring = { wrapApproval(strategy: ToolApprovalStrategy): ToolApprovalStrategy; dispose(): Promise<void> }
  function addDecisionFlow(session: Session, params: AddDecisionFlowParams): Promise<DecisionFlowWiring>
  ```
  `predictor` defaults to `createMCPPredictor(caller)`. Steps 1–6 and rollback exactly as spec Session wiring; `addDirectContext({ key, config, tools })` with one enabled `ContextTool` per server tool (`id: key:name`, `tool: { name, description, inputSchema, outputSchema }`). `wrapApproval` per spec Approval; the `ToolApprovalFn` receives `{ ...request, flow: { id?, name, inline, tools } }`. `dispose` removes the context, unmarks the key and disposes the manager.

- [ ] **Step 1: Failing tests** (mock provider as in `packages/session/test/agent-elicitation-*.test.ts`):
  - new `AgentSession` advertises and executes `flow:run_flow` and a registered-flow tool without `host.setup`.
  - each strategy (`'auto'`, `'never'`, `'ask'`, fn) through `wrapApproval`; one prompt per run; no task without a grant; grants single-use.
  - two concurrent identical calls: only the approved call's token accepted.
  - approved call whose tool becomes unavailable before dispatch leaves no usable grant; expired token refused (injected clock).
  - recursion refused between two flow contexts (`unknown_tool` at check, `tool_unavailable` at dispatch); depth guard.
  - wiring throws without elicitation when a registered flow has `input`, leaving no context; failure after registration rolls back; recovery runs before registration.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(decision-flow-server): session wiring and approval bridge`.

### Task 11: Integration, docs, changeset

**Files:**
- Create: `integration-tests/suites/decision-flow-server.test.ts`, `integration-tests/support/interop/decision-flow-fixture.ts`, `packages/decision-flow-server/README.md`, `.changeset/decision-flow-server.md`
- Modify: `integration-tests/package.json` (dependency), `docs/agents/architecture.md` (`## Package Structure` L206: add `decision-flow/` and `decision-flow-server/`), `packages/decision-flow/README.md` (Predictor), `packages/session/README.md` (approval meta), `mcp-servers/system-one/README.md` (structured output)

- [ ] **Step 1: Failing test** — `AgentSession` with a stub sibling server (support-triage tools, one a task tool) and `createSystemOneConfig({ client })` on a stub backend (as in `packages/decision-flow/test/support-triage.test.ts` `makeBackend`), wired with `addDecisionFlow`, runs the support-triage example end to end, including an `input` answered through `onElicitation`; and `agent abort cancels run and sibling task`. A laya-gated variant uses `inject('laya')` like `suites/laya-decision-flow.test.ts`.
- [ ] **Step 2:** `pnpm --filter mokei-integration-tests exec vitest run suites/decision-flow-server.test.ts` — FAIL, then implement fixture gaps, then PASS.
- [ ] **Step 3:** README (concepts, wiring, approval and grant tokens, `tool` node kind, delivery semantics and operation key incl. the orphan window, elicitation schema limits); architecture entry; changeset (patch, four packages).
- [ ] **Step 4:** `pnpm change status` shows 0.14.x; `rtk proxy pnpm run lint`; `pnpm build`; `pnpm test` — all PASS.
- [ ] **Step 5:** Commit `feat(decision-flow-server): integration suite, docs and changeset`.
