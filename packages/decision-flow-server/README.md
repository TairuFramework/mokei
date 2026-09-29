# @mokei/decision-flow-server

Run checked decision flows as MCP tasks. A flow server sits beside the tools it calls in a
`Session`; `decide` nodes use the sibling `system-one:predict` tool by default, and `tool` nodes
call other namespaced tools. The server offers `check_flow`, `run_flow`, and one task tool per
registered flow (`support/triage` becomes `flow_support_triage`). `check_flow` reports issues
without starting a task. The package is Node-free and can also be used with
`createDecisionFlowServer` and a host supplied `ToolCaller` outside a session.

## Wire a session

Register sibling contexts and discover their tools before adding flows. Enable elicitation if a
registered flow contains an `input` node. Call `addDecisionFlow` before creating the agent so its
approval bridge is available at construction.

```ts
import { addDecisionFlow } from '@mokei/decision-flow-server'
import { AgentSession, Session } from '@mokei/session'

const session = new Session({ elicit: true })
// Register and set up `system-one` and any sibling tool contexts here.
const flows = await addDecisionFlow(session, {
  key: 'flow',
  flows: [supportTriage], // optional; omit for agent-authored inline flows
  // store: persistentTaskStore, // optional; memory is the default
})
const agent = new AgentSession({
  session,
  provider,
  model: 'your-model',
  toolApproval: flows.wrapApproval(async ({ flow }) => {
    // Other tools have no flow details; review the static sibling tool plan for flow runs.
    return { approved: flow ? await approveRun(flow) : true }
  }),
  onElicitation: ({ params, signal }) => askUser({ params, signal }),
})

// Later: await agent.dispose(); await flows.dispose(); await session.dispose()
```

`addDecisionFlow` recovers stored tasks before registering its context. A persistent task store
lets runs resume after a process restart. You may also pass a `predictor` to use a
`SystemOneClient` or custom `Predictor` instead of the sibling MCP predictor.

## Approval and grants

`wrapApproval` extends the agent's normal approval strategy. For a flow run, it checks the
definition and presents its complete static tool plan (including `system-one:predict` when
needed). One decision approves the run. An approved call receives a single-use
`io.mokei/flow-grant` token in request `_meta`; the server consumes it before creating a task.
The token is bound to the tool name and arguments, expires after five minutes, and cannot
authorize another call. `check_flow` follows the underlying strategy without a flow grant.

`'auto'` approves flow runs and `'never'` denies them. `'ask'` emits a pending event and denies
with `Tool approval required but no handler configured`; use a function strategy to collect an
interactive decision. Its `FlowApprovalRequest.flow` is present for checked flow runs and absent
for other tools. If using `createDecisionFlowServer` directly, provide its required `approval`
hook.

## Tool nodes and delivery

A `tool` node names one static, namespaced tool ID, supplies flow values in `args`, and selects
either `next` or `cases` plus `default`. The checker validates known tool IDs and constant
arguments. At execution, the server validates resolved arguments against the live tool schema;
the called tool's `structuredContent` is required when it declares an output schema. Flow
contexts cannot call one another. Sibling tasks are awaited and cancelled with the parent run.
The node's `retry.timeoutMs` and `totalTimeoutMs` bound the tool call, not a sibling task wait.
A hung sibling task remains pending until client cancellation or the task TTL ends it.

Tool effects have **at-least-once** delivery. Every sibling call includes
`_meta['io.mokei/idempotency-key'] = <runID>:<invocationID>` and
`_meta['io.mokei/attempt'] = <attempt number>`. The operation key stays the same for a crash
replay or retry of that invocation. A tool that must avoid repeating an effect should deduplicate
on that key; a tool that deliberately repeats per retry may combine the key and attempt.
Predictor calls use `<runID>:<invocationID>:predict` as their operation key. The call also carries
`io.mokei/flow-depth` so nested flow calls can be refused.
The maximum flow depth is 4; calls at that depth or with invalid depth metadata fail with
`Invalid flow depth`.

A sibling task handle is checkpointed before the flow waits for it. A crash after the sibling
returns a handle but before that checkpoint can leave an orphaned sibling task. Recovery calls
the tool again with the same operation key, so the sibling must deduplicate if duplicate work
would be harmful.
At recovery, a changed registered definition fails the task with `Flow definition changed`;
a definition invalid against the current tool catalogue fails it with `Flow no longer valid`.

## Input nodes

Input nodes reach the agent's `onElicitation` callback as MCP form elicitation. Their prompt
must resolve to a string. The schema must be a flat object with primitive properties (string,
number, integer, boolean, or string enum), or one primitive or string enum schema, which the
server wraps under a `value` property and unwraps after acceptance. A string enum may omit
`type: 'string'`; the server adds it to the wire schema. Nested objects, arrays, and absent
schemas fail `check_flow` with `input_schema_not_elicitable`. A constant non-string prompt is
reported as `input_prompt_not_string`, as is a reference that resolves to a non-string at run
time. Decline or cancel ends the flow task as cancelled; a deadline resumes its timeout edge.
