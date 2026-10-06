# Decision flows

**Status:** complete
**Dates:** 2026-09-28 to 2026-09-30
**PRs:** #58, #59, #62, #65

## Goal

Compose System One classifications into multi-decision flows whose full definition is JSON. Flows support trees,
bounded loops, suspend and resume. Then run those flows as MCP tasks that call sibling MCP tools under agent
approval. Primary authors are application developers and LLMs that write flow JSON. The schema therefore stays small
and regular, and check issues carry repair hints.

## Decision flows (PR #58)

New `@mokei/decision-flow`, changed `@mokei/system-one-client`. Built on `@sozai/flow-graph@0.1.0` and
`@sozai/async@0.3.0`.

### Key decisions

- **Layering.** The generic graph engine lives in sozai as `@sozai/flow-graph`. It provides `branch`, `set`, `loop`,
  `action`, `input` and `end` nodes, resumable step-wise runs and at-least-once node execution. It also provides
  per-node JSON retry policies and definition digests. Mokei adds one node kind, `decide`. The runtime does not
  depend on session packages, which left `AgentSession` gating and MCP flow tools open.
- **Answer validation in the client.** `validateResult` in `system-one-client` checks answer values against their
  questions. Choice labels and probability keys must be declared criteria. `score` must sit within numeric `legend`
  bounds. `noul`, `confidence`, `act_probability` and probabilities must be finite and in [0, 1]. The
  `@sozai/schema` answer schemas enforce this.
- **Standard Schema results.** The `validate*` functions return Standard Schema results. `predict` turns failures
  into `SystemOneInputError` or `SystemOneResponseError`, which implement `StandardSchemaV1.FailureResult`. Answer
  issue paths start with `['answers', questionKey]`.
- **Flat results.** A `decide` node writes answers under `results.<id>.<questionKey>` plus `$meta: { model, usage }`.
  It then evaluates `cases` in order, else `default`. A closed `resultSchema` makes every flow reference statically
  checkable. Only `score.legend` and `score.probabilities` stay open. Extra backend fields inside declared answers
  are kept but not referenceable. `$meta` and `error` are reserved question keys.
- **Declared keys only.** Only answers for declared questions are staged and traced. A backend returning an
  undeclared top-level key such as `error` cannot spoof the engine's handled-error channel.
- **Static checker.** Beyond schema validation, it rejects unsafe or reserved question and criteria keys. It checks
  choice comparisons against declared criteria and numeric comparisons in [0, 1]. A literal `state` must be a string,
  object or array. It scans filters across the whole definition, scoped to its own node's results. It skips literal
  `{ value }` payloads, matching the engine's traversal.
- **Retries by status.** Only `SystemOneConnectionError` with no status, or status 408, 429, 500, 502, 503, 504 or
  529, is retried. A finite `retryAfterMs` is honoured. Everything else, including `invalid_state`, is terminal.
- **Default retry policy.** A `decide` node gets 3 attempts, 10 s per attempt, backoff from 500 ms with jitter, and
  suspension after 30 s. A node's own `retry` replaces the default.
- **Safe errors.** `describeError` returns class name, status and clamped `retryAfterMs`, never messages. The engine
  is the sole failure logger, under `mokei.decision-flow`.
- **Private telemetry.** A `decision.predict` child span and per-question `decision.answer` events use fixed
  attribute names. State, instructions, criteria descriptions and payloads are never recorded. Error messages are
  recorded only with `recordErrorMessages: true`. An aborted prediction ends its span labelled by the abort reason,
  timeout or caller cancellation.
- **Authoring schemas.** `flowDefinitionSchema` covers executable kinds, for LLMs. `flowStorageSchema` adds reserved
  shapes. Both are composed once at module load, and every `decide`-owned field has a description. Examples live in
  TSDoc and tests, not in the schema. `formatIssues` is re-exported for repair loops.
- **No `resolver` at first.** The engine had no flow references yet, so `createDecisionFlowGraph` omitted the
  option. Flow references arrived in PR #65.

### What was built

`@mokei/decision-flow` exports `createDecisionFlowGraph`, the `decide` kind with its schema, checker and result
schema, `retryableDecision`, the error helpers, the two flow schemas and `formatIssues`. A support-triage JSON example
runs end to end, including a JSON round trip of a suspended run. The README covers persistence, `invocationID` dedupe,
optimistic concurrency, metrics and privacy.

The shared kigu SWC config strips JSON import attributes, so built code cannot import `package.json`. The
`decision-flow` tracer is therefore created without a version.

## Laya suite and HTTP retries (PR #59)

Exercise decision flows against a real laya backend, and let the System One HTTP backend retry when asked to.

- **Opt-in retries.** `HTTPSystemOneBackendParams` and `SystemOneHTTPClientParams` take an optional
  `retry: RetryPolicy` from `@sozai/async`. Without it a request makes exactly one attempt, as before. Callers that
  already retry at a higher level, such as a `decide` node, stay unchanged.
- **One classification.** `retryableSystemOneError` moved into `@mokei/system-one-client` and is exported.
  `retryableDecision` delegates to it, so both layers retry the same statuses.
- **Two-level error mapping.** Each attempt maps its failure to a `SystemOneError` before the retry predicate sees it.
  What escapes `retry()` is mapped again. An abort gives the abort reason, and a non-retryable error is rethrown
  unchanged. Attempt exhaustion gives the last `SystemOneError`. An attempt or total timeout gives a
  `SystemOneConnectionError` whose cause is the `RetryExhaustedError`.
- **Smoke test in integration.** The built-entry export check moved to
  `integration-tests/suites/built-entries.test.ts`, which runs after the cached build. The decision-flow `test`
  script is now types plus unit tests only.
- **Shared laya server.** The laya suites run in their own Vitest project, `laya`. Its global setup starts one
  `laya-serve` on a free port, warms it up and provides `{ url, apiKey }` through `inject('laya')`. It provides
  `null` when `MOKEI_LAYA_SERVE_BIN` is unset, and the suites skip. Other projects never start the server.
- **Model-independent assertions.** Route tests compare the observed route with the route the recorded answers
  imply, instead of pinning a team. A pin stays only when stable across three runs. The crash message routed to
  `ask` in 3 of 3 runs, so its `technical` pin was dropped.

## Decision-flow server (PR #62)

Run decision flows whose steps call MCP tools. A new MCP server sits beside the other servers of a session. It calls
their tools from `tool` nodes and runs `decide` nodes through the sibling `system-one` server by default. Each run is
an MCP task. An `AgentSession` delegates work to a registered flow, or to one it writes and repairs itself. This
replaced `check_flow` and `run_flow` tools inside `mcp-servers/system-one`. It builds on the
[MCP Tasks extension](2026-09-29-mcp-tasks-extension.complete.md) and
[session elicitation](2026-09-29-session-elicitation.complete.md).

### What was built

- **`@mokei/decision-flow-server`**, a new package in the fixed release group. `createDecisionFlowServer` exposes
  `check_flow`, which returns `formatIssues` output for repair, and `run_flow` for inline definitions. Each registered
  flow gets a task tool named after its ID, so `support/triage` becomes `flow_support_triage`.
- **`addDecisionFlow(session, ...)`** wires the server into a `Session` as a direct context. It runs recovery before
  registering, rolls back on failure and returns `wrapApproval(strategy)` and `dispose()`.
- **A `tool` node kind** calls sibling MCP tools, including task tools, and routes on their results.
  `createMCPPredictor` calls the sibling `predict` tool, which now returns `structuredContent` too.
- **`@mokei/session`:** a `ToolApprovalFn` may return `{ approved: true, meta }`, and that `meta` reaches the call as
  `_meta`.
- **`@mokei/decision-flow`:** `decide` accepts any `Predictor`, which receives the node's `call` (`runID`,
  `invocationID`, `attempt`).
- **`@mokei/context-server`:** `TaskManager.update` rejects a response for a key that is not outstanding. It returns
  `-32602` `Task is not awaiting input for <key>` with `data: { key }`. That covers withdrawn, answered and unknown
  keys, and a task not awaiting input. A multi-key update with one stale key is rejected whole.
- **`@mokei/context-client`:** on that rejection the task waiter fetches an authoritative `tasks/get`. It keeps
  waiting when the key was withdrawn, and surfaces the error only when the key is still outstanding.

### Key decisions

- **One approval per run, inside the agent's tool gate.** `wrapApproval` computes the run's plan in-process: every
  `tool` node ID plus the predictor tool. It applies the agent's strategy to that plan. A function strategy receives
  `flow: { id?, name, inline, tools }` as a `FlowApprovalRequest`.
- **Single-use grants.** Approval mints a random UUID grant, bound to tool name and canonical-argument digest, with a
  5-minute lifetime. It travels only as that call's `_meta['dev.mokei/flow-grant']`. The server consumes it
  atomically before creating a task, so a concurrent identical call cannot reuse it.
- **No approving default.** `approval` is required. An invalid inline definition skips approval, so the server
  returns formatted issues and creates no task.
- **Server check order.** Depth, then definition, then grant, then task creation. Nested flow calls carry
  `dev.mokei/flow-depth`, capped at 4. All flow contexts on one host exclude each other from their catalogues, which
  prevents recursion. Keys are reserved synchronously, so concurrent wiring cannot collide.
- **At-least-once delivery.** Every sibling call carries `dev.mokei/idempotency-key = <runID>:<invocationID>` and
  `dev.mokei/attempt`. Tools that must not repeat an action deduplicate on the key.
- **Sibling tasks.** Sibling task handles are committed to run state before the driver waits on them. A crash in that
  window leaves an orphaned sibling task, and recovery calls the tool again with the same key. A lost sibling wait
  cancels the sibling. The node's attempt and total timeouts bound the wait, and expiry cancels the sibling. Invalid
  structured output from a sibling is `tool_invalid_output` and is not retried.
- **Input nodes use MCP form elicitation.** Schemas must be a primitive, a string enum or a flat object of
  primitives. Anything else is `input_schema_not_elicitable`. A bare string enum is sent with `type: 'string'`.
- **Input keys and deadlines.** The input key is `<runID>:<invocationID>:input:<inputSeq>`. A deadline withdraws the
  outstanding request, so a late answer is rejected rather than applied.
- **Recovery from stored state.** A run stored as ended, errored or aborted settles from stored state. A removed or
  changed registered flow fails with `Flow definition changed`, detected by a digest check. A definition that no
  longer passes the catalogue check fails with `Flow no longer valid`.
- **Recovery by status.** Otherwise the run resumes by status:
  - `running` calls `graph.recover`.
  - Suspended on input re-attaches. A request whose deadline passed during downtime is withdrawn, and the run takes
    the timeout edge.
  - Suspended on a sibling task waits on that task again.
  - Suspended on a retry restarts its timer.
- **Recovery-only lookup.** A lookup for `flow_*` names serves only recovery. It is never listed and cannot be
  called. Resume data must be version 1.
- **Tool results with no declared schema.** The first cut used a 32-level `additionalProperties` chain, so
  `results.<node>.<path>` references checked. PR #65 replaced it with an unconstrained schema.

An `AgentSession` suite runs support triage end to end and checks that aborting the agent cancels the run and its
sibling task.

## Flow references, input decline and isolated validators (PR #65)

`@sozai/flow-graph` 0.2.0 (flow references, an `input` decline edge, unconstrained result schemas) and `@sozai/schema`
0.1.3 (`createValidatorFactory`) unblocked this work. It also touches [host desktop](2026-09-30-host-desktop.complete.md).

### Key decisions

- **The flow registry is the single source of registered definitions.** Registered flows are stored as
  `structuredClone` snapshots, with a `digestDefinition` digest taken at registration. Later mutation of the caller's
  objects has no effect. Tools, recovery, `list_flows`, the wiring approval map and the elicitation guard all read
  the snapshots. One version per flow ID is allowed, and a duplicate throws.
- **Runtime definitions reference registered flows plus themselves only.** A per-definition resolver returns the
  definition for its own ID, with a matching or omitted version, then delegates to the registry. Reusing a
  registered ID with a different digest gives the `flow_id_conflict` issue at `['id']`. A digest-equal copy is
  accepted.
- **Async checks.** `checkFlow` and `createDecisionFlowServer` became async around `graph.checkFlows()`.
  `graph.check` runs first. On success the `checkFlows` result replaces its issues, so root warnings are not
  duplicated.
- **Checks over reachable flows.** The mokei input-node checks and `input_without_elicitation` run over every
  reachable flow. Callee issues are prefixed `['flows', id, version]`. Registration checks each flow after the whole
  registry exists, so flows may reference later-registered ones. A failure throws `Invalid registered flow <id>`.
- **One reachable-flow walk.** `reachableFlows` follows edges `'all'` or `'goto'`, keeps a visited `(id, version)`
  set and tolerates malformed input. `flowPlan` and the elicitation guard use `'all'`, so approvals cover callee
  tools. `list_flows` uses `'goto'` to derive the `outputs` and `outcomes` a caller can read.
- **Decline routing uses the active frame.** The driver resolves the pending node through the last frame and a
  synchronous lookup. A decline inside a callee therefore uses the callee's `decline.to`. A missing response counts
  as cancel. Without the edge, or when the lookup fails, the task is cancelled as before.
- **Pinned-frame safety.** `resume` and `recover` are lazy. `FlowVersionMismatchError` and `FlowReferenceError` from
  `next()` therefore map to `Flow definition changed`. Recovery checks every frame's ID, version and digest before
  `checkFlow`. A changed or removed callee reports `Flow definition changed` rather than `Flow no longer valid`.
- **Unconstrained result paths.** Tools without an `outputSchema` use `{}`, and the 32-level depth bound is gone.
- **Validator recycling per package, not a shared package.** `decision-flow-server` (`src/validators.ts`) and
  `host-desktop` (`form.ts`) each lazily create a `createValidatorFactory` instance. Each keys a 64-entry LRU by
  canonical JSON, with keys sorted recursively. Failed compiles count too.
- **Factory disposal.** On the first miss after 256 distinct compiles, the factory is disposed and a fresh one
  starts. Validators are looked up at use and not held, so suspended runs keep no factory alive. This also removed a
  per-run recompile of every catalogued tool. A shared `createValidatorCache` and a flow-graph validator-factory
  option were requested upstream.

### What was built

- `@mokei/decision-flow`: flow-reference tests and a README section, with no source change.
- `@mokei/decision-flow-server`: `createFlowRegistry` and `flowSummaries`, and the `list_flows` tool. `checkFlow`
  takes a `registry`, and `createDecisionFlowServer` accepts `flows` or `registry`. `flowPlan` takes a `lookup`.
- `@mokei/host-desktop`: form validators on an isolated recycled factory.
- Patch changesets naming the breaking signature changes.

The integration test drives `run_flow` through `addDecisionFlow`, as the server is only a direct context until a
standalone binary exists.

## Follow-ons

Open items are in the [decision-flow follow-ons](../backlog/2026-09-28-decision-flow-follow-ons.md) and the
[decision-flow server follow-ons](../backlog/2026-09-29-decision-flow-server-follow-ons.md). The small ones closed in
the [quick follow-ons](2026-09-30-quick-follow-ons.complete.md). The local rig that drives these flows is the
[flow rig milestone](2026-10-01-flow-rig-milestone.complete.md).
