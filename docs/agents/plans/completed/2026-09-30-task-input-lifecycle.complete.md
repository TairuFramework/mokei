# Task input lifecycle — complete

**Status:** complete
**Date:** 2026-09-30
**Branch:** `feat/task-input-lifecycle`
**Origin:** input races left open by the [decision-flow server](2026-09-29-decision-flow-server.complete.md)
and the contract the host desktop interaction work relies on (withdrawal reaches the handler, a
late answer is harmless, snapshots are consistent). Builds on the
[MCP Tasks extension](2026-09-29-mcp-tasks-extension.complete.md).

## Goal

Make task input requests (`TaskHandle.requestInput`, `tasks/update`, `TaskWaiter` input dispatch)
correct under withdrawal, cancellation, concurrent answers and crash recovery. Before this, the
state of one request was split between the persisted task record and in-memory structures in
`TaskManager`, and every race between the two needed its own rule. Now the persisted record is
the single source of truth, and in-memory code only observes committed records.

## What was built

- **`@mokei/context-server`:**
  - `TaskRecord.inputs: Array<InputRecord>` replaces `inputRequests`, `inputResponses` and
    `issuedInputKeys`. An entry is `{ id, requests, responses, outcome?: 'answered' | 'withdrawn' }`.
  - Transitions `ask`, `answer`, `withdraw` and terminal each run as one conditional `#mutate`
    write that emits one `taskStatus` event, and write nothing when the precondition fails.
  - `requestInput` re-attaches to a matching request (open or settled), replays its settled
    outcome, withdraws on abort, and throws `TaskInputKeyReusedError` for a changed request
    under an issued key. Incoming requests are JSON-normalised before comparison.
  - New `InputRequestWithdrawnError({ taskID, id })`.
- **`@mokei/context-client`:** each input dispatch has its own abort controller. A key that
  drops out of an accepted snapshot aborts its handler with `TaskInputWithdrawnError({ taskID, key })`.
  For a finite TTL the waiter re-reads at `createdAt + ttlMs` and fails with
  `TaskExpiredError({ taskID })` when the task is gone after the deadline, including when an
  answer reaches an expired task. The expiry timer is clamped to 2_147_483_647 ms.
- **`@mokei/decision-flow-server`:** recovery replays stored input outcomes instead of asking
  again. The input key is deterministic: `${runID}:${invocationID}:input:${inputSeq ?? 0}`. A
  reused key fails the run with `RPCError(-32603, 'Flow input key reused')`.
- **Docs:** an MCP Tasks paragraph in `docs/agents/architecture.md`, and one patch changeset for
  the three packages.

## Key design decisions

- **Settled entries never change.** A request is open when the status is `input_required` and
  the latest entry has no `outcome`. Status and `outcome` change in the same write, so a terminal
  status ends an open request without an outcome and nothing can reopen it. Observers therefore
  never need commits in order.
- **Waiters observe committed records only.** A waiter registers its listener first, then reads,
  so it sees commits made before registration. It resolves on `answered`, rejects on `withdrawn`,
  terminal or deleted, and otherwise keeps waiting. An initial read failure retries with the
  withdrawal backoff (10 ms, doubling, 1000 ms cap) until settled or disposed.
- **Strictly monotonic `lastUpdatedAt`.** When the clock does not advance, `#mutate` writes the
  stored value plus 1 ms, so the waiter's older-than check orders notifications and `tasks/get`
  snapshots alike.
- **The committed outcome wins.** An answer that commits before a withdrawal resolves, even when
  the caller's signal aborted.
- **Recovery needs no input logic in `TaskManager`.** A recovered worker calls `requestInput`
  with the same requests, and the lookup returns the stored outcome or re-attaches.
- **Only deadline expiry maps to the timeout edge.** In decision-flow, the deadline abort reason,
  or a withdrawal after the deadline, takes the graph `timeout` edge. Other rejections propagate.
  An early-firing deadline timer is re-armed until the deadline has passed.
- **No migration.** The MCP Tasks extension was unreleased and no persistent `TaskStore` ships,
  so the record shape changed freely.

## Testing

Transition-table tests for every row; a seeded scheduled-store interleaving harness (500 seeds in
CI, `TASK_INPUT_SEEDS` to override) checking the invariants after every commit; expiry and
two-manager recovery tests; client withdrawal, late-answer, reversed-snapshot and expiry tests;
decision-flow driver tests for each recovery outcome.

## Follow-ons

The review minors were fixed in the same PR: the interleaving harness drains until the store is
quiescent, fake-timer tests always restore real timers, `onStatus` skips snapshots no newer than
the last one reported, and an answered dispatch is no longer aborted as withdrawn. No follow-on
work remains.

## Out of scope

Several open requests per task; a request version on the wire; records persisted before this
change.
