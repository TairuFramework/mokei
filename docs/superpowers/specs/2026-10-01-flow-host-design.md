# Flow runtime (`@mokei/flow-host`) -- design

**Date:** 2026-10-01
**Milestone:** flow daemon (`docs/agents/plans/milestones/2026-10-01-flow-daemon-milestone.md`), sub-project 1
**Branch:** `feat/flow-host`

## Goal

Move the flow rig's run logic into a portable package, so the daemon, the CLI and tests drive decision flows through
one API. The package owns run identity, approval, the inbox of inputs and approvals, state mapping, tracing and
recovery. The rig becomes a thin shim over it, and its integration suite proves the API end to end.

## Scope

In scope:

- A new package `@mokei/flow-host`, portable (no Node built-ins), with memory stores.
- `DecisionFlowWiring.authorize`, a public approval call that returns a flow grant without `AgentSession`.
- A portable elicitation content validator, moved out of `@mokei/host-desktop`.
- The rig rewired onto `@mokei/flow-host`. `scripts/flow-rig/runs.mjs`, `inputs.mjs` and `approval.mjs` are deleted.

Out of scope (later sub-projects): sqlite stores, span and log storage, the OTel SDK, config files, the daemon
protocol, CLI commands, the monitor.

## Package

`packages/flow-host`, published as `@mokei/flow-host`, version and release band as the other packages (0.14.x,
`versioning.fixed`). Dependencies: `@mokei/context-client`, `@mokei/context-protocol`, `@mokei/context-server` (the
`TaskStore` type and `createMemoryTaskStore`), `@mokei/decision-flow-server`, `@mokei/host` (the content validator),
`@mokei/session`, `@sozai/event`, `@sozai/otel`. No Node built-ins: IDs come from `crypto.randomUUID()`.

## API

```ts
export type RunState =
  | 'awaiting_approval'
  | 'denied'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type FlowRunSnapshot = {
  runID: string
  flowID?: string // absent for inline definitions
  label: string // the flow name, or the caller's label
  state: RunState
  createdAt: number // epoch ms
  updatedAt: number
  traceID: string
  plan: { tools: Array<string> }
  result?: { outcome?: string; output?: unknown; content: Array<ContentBlock> }
  error?: { type: string; message: string }
}

export type InboxItem =
  | { id: string; runID: string; kind: 'approval'; plan: { tools: Array<string> }; createdAt: number }
  | {
      id: string
      runID: string
      kind: 'input'
      inputKey: string
      message: string
      requestedSchema: RequestedSchema
      createdAt: number
    }

export type FlowHostEvents = {
  'run:state': FlowRunSnapshot
  'inbox:added': InboxItem
  'inbox:settled': { item: InboxItem; outcome: 'answered' | 'declined' | 'withdrawn' }
}

export type FlowHostParams = {
  session: Session
  key?: string // flow context key, default 'flow'
  flows?: Array<FlowDefinition>
  predictor?: Predictor | PredictorFactory
  approval?: { allow?: Array<string> } // tool-id globs
  runStore?: RunStore // default createMemoryRunStore()
  taskStore?: TaskStore // default createMemoryTaskStore(), passed to addDecisionFlow
  pollMs?: number // default 500
}

export type FlowHost = {
  flows(): Array<FlowSummary>
  check(definition: unknown): ReturnType<typeof checkFlow>
  start(params: StartRunParams): Promise<FlowRunSnapshot>
  get(runID: string): Promise<FlowRunSnapshot | undefined>
  list(filter?: { states?: Array<RunState>; limit?: number }): Promise<Array<FlowRunSnapshot>>
  cancel(runID: string): Promise<FlowRunSnapshot>
  inbox: {
    list(filter?: { runID?: string }): Array<InboxItem>
    get(id: string): InboxItem | undefined
    answer(id: string, content?: Record<string, unknown>): Promise<void>
    decline(id: string, reason?: string): Promise<void>
  }
  events: EventEmitter<FlowHostEvents>
  dispose(): Promise<void>
}

export type StartRunParams =
  | { flow: string; input?: unknown; label?: string }
  | { definition: FlowDefinition; input?: unknown; label?: string }

export function createFlowHost(params: FlowHostParams): Promise<FlowHost>
```

`createFlowHost` calls `addDecisionFlow(session, { key, flows, predictor, store: taskStore })`, then recovers runs
(see Recovery). It throws when `session.contextHost.elicitationEnabled` is false, since flows that ask for input need
the capability advertised. The session's own elicit handler is never called for runs.

### Run store

```ts
export type RunRecord = FlowRunSnapshot & {
  revision: number
  request: { toolName: string; arguments: Record<string, unknown> }
  taskID?: string
  traceparent: string
  denyReason?: string
}

export type RunStore = {
  create(record: RunRecord): Promise<void>
  get(runID: string): Promise<RunRecord | undefined>
  update(runID: string, patch: Partial<RunRecord>, expected: { revision: number }): Promise<RunRecord>
  list(filter: { states?: Array<RunState>; limit?: number }): Promise<Array<RunRecord>>
  delete(runID: string): Promise<void>
}

export class RunStoreConflictError extends Error {}
export function createMemoryRunStore(): RunStore
```

The shape mirrors `TaskStore`: compare-and-set on `revision`, copies in and out. `list` returns newest first.

## Behaviour

### Start and approval

1. `start` resolves the request:
   - `{ flow }`: tool name `flowToolName(flow)` and arguments `{ input }`. An unknown flow ID throws
     `FlowNotFoundError`.
   - `{ definition }`: tool name `run_flow` and arguments `{ definition, input }`. A missing `input` is omitted, so
     the server's default (`{}`) applies.
2. `wiring.authorize({ toolName, arguments })` checks the flow and returns its plan. A check failure throws
   `FlowCheckError` carrying the issues, and no run is created.
3. When every planned tool matches an `approval.allow` glob, the run is approved at once. `*` matches within one
   `:` segment, as in the rig. A plan with no tools is approved.
4. Otherwise the run is stored as `awaiting_approval`, and an approval inbox item is added. `start` returns that
   snapshot.
5. Answering the approval item mints the grant through `authorize` and starts the task. Declining it moves the run
   to `denied`, with the reason in `error`: `{ type: 'FlowDenied', message }`.

### `DecisionFlowWiring.authorize`

```ts
authorize(request: { toolName: string; arguments: Record<string, unknown> }): AuthorizeResult
type AuthorizeResult =
  | { ok: true; plan: Array<string>; grant(): Record<string, JSONValue> } // grant() returns the _meta
  | { ok: false; issues: Array<string> }
```

`grant()` issues a single-use token bound to the tool name and arguments, as `wrapApproval` does today. It is
called only at task start, so a queued approval holds no token. `wrapApproval` is rewritten on top of `authorize`,
with no behaviour change.

### Execution

The run calls `client.callTool({ name, arguments, _meta: { ...grant, traceparent }, task: 'handle' })` on the flow
context's client. A result without a task (an error returned before task creation) settles the run as `failed`, with
the result's text as the error message. Otherwise the run stores `taskID`, moves to `working`, and a watcher polls
`client.tasks.get(taskID)` every `pollMs`:

- `working`, `input_required`: the run state follows. Input requests are reconciled (see Inbox).
- `completed` with `isError` absent: `completed`, with `result` from the task result (`structuredContent.outcome`
  and `output` when present).
- `completed` with `isError: true`: `failed`. `error.type` is `structuredContent.error.type` when present, else
  `FlowError`. `error.message` is the result text.
- `failed`: `failed`, with `error` from the task error (`type: 'TaskFailed'`).
- `cancelled`: `cancelled`.

A poll error is retried with backoff up to 5 s, and the run state does not change. A task-not-found error is the
exception: the run moves to `failed` with `{ type: 'Interrupted' }`, since its task cannot come back. The watcher logs each
failure with `@mokei/logger`.

### Inbox

- Approval items have the ID `${runID}:approval`.
- Input items have the ID `${runID}:${inputKey}`.
- Inbox items are derived state: approvals come from runs in `awaiting_approval`, and inputs come from the latest
  `inputRequests` of each watched task. Nothing about the inbox is stored separately.
- Only `elicitation/create` requests in form mode become input items. Any other input request (sampling, roots, URL
  mode) is answered at once with a cancel response. A warning is logged.
- `answer(id, content)` on an input item validates `content` against `requestedSchema` with the portable validator.
  Invalid content throws `InboxAnswerInvalidError` with the issues. Valid content is sent with
  `tasks.update(taskID, { [inputKey]: { action: 'accept', content } })`.
- `decline(id)` on an input item sends `{ action: 'decline' }`.
- On approval items, `answer` approves and `decline` denies. `content` is ignored for approvals.
- A key that disappears from `inputRequests` while still listed settles with `withdrawn`.
- An `answer` or `decline` on an unknown or settled ID throws `InboxItemNotFoundError`.
- `tasks.update` errors propagate to the caller, and the item stays listed.

### Cancel

`cancel(runID)` works as follows:

- On an `awaiting_approval` run, it moves the run to `cancelled` and removes the approval item.
- On a running run, it calls `client.tasks.cancel(taskID)` and applies the next snapshot.
- On a terminal run, it returns the snapshot unchanged.
- An unknown run ID throws `RunNotFoundError`.

### Events

`run:state` fires on every state change, with the new snapshot. `inbox:added` and `inbox:settled` fire as items
appear and leave.

### Tracing

- `start` opens a `flow.run` span with the attributes `run.id`, `flow.id` (when present) and `run.label`.
- The span's context is stored as `traceparent` on the run record. Its trace ID is `traceID`.
- The task call runs inside the span's context, so the existing context-client trace propagation makes the server's
  spans children of `flow.run`.
- State changes add `run.state` span events. The span ends when the run reaches a terminal state, with error status
  for `failed`.
- After recovery, a `flow.run.resume` span is opened with the stored `traceparent` as remote parent. The run stays
  one trace.

### Recovery

`addDecisionFlow` already recovers interrupted tasks from `taskStore`. `createFlowHost` then lists non-terminal
runs:

- A `working` or `input_required` run with a `taskID` gets a watcher again.
- An `awaiting_approval` run gets its approval item back.

A non-terminal run without a `taskID` that is not `awaiting_approval` cannot be resumed. It moves to `failed` with
`{ type: 'Interrupted' }`.

### Dispose

`dispose()` works as follows:

1. It stops the watchers and leaves tasks running, so a later host on the same stores can resume them.
2. It ends open spans.
3. It disposes the flow wiring.

The rig and daemon shutdown cancel runs explicitly when they mean to.

## Portable content validator

`createContentValidator` and `ContentValidator` move from `@mokei/host-desktop` `src/form.ts` to `@mokei/host` as
`createElicitContentValidator` and `ElicitContentValidator`, with the same behaviour and messages.
`@mokei/host-desktop` imports them and keeps its inbox behaviour. `@mokei/host` gains the `@sozai/schema` dependency
when it does not already have it.

## Rig shim

`scripts/flow-rig/serve.mjs` builds a `FlowHost` in place of the run manager. The facade tool names and argument
shapes stay. Results change as follows:

- `start_flow` returns `{ runID }` for a queued run too.
- `flow_status` returns `{ state, pending, result?, error? }` built from the snapshot. `pending` lists the run's
  input items as `{ id, message, requestedSchema, canPrompt: true }`.
- `prompt_input` opens a desktop dialog through `createDesktopElicitHandler({ mode: 'dialog' })` for the item, then
  calls `answer` or `decline`.
- `answer_input` and `decline_input` map onto the `inbox` methods.
- With `confirm: desktop`, the rig answers approval items from an `inbox:added` listener with its confirm dialog.
  `approve` and `deny` answer at once.
- Shutdown cancels non-terminal runs, then disposes the host.

The integration suite (`integration-tests/suites/flow-rig.test.ts`) keeps its scenarios. Assertions that pinned old
behaviour change:

- A failed flow reports `failed`.
- A denied run reports `denied`, not a `Flow denied` error result.
- `state` values can be `awaiting_approval`.

## Error types

`FlowNotFoundError`, `FlowCheckError` (`issues`), `RunNotFoundError`, `InboxItemNotFoundError`,
`InboxAnswerInvalidError` (`issues`), `RunStoreConflictError`. Each sets `name`. `InboxAnswerInvalidError` is a new
flow-host class. The `@mokei/host-desktop` class of the same name stays for its own inbox.

## Testing

Unit tests in `packages/flow-host/test/` use a `NodeSession`-free setup: a `Session` with a direct flow context
from `addDecisionFlow`, flows with `input` and `decide` nodes, and a fake predictor. They cover:

- Start a registered flow and an inline flow; `completed` with outcome and output.
- An error result maps to `failed` with the flow error type. A pre-task error result maps to `failed`.
- Allowlisted plans start at once. Others queue as `awaiting_approval` with an approval item. Approve starts the
  run. Decline gives `denied`. Cancel while queued gives `cancelled` and removes the item.
- An input item appears with `requestedSchema`. Valid answers resume the run. Invalid answers throw with issues and
  keep the item. Decline is passed to the flow.
- A withdrawn input settles with `withdrawn`. A second answer on a settled item throws `InboxItemNotFoundError`.
- A non-elicitation input request is cancelled and never listed.
- Cancel of a working run gives `cancelled`.
- Events fire in order for one run.
- Recovery: a host disposed mid-input, then recreated on the same memory stores, lists the input item again and
  completes when it is answered. A queued approval survives the same way.
- Tracing: with an in-memory span exporter from `@opentelemetry/sdk-trace-base` (dev dependency only), the server
  spans share the run's `traceID`, and `flow.run` ends with the run.
- `authorize`: plan and grant for an allowlisted call; issues for an invalid inline definition; `wrapApproval`
  tests unchanged.
- Content validator tests move to `@mokei/host` with the code.

The rig unit tests that cover deleted modules are deleted. `create-rig.test.mjs` and `config.test.mjs` stay. The
integration suite runs on the shim.

## Risks

- **Withdrawal timing.** An input key can disappear between a `list` and an `answer`. The `tasks.update` error
  (`-32602`) is mapped to `InboxItemNotFoundError`, as the rig does today.
- **Grant binding.** The grant binds tool name and arguments. The run stores the exact request, so the arguments
  sent after approval are the same object that was authorised.
- **Poll cost.** A 500 ms poll per running run is fine for a single user. Subscriptions can replace polling later.
