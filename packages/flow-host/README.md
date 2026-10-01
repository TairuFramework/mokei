# @mokei/flow-host

Run decision flows in the background: approval, an inbox for inputs and approvals, recovery after restart, and a `flow.run` trace span per run.

## Installation

```sh
pnpm add @mokei/flow-host
```

## Task lifetime and recovery

`createFlowHost` accepts `taskTTLMs?: number | null`. It defaults to `null`, so tasks do not expire while awaiting input.
Set a number to expire tasks that many milliseconds after creation. Direct `addDecisionFlow` calls retain the one-hour default when omitted.

Recovery events fire during `createFlowHost`. Pass handlers through the optional `listeners` parameter to receive them. Alternatively, after creation resolves, reconcile from `list()` and `inbox.list()`, then rely on events.

Terminal runs withdraw remaining inbox items and remove their in-memory entries. Reading a removed item throws `InboxItemNotFoundError`.
