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
    // Review flow?.tools, the static set of sibling tools this run may call.
    return { approved: await approveRun(flow) }
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

`'auto'` approves flow runs, `'never'` denies them, and `'ask'` emits a pending event then denies
unless an application supplies an approval function. If using `createDecisionFlowServer`
directly, provide its required `approval` hook.

## Tool nodes and delivery

A `tool` node names one static, namespaced tool ID, supplies flow values in `args`, and selects
either `next` or `cases` plus `default`. The checker validates known tool IDs and constant
arguments. At execution, the server validates resolved arguments against the live tool schema;
the called tool's `structuredContent` is required when it declares an output schema. Flow
contexts cannot call one another. Sibling tasks are awaited and cancelled with the parent run.

Tool effects have **at-least-once** delivery. Every sibling call includes
`_meta['io.mokei/idempotency-key'] = <runID>:<invocationID>` and
`_meta['io.mokei/attempt'] = <attempt number>`. The operation key stays the same for a crash
replay or retry of that invocation. A tool that must avoid repeating an effect should deduplicate
on that key; a tool that deliberately repeats per retry may combine the key and attempt.
Predictor calls use `<runID>:<invocationID>:predict` as their operation key. The call also carries
`io.mokei/flow-depth` so nested flow calls can be refused.

A sibling task handle is checkpointed before the flow waits for it. A crash after the sibling
returns a handle but before that checkpoint can leave an orphaned sibling task. Recovery calls
the tool again with the same operation key, so the sibling must deduplicate if duplicate work
would be harmful.

## Input nodes

Input nodes reach the agent's `onElicitation` callback as MCP form elicitation. Their prompt
must resolve to a string. The schema must be a flat object with primitive properties (string,
number, integer, boolean, or string enum), or one primitive or string enum schema, which the
server wraps under a `value` property and unwraps after acceptance. Use an explicit
`type: 'string'` with enums for MCP form compatibility. Nested objects, arrays, and absent
schemas fail `check_flow` with `input_schema_not_elicitable`. Decline or cancel ends the flow
task as cancelled; a deadline resumes its timeout edge.
