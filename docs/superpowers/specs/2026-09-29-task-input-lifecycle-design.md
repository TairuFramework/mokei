# Task input lifecycle design

Date: 2026-09-29
Status: draft, pending user review

## Goal

Make task input requests (`TaskHandle.requestInput`, `tasks/update`, `TaskWaiter` input dispatch)
correct under withdrawal, cancellation, concurrent answers and crash recovery. Today the state of
one request is split between the persisted task record and in-memory structures in `TaskManager`
(a pending deferred per task, abort listeners, the attach path). Every race between the two needs
its own rule. This design keeps a single source of truth: the persisted record. In-memory code
only observes committed records.

It provides the contract the host desktop interaction design relies on (withdrawal reaches the
handler, a late answer is harmless, snapshots are consistent) and fixes decision-flow recovery of
input nodes.

Builds on `feat/decision-flow-server` (PR #62), which already rejects a response for a key that is
not outstanding with `-32602` `Task is not awaiting input for <key>` and `data: { key }`, and
makes the waiter re-read the task on that rejection.

## Assumptions

- The MCP Tasks extension is unreleased (its changeset is pending) and no persistent `TaskStore`
  ships. There are no persisted records in the old shape, so the record shape changes freely and
  there is no migration or legacy handling.
- A task has at most one open input request at a time. Decision-flow asks sequentially.
- Input keys are unique per task. The task manager enforces this, and a server must not
  reuse a key: `tasks/update` carries a key and a response, with no request version.

## Record

`TaskRecord` replaces `inputRequests`, `inputResponses` and `issuedInputKeys` with one field
that keeps every request the task has made. The history is bounded by the task's lifetime and
TTL.

```ts
type InputRecord = {
  id: number                                  // increments per request on this task
  requests: Record<string, InputRequest>
  responses: Record<string, InputResponse>
  outcome?: 'answered' | 'withdrawn'          // absent while open
}
// TaskRecord.inputs: Array<InputRecord>  — every request, in id order
```

The **latest** request is the last entry of `inputs`. A request is **open** when the task status
is `input_required` and the latest request has no `outcome`. Status and `outcome` change
together in the same write. A terminal status therefore ends an open request without setting an
outcome, and no later transition can reopen it. Issued keys are the keys of every entry in
`inputs`.

A settled entry never changes again. Every committed record from that point on contains its
outcome, so an observer never needs to see commits in order.

## Transitions

Each transition is one conditional `#mutate` (revision check, re-read and retry on conflict). It
emits one `taskStatus` event. When its precondition fails after a re-read, it makes no write.

| Transition | Precondition | Write |
|---|---|---|
| ask(requests) | status `working`; no key already issued | append `{ id: inputs.length + 1, requests, responses: {} }`, status `input_required` |
| answer(key, response) | latest request open; `key` in its `requests` and not in its `responses` | add response; if every key is answered: `outcome: 'answered'`, status `working` |
| withdraw(id) | latest request open and its `id` is `id` | `outcome: 'withdrawn'`, status `working` |
| terminal (complete, fail, cancel) | existing rules | status terminal; `inputs` unchanged |

`lastUpdatedAt` is strictly increasing per task. When the clock reading is not after the stored
value, `#mutate` writes the stored value plus one millisecond. Distinct revisions never share a
timestamp, so the waiter's existing older-than check orders snapshots from notifications and
`tasks/get` alike.

The public snapshot (`detailed()`) is derived from the latest request. When a request is open, it shows
status `input_required` and `inputRequests` holding the keys that are not yet answered. This set
is never empty, because the final answer closes the request in the same write. Otherwise it
shows no `inputRequests`.

`tasks/update` applies `answer` for each key in one write. It rejects the whole update with the
PR #62 error when any key fails the precondition.

## Waiting

In-memory state is one listener set per task. After every committed write, `#mutate` passes the
committed record to that task's listeners, possibly out of order. Nothing in memory owns a request, and there is no
pending deferred, slot or claim.

`waitForOutcome(taskID, id)` resolves from committed records only. It first registers the
listener, then reads the record once, so it also sees a commit made before registration. It
checks each record it sees, in this order:

1. Entry `id` has `outcome: 'answered'`: resolve with its `responses`.
2. Entry `id` has `outcome: 'withdrawn'`: reject with `InputRequestWithdrawnError({ taskID, id })`,
   which is new and exported from `@mokei/context-server`.
3. The task is terminal, or deleted: reject with the task's end reason.
4. Otherwise, keep waiting.

Settled outcomes and terminal status never revert, so a stale record can only lead to step 4.
The waiter unregisters when it settles.

Expiry is observable too. It deletes the record directly from the store
(`task-manager.ts:260-265`), not through `#mutate`. After deleting, the expiry path calls the
task's listeners with `undefined`, meaning deleted, and step 3 rejects with a task-expired error.
An answer committed just before expiry may be lost to a waiter that has not yet seen it. That is
acceptable: expiry ends the task's lifetime and aborts its worker.

Any number of callers may wait on the same request.

## `requestInput(requests, { signal })`

1. Read the record and look up the request by its keys:
   - **Same request exists.** An entry in `inputs` has exactly these keys and deep-equal
     `requests`, whether it is open or settled. Use its `id`. This one rule covers recovery re-attach, replay of an
     answer committed before a crash, and replay of a withdrawal.
   - **Changed request.** Any requested key is already issued, and no entry matches as above. Throw `TaskInputKeyReusedError`.
   - **New request.** Apply `ask`. If it fails because another request is open, throw
     `Input is already outstanding`. If `signal` is already aborted, throw its reason without
     writing.
2. If `signal` is given, on abort (or when it is already aborted) apply `withdraw(id)`. This is a
   no-op when the request already has an outcome. If the withdraw write fails with a store
   error, retry with bounded backoff until it commits or the request settles.
3. Return `waitForOutcome(taskID, id)`. The outcome is always what the record committed: an
   answer that won the race resolves, even when the signal aborted.

`awaitInput({ signal })` is `requestInput` for the open request, if any. With no open request it
throws `No input is outstanding`.

## Recovery

`TaskManager.recover` needs no input logic. A recovered worker calls `requestInput` with the same
requests, and the lookup returns the stored outcome or re-attaches to the open request.

Decision-flow driver changes (on `feat/decision-flow-server` once this lands):

- **Recovered input node with the deadline passed during downtime.** Rebuild the request and
  call `requestInput` with an aborted signal. The key and contents are deterministic from the run
  state and `inputSeq`. The outcome decides:
  - `answered`: handle the responses as on the live path (`accept` gives the value; `decline`
    and `cancel` cancel the task);
  - `InputRequestWithdrawnError`, or the abort reason for a request never issued: take the
    timeout edge.
- **`TaskInputKeyReusedError` fails the run.** Remove the `inputSeq` re-ask. With deterministic
  requests and digest-checked definitions, reuse means a bug.
- **Map only the timeout signal to the timeout edge.** Only the deadline abort reason, or
  `InputRequestWithdrawnError` after the deadline, maps to the timeout edge. Other rejections
  propagate.

## Client (`TaskWaiter`)

- Each dispatch of a key has its own `AbortController`, linked to the entry's controller.
- When an accepted snapshot no longer lists an in-flight key, abort that dispatch with
  `TaskInputWithdrawnError({ taskID, key })`, exported from `@mokei/context-client`.
- Before `tasks/update`, submit only when the dispatch is unaborted and the key is still listed.
  An aborted dispatch's rejection never sets `inputError`.
- On the PR #62 rejection, re-read with `tasks/get` (already implemented).
- `onStatus` reports only snapshots the waiter accepted.
- **Task expiry:**
  - For a finite `ttlMs`, schedule a `tasks/get` at `createdAt + ttlMs`, both while subscribed
    and while polling.
  - When the task is gone and `now` is past that deadline, fail the wait with
    `TaskExpiredError`, exported from `@mokei/context-client`. A not-found before the deadline
    keeps the original error.
  - Releasing the wait aborts the handler.

## Testing

- **Transition table.** For each transition, one test per row that passes and one per row whose
  precondition fails: no write and no event.
- **Interleavings.** Use a seeded random scheduler over an in-memory store that delays and
  reorders writes. It runs `ask`, `answer`, `withdraw`, `cancel`, `requestInput` re-attach and
  store conflicts concurrently. After every commit it checks these invariants:
  - `input_required` holds exactly when a request is open;
  - a public `inputRequests` is never empty;
  - every waiter settles to the record's committed outcome;
  - no waiter stays pending once the request has an outcome or the task is terminal.

  Run 500 seeds in CI. A failing seed is reproducible.
- **Expiry.** A waiter registered on an open request rejects when the task expires.
- **Recovery.** Answered before restart, withdrawn before restart, open at restart, deadline
  passed during downtime with each outcome, and a changed request under an issued key. Each uses
  a persistent in-memory store shared across two manager instances.
- **Client.** Withdrawal aborts the handler. A late answer keeps the wait alive. Reversed
  snapshot delivery leaves a withdrawn dialog closed. Expiry while subscribed and while polling.
- **Decision-flow.** The four driver changes above.

## Release

- One patch intent for `@mokei/context-server`, `@mokei/context-client` and
  `@mokei/decision-flow-server`, in the 0.14.x band.
- `docs/agents/architecture.md`: one paragraph under MCP Tasks on the input record, its
  transitions, and how waiters observe committed records.

## Out of scope

- Several open requests per task.
- A request version on the wire.
- Records persisted before this change.
