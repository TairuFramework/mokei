# @mokei/decision-flow

`@mokei/decision-flow` adds a `decide` node to `@sozai/flow-graph`. The node calls System One,
validates each answer, records safe answer metadata, and lets the flow select the next node.

## Create and check a graph

Pass a `SystemOneClient` and any host actions to `createDecisionFlowGraph`. The factory accepts the
engine's graph options, including actions, retry defaults, clock and random functions, logging, and
error-message recording.

```ts
import { createValidator } from '@sozai/schema'
import { createDecisionFlowGraph, flowDefinitionSchema, formatIssues } from '@mokei/decision-flow'
import supportTriage from './support-triage.json' with { type: 'json' }

const graph = createDecisionFlowGraph({
  client,
  actions: {
    createTicket: async ({ args, invocationID }) => {
      await ticketStore.create(args.ticket, { idempotencyKey: invocationID })
      return { created: true }
    },
  },
})

const validate = createValidator(flowDefinitionSchema)
const validation = validate(supportTriage)
if (validation.issues) throw new Error(formatIssues(validation.issues))

const checked = graph.check(supportTriage)
if (!checked.ok) throw new Error(formatIssues(checked.issues))
```

`flowDefinitionSchema` is the executable authoring schema. `flowStorageSchema` also includes
reserved node kinds for persisted definitions.

## Run and persist

Use `graph.start` when the host must persist every committed state revision. Store each yielded state
with optimistic concurrency on `revision`.

```ts
import type { RunState } from '@sozai/flow-graph'

let runState: RunState | undefined
for await (const state of graph.start({ definition: supportTriage, input: { message: 'Refund status' } })) {
  await stateStore.save(state, { expectedRevision: runState?.revision })
  runState = state
}

```

After a process restart, load the latest persisted state. If its status is still `running`, continue
it with `graph.recover` and persist each yielded revision.

```ts
let runState: RunState = await stateStore.load(runID)
if (runState.status === 'running') {
  for await (const state of graph.recover({ definition: supportTriage, runState })) {
    await stateStore.save(state, { expectedRevision: runState.revision })
    runState = state
  }
}
```

`graph.run` is a convenience for callers that only need the final result and state. Use the
streaming `start`, `resume`, or `recover` methods when every revision must be persisted.

```ts
const result = await graph.run({ definition: supportTriage, input: { message: 'Refund status' } })
if (result.status === 'suspended') {
  await stateStore.save(result.runState, { expectedRevision: previousRevision })
}
```

Persist a suspended `runState`, then pass a validated external value or timeout to `graph.resume`.
Persist every state the iterator yields. Hosts must deduplicate action effects with the stable
`invocationID` and use optimistic concurrency on each state's `revision`.

```ts
for await (const state of graph.resume({
  definition: supportTriage,
  runState,
  event: { type: 'value', value: 'billing' },
})) {
  await stateStore.save(state, { expectedRevision: runState.revision })
  runState = state
}
```

Call `graph.resume` with `{ type: 'timeout' }` only after the pending deadline. If an event arrives
before its deadline, the engine rejects it.

## Tracing, metrics, and privacy

The engine records `flow.segment` and `flow.node` spans. Decision prediction adds a child
`decision.predict` span with `system_one.model`, `system_one.question.count`,
`system_one.usage.input_tokens`, and `system_one.usage.output_tokens`. Failures add `error.type`,
`http.status_code` when available, and `system_one.retry_after_ms` when available.

Each answered question adds a `decision.answer` event to `flow.node`. Its fixed attributes are
`decision.question`, `decision.type`, `decision.choice`, `decision.score`, `decision.noul`, and
`decision.confidence`. Choice labels come from declared criteria. Curated question keys are safe
dimensions; map or drop generated question keys in the collector. Never use `runID` as a metric
dimension.

Use a `count` connector on `decision.answer` for decision distribution per flow, node, and question.
Derive confidence distributions from `decision.confidence` and low-confidence fallback rates from
`flow.branch.case`. Use `spanmetrics` on `decision.predict` for prediction latency, tokens, and
retries.

By default, spans and logs omit resolved state, question instructions, criteria descriptions,
inputs, result payloads, and error messages. Set `recordErrorMessages: true` only when the host
allows error messages to be recorded.
