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
  task handles (`requestInput`, `awaitInput`), `tasks.recover`, and the client's
  `callTool({ task: 'handle' })` and `tasks.wait(taskId)`. This branch starts from that one;
  implementation waits until it merges.
- Session elicitation (`feat/session-elicitation`): `ContextHost` elicitation handlers and
  `AgentSession`'s `onElicitation`. Flow `input` nodes reach the user through it.
- `@sozai/flow-graph` 0.1.0 and `@mokei/decision-flow` as they are today.

## Package

New package `@mokei/decision-flow-server` in `packages/` (approved). Dependencies:
`@mokei/decision-flow`, `@mokei/context-server`, `@mokei/context-protocol`,
`@mokei/context-client` (types), `@mokei/session` (wiring helper), `@sozai/flow-graph`,
`@mokei/system-one-client` (types). `@mokei/decision-flow` itself is unchanged.

## Components

### ToolCaller

```ts
type CatalogTool = { id: string; inputSchema: Schema; outputSchema?: Schema }
type ToolCaller = {
  listTools(): Array<CatalogTool>
  callTool(params: {
    id: string
    arguments: Record<string, JSONValue>
    signal: AbortSignal
  }): Promise<ToolCallOutcome>
  waitTask(params: { id: string; taskId: string; signal: AbortSignal }): Promise<CallToolResult>
  cancelTask(params: { id: string; taskId: string }): Promise<void>
}
type ToolCallOutcome = { result: CallToolResult } | { task: { taskId: string } }
```

- `hostToolCaller(host, { exclude })` adapts a `ContextHost`. Tool IDs are namespaced
  (`contextKey:toolName`, `local:name` for local tools). `exclude` lists context keys hidden from
  the catalogue and refused by `callTool`; the wiring helper always excludes the flow server's
  own key, so a flow cannot call itself.
- `callTool` asks the sibling for a task handle (`task: 'handle'`) when the sibling's client
  supports the tasks extension, and returns `{ task }` when the sibling answers with one;
  otherwise it returns `{ result }`.
- `listTools` reads the host's current tool lists, so the catalogue follows contexts being added
  and removed.

### `tool` node kind

```ts
type ToolNode = {
  kind: 'tool'
  description?: string
  tool: string | Value
  args: Record<string, Value>
  next?: string
  cases?: Array<{ when: Filter; to: string }>
  default?: string
  onError?: string
  retry?: FlowRetryPolicy
}
```

- Exactly one of `next` or `cases` + `default`; the checker reports anything else.
- Check, against the catalogue at check time:
  - a string `tool` that is not in the catalogue: `unknown_tool` (with the available IDs as the
    hint);
  - constant `args` values validated against the tool's `inputSchema`; referenced values are
    checked when the checker knows the source's result schema;
  - the node's result schema is the tool's `outputSchema` when present, else any JSON value, so
    later filters on result paths are checked.
- Execute:
  - `structuredContent` becomes the node result; without it, the text content joined, parsed as
    JSON when it parses, else the string.
  - `isError: true`: node failure with code `tool_error`, then retry or `onError`.
  - A thrown call error: node failure with code `tool_call_failed`; retryable by the node's
    retry policy.
  - A task handle from the sibling: the node suspends with
    `pending.data = { tool: id, taskId }`. The driver awaits the task (see Lifecycle) and
    resumes the node with `{ type: 'value', value: { ok: true, result } }` or
    `{ ok: false, error: { code, message } }`. The node's `resume` maps `ok: false` to a node
    failure (`tool_task_failed` or `tool_task_cancelled`).
- A `Value`-typed `tool` is resolved at run time and must be a string naming a catalogue tool;
  approval for it follows the per-call rule below.

### MCP-backed System One client

`createMCPSystemOneClient(caller, { tool = 'system-one:predict' })` implements
`SystemOneClient.predict` by calling that tool and validating its structured result with the
existing System One result validation. It is the default `decide` backend; the application may
pass any `SystemOneClient` (HTTP, laya) instead.

### Server

`createDecisionFlowServer({ caller, systemOne, tasks, flows, approve, approveCall })` returns
the server definition for a `ContextServer`.

Tools:

| Tool | Mode | Input | Result |
|---|---|---|---|
| `check_flow` | synchronous | `{ definition }` | `{ ok, issues, formatted }` (`formatted` from `formatIssues`) |
| `run_flow` | task | `{ definition, input? }` | flow result (see Lifecycle) |
| one per registered flow | task | the flow's `input` schema | flow result |

- Registered-flow tool names derive from the flow `id` (`support/triage` becomes
  `flow_support_triage`); a collision fails server construction.
- Task-mode tools require the client to declare the tasks extension; otherwise the call fails
  with `-32021` (MCP Tasks rule).
- `check_flow` and every run check the definition against the live catalogue.
  `check_flow` adds a non-blocking warning when the definition has `input` nodes and the server
  was built without an input path (see Session wiring).

### Session wiring

`addDecisionFlow(agent, { key = 'flow', flows, systemOne?, store? })`:

- builds a `hostToolCaller` over `agent.session.contextHost` excluding `key`;
- creates a `TaskManager` (memory store unless `store` is passed), the server, and registers it
  as a direct context under `key`;
- wraps the agent's tool approval so `key:*` calls pass the session gate, and routes the
  server's `approve` / `approveCall` to the agent's `toolApproval` (see Approval);
- requires elicitation to be enabled on the session's host when any registered flow has an
  `input` node; otherwise it throws at wiring time.

## Lifecycle

### Start

- `run_flow` and registered-flow tools call `tasks.create`.
- An invalid inline definition returns an `isError` tool result with the formatted issues; no
  task is created.
- The plan is approved before the task is created (see Approval).
- The task's `resumeData` is
  `{ v: 1, flow: { definition } | { id, digest }, approved: Array<string>, runState }`. Inline
  flows are stored whole; registered flows by `id` and `digest`.

### Drive

- The driver iterates the `FlowRun`. Each committed `RunState` is written to `resumeData` with
  the task store's revision compare-and-swap.
- `node:enter` sets `statusMessage` to `Running node <id>`.

### Suspensions

| Pending | Driver |
|---|---|
| `input` node (`reason: 'suspend'`) | `requestInput` with one `elicitation/create` request: `message` from the prompt, `requestedSchema` from the schema, wrapped as `{ type: 'object', properties: { value: schema }, required: ['value'] }` when it is not a flat object schema. `awaitInput` races the deadline. Response: `accept` resumes `{ type: 'value', value }` (unwrapped); `decline` or `cancel` resumes `{ type: 'timeout' }` when the node declares a `timeout`, else aborts the run (task cancelled); deadline resumes `{ type: 'timeout' }`. |
| `tool` node waiting on a sibling task | `caller.waitTask`, then resume as described under the `tool` node kind. |
| retry (`reason: 'retry'`, `resumeAt`) | Timer until `resumeAt`, then `resume({ type: 'retry' })`. |

### End

| Run status | Task outcome |
|---|---|
| `ended` | completed: `structuredContent: { outcome, output }`, text summary |
| `error` | completed with `isError: true`, `structuredContent: { error: RunError }` |
| `aborted` | cancelled |

A flow error is a tool-level result, not a JSON-RPC error, so the model can read it and repair
the flow.

### Cancel

`tasks/cancel` or the caller's abort aborts the run's signal. A pending sibling task is
cancelled with `caller.cancelTask`.

### Recovery

- `tasks.recover` rebuilds the graph for each record and re-checks the flow against the current
  catalogue. A failing check fails the task with `Flow no longer valid:` and the formatted
  issues.
- `running`: `graph.recover`.
- `suspended`: re-enter the wait for its pending reason (input via `awaitInput`, sibling task via
  `waitTask` using `pending.data.taskId`, retry via its timer).
- A registered flow whose `digest` no longer matches fails the task with
  `Flow definition changed`.
- The in-session default is the memory store, where recovery has nothing to do; it matters when
  the application passes a persistent `TaskStore`.

## Approval

Plan-level approval, with a per-call fallback.

- Before creating the task, the server computes the static plan: every `tool` node whose `tool`
  is a string, plus the System One tool when `decide` nodes use the MCP-backed client.
- `approve({ flow: { id?, name, inline }, tools, input })` returns `{ approved, reason? }`.
  Denied: `isError` result `Flow denied: <reason>`, no task.
- A `Value`-typed `tool` that resolves outside the approved set calls
  `approveCall({ tool, args })`. Denied: node failure `tool_denied`, not retryable, then
  `onError`.
- The approved set is stored in `resumeData`; recovery does not ask again.
- Bridge to `AgentSession` `toolApproval`:
  - `'auto'`: approve;
  - `'never'`: deny;
  - `ToolApprovalFn`: called with `ToolApprovalRequest` extended by `kind: 'flow-plan'` and
    `tools` (plan) or `kind: 'flow-call'` (per-call);
  - `'ask'`: the pending event is emitted, then denied (today's meaning of `'ask'`).
  - `key:*` tool calls themselves are auto-approved at the session gate, so the user is asked
    once per run, not twice.

## Errors

| Case | Result |
|---|---|
| Invalid inline definition | `isError` result with formatted issues, no task |
| Plan denied | `isError` result `Flow denied: <reason>`, no task |
| Client lacks tasks extension | `-32021` |
| Tool `isError` | node failure `tool_error` |
| Tool call throws | node failure `tool_call_failed` (retryable) |
| Sibling task failed / cancelled | node failure `tool_task_failed` / `tool_task_cancelled` |
| Per-call approval denied | node failure `tool_denied` |
| Flow calls `key:*` | `unknown_tool` at check time |
| Flow run ends in `error` | task completed, `isError: true`, `RunError` |
| Catalogue drift at recovery | task failed, `Flow no longer valid` |
| Registered flow changed at recovery | task failed, `Flow definition changed` |
| No elicitation for `input` node | wiring throws (registered flows) or task cancelled with `TaskInputUnavailableError` (inline) |

## Testing

- Unit (`tool` kind, fake `ToolCaller`): check against input and output schemas, `unknown_tool`,
  result mapping (structured, text, JSON text), `isError`, thrown errors, suspend on sibling task
  and resume both ways, `Value`-typed tool resolution.
- Unit (MCP System One client): structured result validation, error mapping.
- Server (in-memory `ContextServer` and client, MCP Tasks): `check_flow`, inline `run_flow` to
  completion, registered-flow tools, input via elicitation, deadline timeout, cancel (including
  sibling task cancel), plan denial, per-call denial, recovery from a stored `RunState` for
  running and each suspended reason, catalogue drift and digest change at recovery.
- Session wiring: plan approval through each `toolApproval` strategy, single prompt per run,
  recursion refused, wiring throws without elicitation when registered flows need input.
- Integration (`integration-tests`): an `AgentSession` with a stub sibling server and
  `mcp-servers/system-one` on its stub backend runs the support-triage example end to end,
  including an `input` answered through `onElicitation`; an optional laya-gated variant.

## Docs and release

- Package README: concepts, wiring, approval, the `tool` node kind.
- `docs/agents/architecture.md`: the new package and its place between session and
  decision-flow.
- Changeset: minor for the new package (it joins the fixed release group).

## Follow-on

- Standalone binary in `mcp-servers/decision-flow` using a `NodeContextHost` from a config of
  sibling servers.
- A session-backed `llm` node kind using the session's `ModelProvider`.
