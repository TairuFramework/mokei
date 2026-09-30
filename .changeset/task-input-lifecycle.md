---
"@mokei/context-server": patch
"@mokei/context-client": patch
"@mokei/decision-flow-server": patch
---

Task input history is now persisted in `TaskRecord.inputs`, and a withdrawn input request rejects with `InputRequestWithdrawnError`. The client aborts a withdrawn input dispatch with `TaskInputWithdrawnError` and fails a wait on an expired task with `TaskExpiredError`. Decision-flow recovery replays stored input outcomes instead of asking again, and a reused input key fails the run.
