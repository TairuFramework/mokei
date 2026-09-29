# Decision-flow server

## Goal

Run decision flows whose steps call MCP tools. A new decision-flow MCP server sits beside the
other servers of a session, calls their tools from `tool` nodes, runs `decide` nodes through a
System One backend (by default the sibling `system-one` server), and tracks each run as an MCP
task (`io.modelcontextprotocol/tasks`).

The first consumer is an `AgentSession`: the model delegates multi-step work to a flow, either a
flow the application registered or one the model writes and repairs itself. A standalone server
binary built from the same factory is follow-on work.

This replaces the earlier backlog idea of `check_flow` / `run_flow` tools inside
`mcp-servers/system-one`, and covers the flow half of the `AgentSession` integration item.

## Dependencies

- MCP Tasks extension (`feat/mcp-tasks-extension`): `createTaskManager`, `ContextServer({ tasks })`,
  task handles (`requestInput` and `awaitInput` with `{ signal }` withdrawal, `checkpoint`),
  `tasks.recover`, and the client's `callTool({ task: 'handle' })`, `tasks.wait(taskId)` and
  `tasks.cancel(taskId)`. This branch starts from that one; implementation waits until it
  merges.
- Session elicitation (`feat/session-elicitation`): `ContextHost` `elicit` option and the
  `AgentSession` `onElicitation` override. Flow `input` nodes reach the user through it.
- `@sozai/flow-graph` 0.1.0 as it is today. No upstream change is required.

## Package and touched packages

- New package `@mokei/decision-flow-server` in `packages/` (approved). Dependencies:
  `@mokei/decision-flow`, `@mokei/context-server`, `@mokei/context-protocol`,
  `@mokei/context-client` (types), `@mokei/host` (types), `@mokei/session` (types),
  `@sozai/flow-graph`, `@mokei/system-one-client` (types).
- `@mokei/decision-flow`: `decideKind` and `createDecisionFlowGraph` accept
  `client: Predictor`, where `Predictor = Pick<SystemOneClient, 'predict'>`. Type widening only;
  existing callers keep compiling.
- `mcp-servers/system-one`: the `predict` tool gains an `outputSchema` for the mapped
  `PredictResult` and returns it as `structuredContent`; the text content is unchanged.

## Components

### ToolCaller

```ts
type CatalogTool = { id: string; inputSchema: Schema; outputSchema?: Schema }
type ToolCaller = {
  listTools(): Array<CatalogTool>
  callTool(params: {
    id: string
    arguments: Record<string, JSONValue>
    idempotencyKey: string
    signal: AbortSignal
  }): Promise<ToolCallOutcome>
  waitTask(params: { id: string; taskId: string; signal: AbortSignal }): Promise<CallToolResult>
  cancelTask(params: { id: string; taskId: string }): Promise<void>
}
type ToolCallOutcome = { result: CallToolResult } | { task: { taskId: string } }
```

- `hostToolCaller(host, { exclude })` adapts a `ContextHost`. Tool IDs are namespaced
  (`contextKey:toolName`, `local:name` for local tools).
- The catalogue is the host's callable tools: enabled tools only, with each context's allow
  policy applied, minus excluded contexts. `listTools` reads it live.
- `callTool` is an execution boundary, not only a lookup: at dispatch it rechecks the live
  catalogue and refuses a tool that is missing, disabled, not allowed, or excluded
  (`tool_unavailable`, not retryable). `ContextHost.callNamespacedTool` does not check these, so
  the caller must.
- Exclusion covers every decision-flow context on the host, not only the caller's own. The
  wiring helper records each decision-flow context key per host; `hostToolCaller` excludes all
  of them, so two flow servers cannot call each other.
- Depth guard for callers outside a session: `run_flow` and registered-flow calls carry
  `_meta['io.mokei/flow-depth']`; the caller forwards depth + 1 on every sibling call, and the
  server refuses a run at depth 4 or more with an `isError` result.
- The idempotency key is sent as `_meta['io.mokei/idempotency-key']` (see Delivery semantics).
- `callTool` asks the sibling for a task handle (`task: 'handle'`) when the sibling's client
  supports the tasks extension, and returns `{ task }` when the sibling answers with one;
  otherwise it returns `{ result }`.

### `tool` node kind

```ts
type ToolNode = {
  kind: 'tool'
  description?: string
  tool: string
  args: Record<string, Value>
  next?: string
  cases?: Array<{ when: Filter; to: string }>
  default?: string
  onError?: string
  retry?: FlowRetryPolicy
}
```

- `tool` is a static string. Tool IDs computed at run time are out of scope for v1 (see
  Follow-on); with them goes per-call approval.
- Exactly one of `next`, or `cases` with `default`; the kind's `check` reports anything else.
- Check time (the kind's `check` and `resultSchema`, which see the definition only; the
  catalogue is closed over when the kind is built for a check or run):
  - `tool` not in the catalogue: `unknown_tool`, with the available IDs as the hint.
  - `args` given as constant `{ value }` are validated against the tool's `inputSchema`.
    References are not type-checked against the argument schema; the checker only proves that
    referenced result paths exist.
  - Result schema: the tool's `outputSchema` when present; otherwise any JSON value. A tool
    whose `outputSchema` declares a top-level `error` property cannot be used, because
    flow-graph reserves `error` in node results: `tool_output_reserved_field`.
- Run time, in this order, before any call:
  1. resolve `args`;
  2. validate the resolved arguments against the live `inputSchema` (`tool_invalid_args`, not
     retryable);
  3. check the tool is in the run's approved set (`tool_not_approved`, not retryable; a static
     plan makes this a defensive check);
  4. dispatch through `caller.callTool`, which rechecks the catalogue.
- Result mapping:
  - With an `outputSchema`, the result must carry `structuredContent` that validates against
    it; it becomes the node result. Otherwise `tool_invalid_output`, not retryable.
  - Without an `outputSchema`: `structuredContent` if present, else the text content joined,
    parsed as JSON when it parses, else the string.
- Failures are typed errors, mapped by the kind's `describeError` and `retryable`:

  | Code | Cause | Retryable |
  |---|---|---|
  | `tool_error` | result has `isError: true` | no |
  | `tool_call_failed` | transport failure, timeout, or `-32603` from the sibling | yes |
  | `tool_rejected` | any other JSON-RPC error from the sibling (invalid params, missing capability, not found) | no |
  | `tool_invalid_args` | resolved arguments fail `inputSchema` | no |
  | `tool_invalid_output` | missing or invalid `structuredContent` | no |
  | `tool_unavailable` | tool left the catalogue or was disabled | no |
  | `tool_not_approved` | tool outside the approved set | no |
  | `tool_task_failed` / `tool_task_cancelled` | sibling task ended failed / cancelled | no |

  The code appears as `lastFailure.type` in the node's error result
  (`results[node].error`) when `onError` handles it, and in `RunError.lastFailure` when the run
  fails. The node's `retry` policy applies only to retryable failures.
- A task handle from the sibling: the node returns
  `{ suspend: { data: { tool: id, taskId } } }`, so the handle is committed in the run state
  before anyone waits on it. The driver awaits the task (see Lifecycle) and resumes the node
  with `{ type: 'value', value: { ok: true, result } }` or
  `{ ok: false, status: 'failed' | 'cancelled', error? }`. The kind's `resume` maps the result
  through the same mapping as a direct result, and `ok: false` to `tool_task_failed` or
  `tool_task_cancelled`.

### MCP-backed predictor

`createMCPPredictor(caller, { tool = 'system-one:predict' })` returns a `Predictor` that calls
that tool and returns its `structuredContent`, validated against the tool's `outputSchema`
(the bundled server's schema for the mapped `PredictResult`). A result without
`structuredContent` (an older system-one server) is a `SystemOneResponseError`. It is the
default `decide` backend; the application may pass a real `SystemOneClient` (HTTP, laya)
instead.

### Server

`createDecisionFlowServer({ caller, predictor, tasks, flows, approval })` returns the server
definition for a `ContextServer`.

Tools:

| Tool | Mode | Input | Result |
|---|---|---|---|
| `check_flow` | synchronous | `{ definition }` | `{ ok, issues, formatted }` (`formatted` from `formatIssues`) |
| `run_flow` | task | `{ definition, input? }` | flow result (see Lifecycle) |
| one per registered flow | task | the flow's `input` schema | flow result |

- Registered flows:
  - The flow's `input` schema must be an object schema; a flow without `input` gets
    `{ type: 'object' }` and receives the tool arguments as its input. Anything else fails
    server construction.
  - Tool names derive from the flow `id` (`support/triage` becomes `flow_support_triage`); a
    collision fails server construction.
  - Each registered flow is checked at construction against the catalogue at that time.
- Task-mode tools require the client to declare the tasks extension; otherwise the call fails
  with `-32021` (MCP Tasks rule).
- `check_flow` and every run check the definition against the live catalogue. An `input` node
  whose schema is not an elicitation form schema is an issue (`input_schema_not_elicitable`,
  see Suspensions). `check_flow` adds a non-blocking warning when the definition has `input`
  nodes and the host has no elicitation.
- `approval` is required. There is no default that approves.

### Session wiring

Wiring happens on the `Session`, before the `AgentSession` is built, because the approval
bridge has to go into the agent's constructor parameters:

```ts
const flows = await addDecisionFlow(session, { key: 'flow', flows, predictor, store })
const agent = new AgentSession({ session, toolApproval: flows.wrapApproval('ask'), ... })
```

`addDecisionFlow(session, options)` is async. It:

1. builds a `hostToolCaller` over `session.contextHost`, recording `key` as a decision-flow
   context on that host;
2. creates the `TaskManager` (memory store unless `store` is passed) with the server's
   `recover` callback;
3. runs `await tasks.recover(tools)` before registering anything, so persisted runs are served
   with workers from the first request;
4. registers the server as a direct context under `key`;
5. throws when any registered flow has an `input` node and the host has no elicitation;
6. returns `{ wrapApproval(strategy): ToolApprovalStrategy, dispose() }`.

## Approval

One approval per run, asked inside the agent's normal tool-call gate, where the turn's
`iteration`, `history`, `toolCall` and signal are available.

- `wrapApproval(strategy)` returns a strategy that passes non-flow tool calls to `strategy`
  unchanged. For a `key:*` task tool call (`run_flow` or a registered flow), it:
  1. computes the plan in-process from the call's arguments: every `tool` node's ID, plus the
     predictor tool when `decide` nodes use the MCP predictor. An invalid inline definition
     skips approval; the server returns the formatted issues without creating a task;
  2. applies `strategy`: `'auto'` approves, `'never'` denies, `'ask'` emits the pending event
     then denies (today's meaning), and a `ToolApprovalFn` is called with the original request
     plus `flow: { id?, name, inline, tools }`;
  3. on approval, records a single-use grant keyed by the tool name and a digest of the
     canonical arguments, holding the approved tool set.
- `check_flow` passes through `strategy` like any other tool.
- The server's `approval` hook, called before task creation, consumes the matching grant.
  No grant (the call did not come through the wrapped gate, or it was denied) means an
  `isError` result `Flow denied`, and no task. Nothing is asked twice, and nothing bypasses the
  agent's strategy.
- The approved set is stored in the task's `resumeData`; recovery uses it and does not ask
  again.
- Applications using the server without an `AgentSession` pass their own `approval` hook.

## Delivery semantics

- Tool calls are at-least-once. Flow-graph commits `inFlight` before running a node; after a
  crash, `graph.recover` runs an interrupted node again. A tool that already acted will act
  again unless it deduplicates.
- Every call carries `_meta['io.mokei/idempotency-key'] = <runID>:<invocationID>:<attempt>`.
  The key is the same when recovery repeats the same attempt, and different for a new retry
  attempt. Tools that must not repeat an action deduplicate on it. Package docs state this.
- Sibling task handles are committed in the run state (via the node's suspend and the next
  checkpoint) before the driver waits on them. A crash in the window between the sibling
  returning a handle and that checkpoint leaves an orphaned sibling task; recovery calls the
  tool again with the same idempotency key. The docs state this window.

## Lifecycle

### Start

- `run_flow` and registered-flow tools call `tasks.create`.
- An invalid inline definition returns an `isError` tool result with the formatted issues; no
  task is created.
- The approval grant is consumed before the task is created.
- The task's `resumeData` is
  `{ v: 1, flow: { definition } | { id, digest }, approved: Array<string>, runState, siblings }`.
  Inline flows are stored whole; registered flows by `id` and `digest`. `siblings` lists the
  sibling task handles the run has issued and not yet seen settle.

### Drive

- The driver iterates the `FlowRun`. Before advancing the iterator past a committed
  `RunState`, it persists it with `handle.checkpoint(resumeData)`, which merges onto the latest
  task record through the manager's compare-and-swap.
- A checkpoint that fails (task terminal or aborted) stops the run; a failure for any other
  reason aborts the run and fails the task with `-32603` `Flow checkpoint failed`.
- `node:enter` sets `statusMessage` to `Running node <id>`.

### Suspensions

| Pending | Driver |
|---|---|
| `input` node (`reason: 'suspend'`) | `requestInput` with one `elicitation/create` form request (below), passing a `signal` that aborts at the node's deadline. `accept`: resume `{ type: 'value', value }`. `decline` or `cancel`: abort the run; the task ends `cancelled`. Deadline: the manager withdraws the request (task back to `working`), then resume `{ type: 'timeout' }`. |
| `tool` node waiting on a sibling task | `caller.waitTask`, then resume as described under the `tool` node kind. |
| retry (`reason: 'retry'`, `resumeAt`) | Timer until `resumeAt`, then `resume({ type: 'retry' })`. |

Elicitation form requests: MCP form elicitation takes only a flat object schema whose
properties are primitive (string, number, integer, boolean, or string enum).

- An `input` schema that is already such an object is sent as `requestedSchema`, and the
  response content is the value.
- A single primitive or enum schema is wrapped as
  `{ type: 'object', properties: { value: schema }, required: ['value'] }` and unwrapped.
- Anything else (nested objects, arrays) is a check issue, `input_schema_not_elicitable`, with
  a hint to flatten the schema.

### End

| Run status | Task outcome |
|---|---|
| `ended` | completed: `structuredContent: { outcome, output }`, text summary |
| `error` | completed with `isError: true`, `structuredContent: { error: RunError }` |
| `aborted` | cancelled |

A flow error is a tool-level result, not a JSON-RPC error, so the model can read it and repair
the flow.

### Sibling task cleanup

Every sibling task handle the run issues is a resource of the run. On every exit other than
the sibling settling by itself (task cancel, caller abort, run `error`, retry or total timeout,
a lost wait, checkpoint failure, recovery failure, input decline), the driver calls
`caller.cancelTask` for each handle still listed in `siblings`. Cleanup is idempotent and
best-effort: a cancel failure is logged and does not change the run's outcome.

### Recovery

The server's `recover(record, resume)` callback:

1. For a registered flow, compares the stored `digest` with the registered flow's before
   building anything. A mismatch resumes a worker that cancels listed siblings and throws
   `RPCError({ code: -32603, message: 'Flow definition changed' })`.
2. Rebuilds the graph and re-checks the flow against the current catalogue. A failing check
   resumes a worker that cancels listed siblings and throws
   `RPCError({ code: -32603, message: 'Flow no longer valid', data: { formatted } })`.
3. Otherwise resumes a worker that continues the run:
   - `running`: `graph.recover`;
   - `suspended`: re-enters the wait for its pending reason (input via `awaitInput` with the
     deadline signal, sibling task via `waitTask` using `pending.data.taskId`, retry via its
     timer).

A worker that throws `RPCError` settles the task as `failed` with that error (MCP Tasks
recovery rule). The in-session default is the memory store, where recovery has nothing to do;
it matters when the application passes a persistent `TaskStore`.

## Errors

| Case | Result |
|---|---|
| Invalid inline definition | `isError` result with formatted issues, no task |
| No approval grant | `isError` result `Flow denied`, no task |
| Client lacks tasks extension | `-32021` |
| Flow depth 4 or more | `isError` result, no task |
| Tool failures | node failures, codes in the `tool` node table |
| Flow calls a decision-flow context | `unknown_tool` at check time; `tool_unavailable` at dispatch |
| Input declined or cancelled | run aborted, task cancelled |
| Input deadline | request withdrawn, node takes its timeout edge |
| Flow run ends in `error` | task completed, `isError: true`, `RunError` |
| Checkpoint failure | run aborted, task failed `Flow checkpoint failed` |
| Registered flow changed at recovery | task failed `Flow definition changed` |
| Catalogue drift at recovery | task failed `Flow no longer valid` |
| No elicitation for `input` node | wiring throws (registered flows); check warning, then task cancelled with `TaskInputUnavailableError` on the client (inline) |

## Testing

- Unit (`tool` kind, fake `ToolCaller`):
  - check: `unknown_tool`, constant args against `inputSchema`, result paths against
    `outputSchema`, `tool_output_reserved_field`;
  - run-time order: resolution, argument validation, approved-set check, catalogue recheck at
    dispatch;
  - result mapping with and without `outputSchema`, including missing `structuredContent`;
  - each failure code, its `retryable` decision, and where the code appears for handled and
    unhandled failures;
  - suspend on a sibling task, resume both ways;
  - checker and runtime validators tested separately.
- Unit (MCP predictor): against the real `mcp-servers/system-one` `predict` tool, including an
  older text-only result.
- Server (in-memory `ContextServer` and client, MCP Tasks):
  - `check_flow`; inline `run_flow` to completion; registered-flow tools, object and absent
    input schemas;
  - input via elicitation: flat object, wrapped primitive, `input_schema_not_elicitable`, early
    decline and cancel, real deadline expiry with request withdrawal and a late `tasks/update`;
  - cancel, including sibling task cancel on every non-success exit;
  - recovery from a stored `RunState` for `running` and each suspended reason, catalogue drift,
    digest change;
  - failure windows with a controlled store and deferred tools, stopping at each boundary:
    after the sibling acted but before the checkpoint (one repeat, same idempotency key), after
    a sibling task handle but before the checkpoint, and checkpoint conflicts with status and
    input writes. Each asserts no dispatch outside the approved set, no unlisted sibling task
    left running after cleanup, and a recoverable parent record.
- Session wiring: each `toolApproval` strategy through `wrapApproval`, one prompt per run, no
  task without a grant, grants single-use, recursion refused between two flow contexts, depth
  guard, wiring throws without elicitation when registered flows need input, recovery before
  registration.
- Integration (`integration-tests`): an `AgentSession` with a stub sibling server and
  `mcp-servers/system-one` on its stub backend runs the support-triage example end to end,
  including an `input` answered through `onElicitation`; an optional laya-gated variant.

## Docs and release

- Package README: concepts, wiring, approval, the `tool` node kind, delivery semantics and the
  idempotency key, elicitation schema limits.
- `docs/agents/architecture.md`: the new package and its place between session and
  decision-flow.
- Changeset: minor for the new package (it joins the fixed release group), `@mokei/decision-flow`
  and `@mokei/mcp-system-one`.

## Follow-on

- Tool IDs computed at run time, with per-call approval.
- Standalone binary in `mcp-servers/decision-flow` using a `NodeContextHost` from a config of
  sibling servers.
- A session-backed `llm` node kind using the session's `ModelProvider`.
- A flow-graph `decline` resume event for `input` nodes, so a decline can take its own edge
  instead of cancelling the run.
