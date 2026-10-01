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
- A recovery-safe shutdown: disposing the flow wiring suspends tasks instead of cancelling their sibling tasks.
- Resumed task work runs under the trace context of its original request.
- A portable elicitation content validator, moved out of `@mokei/host-desktop`.
- The rig rewired onto `@mokei/flow-host`. `scripts/flow-rig/runs.mjs`, `inputs.mjs` and `approval.mjs` are deleted.

Out of scope (later sub-projects): sqlite stores, span and log storage, the OTel SDK, config files, the daemon
protocol, CLI commands, the monitor.

## Package

`packages/flow-host`, published as `@mokei/flow-host`, version and release band as the other packages (0.14.x,
`versioning.fixed`). Dependencies: `@mokei/context-client`, `@mokei/context-protocol`, `@mokei/context-server` (the
`TaskStore` type and `createMemoryTaskStore`), `@mokei/decision-flow-server`, `@mokei/host` (the content validator),
`@mokei/logger`, `@mokei/session`, `@sozai/event`, `@sozai/otel`. No Node built-ins: IDs come from
`crypto.randomUUID()`.

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
  traceID?: string // present when an OTel SDK is registered
  plan: { tools: Array<string> }
  result?: { outcome?: string; output?: unknown; content: Array<ContentBlock> }
  error?: { type: string; message: string; code?: string }
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

export type InboxOutcome = 'answered' | 'declined' | 'cancelled' | 'withdrawn'

export type FlowHostEvents = {
  'run:state': FlowRunSnapshot
  'inbox:added': InboxItem
  'inbox:settled': { item: InboxItem; outcome: InboxOutcome }
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
    cancel(id: string): Promise<void>
  }
  events: EventEmitter<FlowHostEvents>
  dispose(): Promise<void>
}

export type StartRunParams =
  | { flow: string; input?: Record<string, unknown>; label?: string }
  | { definition: FlowDefinition; input?: Record<string, unknown>; label?: string }

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
  digest?: string // registered flows: the registry digest the plan was computed from
  taskID?: string
  traceparent?: string
  cancelRequested?: boolean
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

### Transitions

Every run change goes through one transition helper. It reads the latest record, computes the change from that
record, and writes it with `update(..., { revision })`. On `RunStoreConflictError` it re-reads and re-computes, up to
5 attempts, then throws. Terminal states (`denied`, `completed`, `failed`, `cancelled`) are absorbing: a transition
computed against a terminal record is a no-op. `run:state` fires only after a successful write that changed `state`.

Each run also has one in-process serial queue. Poll application, inbox answers, cancel and start launch for that run
run through it, so they never interleave inside one host.

### Start and approval

1. `start` resolves the request:
   - `{ flow }`: tool name `flowToolName(flow)`. The arguments are `input ?? {}`, since registered flow tools take the
     flow input as their arguments. An unknown flow ID throws `FlowNotFoundError`.
   - `{ definition }`: tool name `run_flow` and arguments `{ definition, input }`. A missing `input` is omitted, so
     the server's default (`{}`) applies.
2. `await wiring.authorize({ toolName, arguments })` checks the flow and returns its plan. A check failure throws
   `FlowCheckError` carrying the issues, and no run is created.
3. The run record is created with the plan, the request and, for registered flows, the digest.
4. When every planned tool matches an `approval.allow` glob, the run launches at once. `*` matches within one `:`
   segment, as in the rig. A plan with no tools launches at once.
5. Otherwise the run stays `awaiting_approval`, and an approval inbox item is added. `start` returns that snapshot.
6. Answering the approval item launches the run. Declining it moves the run to `denied`, with
   `error: { type: 'FlowDenied', message }`. The message is the reason, or `Flow denied`.

### Launch

Launch is the only path that mints a grant:

1. **Claim.** A transition moves the run from `awaiting_approval` (or a new record) to `working` with no `taskID`.
   Only the caller whose write wins continues. A losing approval answer throws `InboxItemNotFoundError`.
2. **Re-authorise.** `authorize` runs again on the stored request. When it fails, or its plan or digest differs from
   the stored ones, the run moves to `failed` with `{ type: 'FlowChanged' }`. No grant is minted.
3. **Call.** `grant()` mints the token, and the run calls the flow tool (see Execution).
4. **Link.** The returned task ID is stored on the run. When `cancelRequested` is set by then, the run cancels the
   task at once.
5. **Failure.** When the call throws, the run moves to `failed` with `{ type: 'StartFailed' }` and the error message.

### `DecisionFlowWiring.authorize`

```ts
authorize(request: { toolName: string; arguments: Record<string, unknown> }): Promise<AuthorizeResult>
type AuthorizeResult =
  | { ok: true; plan: Array<string>; digest?: string; grant(): Record<string, JSONValue> }
  | { ok: false; issues: Array<string> }
```

`authorize` awaits `checkFlow`, as `wrapApproval` does. `digest` is the registry digest of a registered flow, and
absent for `run_flow`. `grant()` returns the `_meta` with a single-use token bound to the tool name, the arguments
and the plan, as `wrapApproval` does today. It is called only at launch, so a queued approval holds no token.
`wrapApproval` is rewritten on top of `authorize`, with no behaviour change.

### Execution

The run calls `client.callTool({ name, arguments, _meta, task: 'handle' })` on the flow context's client, inside the
`flow.run` span context. `_meta` holds the grant, the trace context, and `dev.mokei/flow-run: runID`. The task manager
stores this `_meta` as the task's `requestMeta`, so a task names its run.

A result without a task (an error returned before task creation) settles the run as `failed`, with
`{ type: 'StartFailed' }` and the result's text as the message. Otherwise the run links the task, and a watcher
polls `client.tasks.get(taskID)` every `pollMs`, one poll at a time:

- A snapshot whose `lastUpdatedAt` is older than the last applied one is dropped.
- `working`, `input_required`: the run state follows. Input requests are reconciled (see Inbox).
- `completed` with `isError` absent: `completed`, with `result` from the task result (`structuredContent.outcome`
  and `output` when present).
- `completed` with `isError: true`: `failed`. The flow error is `structuredContent.error`. `error.type` is its
  `lastFailure.type`, else its `name`, else `FlowError`. `error.code` is its `code`. `error.message` is the result
  text.
- `failed`: `failed`, with `error` from the task error (`type: 'TaskFailed'`).
- `cancelled`: `cancelled`.

A poll error is retried with backoff up to 5 s, and the run state does not change. A task-not-found error is the
exception: the run moves to `failed` with `{ type: 'Interrupted' }`, since its task cannot come back. The watcher logs
each failure with `@mokei/logger`.

### Inbox

- Approval items have the ID `${runID}:approval`.
- Input items have the ID `${runID}:${inputKey}`. Input keys are unique per invocation, so an ID is never reused.
- Inbox items are derived state: approvals come from runs in `awaiting_approval`, and inputs come from the latest
  `inputRequests` of each watched task. Nothing about the inbox is stored.
- In memory, the host keeps each listed item's status: `open`, `settling` or `settled`. A settled ID is never listed
  again for that run, even when an older snapshot still shows it. `inbox:settled` fires once per item.
- `elicitation/create` requests in form mode become input items.
- URL-mode elicitation is answered at once with `{ action: 'cancel' }`, and a warning is logged.
- Sampling and roots requests have no cancel response. The run moves to `failed` with `{ type: 'UnsupportedInput' }`
  and the method name, then the host cancels the task.
- `answer(id, content)` on an input item validates `content` against `requestedSchema` with the portable validator.
  Invalid content throws `InboxAnswerInvalidError` with the issues, and the item stays `open`.
- Valid content marks the item `settling`, then sends `tasks.update(taskID, { [inputKey]: { action: 'accept',
  content } })`. On success the item settles with `answered`.
- `decline(id)` on an input item sends `{ action: 'decline' }` and settles with `declined`.
- `cancel(id)` on an input item sends `{ action: 'cancel' }` and settles with `cancelled`.
- On approval items, `answer` launches, `decline` denies and `cancel` cancels the run. `content` is ignored.
- A key that disappears from `inputRequests` while its item is `open` settles with `withdrawn`. A `settling` item is
  left to its pending call.
- A `tasks.update` error moves a `settling` item back to `open` and propagates to the caller. The `-32602` error
  (key no longer awaited) is the exception: the item settles with `withdrawn`, and the call throws
  `InboxItemNotFoundError`.
- An `answer`, `decline` or `cancel` on an unknown, `settling` or settled ID throws `InboxItemNotFoundError`.

### Cancel

`cancel(runID)` works as follows:

- On an `awaiting_approval` run, it moves the run to `cancelled` and settles the approval item with `cancelled`.
- On a `working` run without a `taskID` (launch in progress), it sets `cancelRequested`. Launch cancels the task once
  linked, and moves the run to `cancelled` when the call fails.
- On a run with a task, it calls `client.tasks.cancel(taskID)` and applies the next snapshot.
- On a terminal run, it returns the snapshot unchanged.
- An unknown run ID throws `RunNotFoundError`.

### Events

`run:state` fires on every state change, with the new snapshot. `inbox:added` and `inbox:settled` fire as items
appear and settle.

### Tracing

- `start` opens a `flow.run` span with the attributes `run.id`, `flow.id` (when present) and `run.label`.
- When an OTel SDK is registered, the span's context is stored as `traceparent` on the run record, and its trace ID
  is `traceID`. Without an SDK both are absent, and tracing is a no-op.
- The task call runs inside the span's context, so the existing context-client trace propagation makes the server's
  spans children of `flow.run`.
- State changes add `run.state` span events. The span ends when the run reaches a terminal state, with error status
  for `failed`.
- The task manager runs recovered task work under its stored `requestMeta`, through the context-server
  `withRequestMeta`. Resumed server spans stay in the run's trace.
- After recovery, the host opens a `flow.run.resume` span for its own watching, with the stored `traceparent` as
  remote parent.

### Recovery

`addDecisionFlow` recovers tasks from `taskStore` first. `createFlowHost` then lists non-terminal runs:

- A `working` or `input_required` run with a `taskID` gets a watcher again.
- An `awaiting_approval` run gets its approval item back. Its answer re-authorises, so a changed flow fails with
  `FlowChanged` and never runs an unapproved plan.
- A `working` run without a `taskID` crashed during launch. The host looks for a task whose `requestMeta` carries
  its run ID (`taskStore.list` on non-terminal statuses). A match is linked and watched. Without a match, the run
  moves to `failed` with `{ type: 'Interrupted' }`. The run never launches again, so a crash cannot start a second
  task.
- When `cancelRequested` is set on a run with a task, the host cancels that task.

### Dispose

`dispose()` suspends the host:

1. It stops the watchers. Tasks stay non-terminal in `taskStore`, so a later host on the same stores resumes them.
2. It ends open spans.
3. It disposes the flow wiring.

Today, disposing the task manager aborts task work with a plain error, and the flow driver treats that abort as a
cancel: it cancels its sibling tasks. A recovered flow then finds those siblings cancelled. This sub-project fixes
that:

- `@mokei/context-server` exports `TaskManagerDisposedError`, used as the abort reason on dispose.
- The flow driver skips sibling cleanup when the abort reason is `TaskManagerDisposedError`.

The rig and daemon shutdown cancel runs explicitly when they mean to.

## Portable content validator

`createContentValidator` and `ContentValidator` move from `@mokei/host-desktop` `src/form.ts` to `@mokei/host` as
`createElicitContentValidator` and `ElicitContentValidator`, with the same behaviour and messages.
`@mokei/host-desktop` imports them and keeps its inbox behaviour. `@mokei/host` gains the `@sozai/schema` dependency
when it does not already have it.

## Rig shim

`scripts/flow-rig/serve.mjs` builds a `FlowHost` in place of the run manager. The facade tool names and argument
shapes stay. The rig keeps one desktop elicit handler in dialog mode for its dialogs. `@mokei/host-desktop` exposes
whether that handler can show a request as dialogs (`canPrompt`), from the same dialog plan its inbox uses.

- `start_flow` returns `{ runID }` for a queued run too.
- `flow_status` returns `{ state, pending, result?, error? }` built from the snapshot. `pending` lists the run's
  input items as `{ id, message, requestedSchema, canPrompt }`.
- `prompt_input` shows the item's dialogs with the handler, then maps `accept`, `decline` and `cancel` onto the
  matching `inbox` method. It fails when `canPrompt` is false.
- `answer_input` and `decline_input` map onto the `inbox` methods.
- With `input: dialog`, an `inbox:added` listener prompts each input item the same way, without a tool call.
- Every dialog gets an abort signal that fires when its item settles elsewhere, so a withdrawn or answered item
  closes its dialogs.
- With `confirm: desktop`, an `inbox:added` listener answers approval items with the confirm dialog. `approve` and
  `deny` answer at once.
- Shutdown cancels non-terminal runs, then disposes the host.

The integration suite (`integration-tests/suites/flow-rig.test.ts`) keeps its scenarios. These change:

- A failed flow reports `failed`.
- A denied run reports `denied`, not a `Flow denied` error result.
- `state` values can be `awaiting_approval`.
- The scenario that cleans up a blocking approval dialog becomes a queued start: `start_flow` returns at once, and
  shutdown cancels the queued run and closes its dialog.

## Error types

`FlowNotFoundError`, `FlowCheckError` (`issues`), `RunNotFoundError`, `InboxItemNotFoundError`,
`InboxAnswerInvalidError` (`issues`), `RunStoreConflictError`. Each sets `name`. `InboxAnswerInvalidError` is a new
flow-host class. The `@mokei/host-desktop` class of the same name stays for its own inbox.

## Testing

Unit tests in `packages/flow-host/test/` use a `NodeSession`-free setup: a `Session` with a direct flow context
from `addDecisionFlow`, flows with `input` and `decide` nodes, and a fake predictor. They cover:

- Start a registered flow with required input fields, and an inline flow; `completed` with outcome and output.
- An error result maps to `failed`, with `error.type` from `lastFailure.type` and `error.code` from the flow error.
  A pre-task error result maps to `failed` with `StartFailed`.
- Allowlisted plans start at once. Others queue as `awaiting_approval` with an approval item. Approve starts the
  run. Decline gives `denied`. Cancel while queued gives `cancelled` and settles the item.
- Two concurrent approval answers start one task; the second throws `InboxItemNotFoundError`.
- Cancel during launch cancels the task once linked.
- An input item appears with `requestedSchema`. Valid answers resume the run. Invalid answers throw with issues and
  keep the item. Decline and cancel reach the flow as their own actions.
- A withdrawn input settles with `withdrawn`. A second answer on a settled item throws `InboxItemNotFoundError`.
- A poll that lands while an answer is in flight neither re-lists the item nor settles it as `withdrawn`.
- A URL-mode input is cancelled and never listed. A sampling request fails the run with `UnsupportedInput`.
- Cancel of a working run gives `cancelled`. A late poll never moves a terminal run.
- Events fire in order for one run.
- Recovery on the same memory stores:
  - a host disposed mid-input lists the input item again and completes when it is answered;
  - a queued approval survives;
  - a host disposed while the flow awaits a sibling task resumes that wait, and the sibling is not cancelled;
  - a `working` run without a `taskID` links the task that names it, or fails with `Interrupted`;
  - a registered flow changed between queueing and approval fails with `FlowChanged`.
- Tracing, with an in-memory span exporter from `@opentelemetry/sdk-trace-base` (dev dependency only):
  - server spans share the run's `traceID`, and `flow.run` ends with the run;
  - resumed server spans share the stored trace ID after recovery;
  - without an SDK, runs have no `traceID` and work the same.
- `authorize`: plan, digest and grant for an allowlisted call; issues for an invalid inline definition;
  `wrapApproval` tests unchanged.
- `@mokei/context-server`: dispose aborts work with `TaskManagerDisposedError`; recovered work runs under its
  stored trace context.
- Content validator tests move to `@mokei/host` with the code.

The rig unit tests that cover deleted modules are deleted. `create-rig.test.mjs` and `config.test.mjs` stay. The
integration suite runs on the shim.

## Risks

- **Grant binding.** The grant binds tool name, arguments and plan. Launch re-authorises the stored request and
  checks plan and digest, so the grant matches what the approver saw.
- **Single-host queue.** The per-run queue serialises work inside one host only. Two hosts on one store are not
  supported. Compare-and-set still keeps the store consistent.
- **Poll cost.** A 500 ms poll per running run is fine for a single user. Subscriptions can replace polling later.
