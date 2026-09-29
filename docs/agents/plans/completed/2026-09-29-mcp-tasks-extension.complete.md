# MCP Tasks extension (`io.modelcontextprotocol/tasks`) — complete

**Status:** complete
**Date:** 2026-09-29
**Branch:** `feat/mcp-tasks-extension`
**Origin:** the MCP tools item in [decision flow follow-ons](../backlog/2026-09-28-decision-flow-follow-ons.md). Corrects the
[`2026-07-28` migration milestone](2026-08-28-mcp-2026-07-28-migration-milestone.complete.md), which recorded that
mokei never implemented tasks: tasks left the core spec (SEP-2663) and came back as an extension.

## Goal

Implement the MCP Tasks extension for protocol revision `2026-07-28` in `@mokei/context-protocol`,
`@mokei/context-server`, `@mokei/context-client`, `@mokei/http-server` and `@mokei/http-client`. A server tool can
answer `tools/call` with a durable task handle. Clients poll or subscribe for its status, supply input mid-flight
and retrieve the final result. Existing `callTool` callers (host, session, agent) still receive a final
`CallToolResult`.

Out of scope: task augmentation of requests other than `tools/call`, the `2025-11-25` task vocabulary, tasks from
host local tools, and a persistent `TaskStore` implementation (only the interface and an in-memory default ship).

## Architecture and key design decisions

- **`2026-07-28` only.** The task schemas, `tasks/get|update|cancel`, `notifications/tasks` and
  `resultType: 'task'` exist only in the `2026-07-28` validators. A `2025-11-25` `initialize` result strips the
  extension capability, so older peers never see it. Only `tools/call` may be answered with a task.
- **Application-owned manager.** Stateless HTTP disposes each per-POST `ContextServer`, so task state lives in a
  standalone `createTaskManager({ store?, ttlMs?, pollIntervalMs?, recover? })`, like the durable subscription hub.
  The manager owns the store, running workers and their abort controllers, the expiry sweep and `taskStatus` /
  `taskError` events. Workers outlive the creating request. The HTTP handler threads the manager to every
  per-POST server and never disposes it.
- **Handler API.** Tool handlers receive `req.meta` (the call's `_meta`, `{}` when absent; local tools get the same
  field) and, when the server has a manager, `req.task.run(work)`. `run` resolves to the task creation result; the
  `work` callback receives a handle with `setStatus`, `requestInput`, `awaitInput`, `checkpoint(resumeData)` and
  `cancel`. Input requests reuse the MRTR schemas.
- **One finalisation seam.** Output validation and error mapping moved into one function shared by synchronous
  calls and task settlement. A task stores its result exactly as a synchronous `tools/call` would send it; protocol
  errors from inside the work end `failed` with their own code, message and data.
- **Compare-and-swap store.** Every record carries an integer `revision`; `update` rejects with
  `TaskStoreConflictError` on a stale revision and the manager re-reads and retries. Terminal transitions are
  first-writer-wins, so a concurrent `setStatus` or partial `tasks/update` never strands a completing task, and
  cancel wins over completion if its write commits first. Detached writes that fail for other reasons retry three
  times, then emit `taskError`; acknowledged input that cannot be consumed fails the task instead of stalling it.
- **Expiry and restart.** Expiry runs from `createdAt`, checked on access and by an `unref`'d sweep. After a restart
  with a persistent store, records in `working` or `input_required` stay invisible (`Task not found`) until the
  application calls `await tasks.recover(tools)` before serving; a `recover` callback resumes work with the same
  handle semantics, and anything not resumed ends `failed` with `Task interrupted by server restart`.
- **Owner binding.** `serve()`'s bearer gate passes its verified auth into every per-POST server, including held
  listens. A task's owner is the creating token's `{ issuer, subject, scopes }`; access requires the same issuer
  and subject and a superset of the recorded scopes. Unauthenticated tasks are ownerless (the ID is a bearer
  secret) and inaccessible to authenticated callers, and vice versa. Every miss is `-32602 Task not found`, so
  existence is never revealed. `tasks/*` and task listens also require the extension in the per-request client
  capabilities (`-32021` otherwise).
- **Notifications.** Task status changes flow through `subscriptions/listen` with a `taskIds` filter. The hub checks
  each ID against the listener's identity before the acknowledgement, which lists only accepted IDs, and closes an
  authenticated listen when its token expires.
- **Client waiting.** `callTool` waits automatically and keeps its return type; `task: 'handle'` returns the
  `CreateTaskResult` instead. `client.tasks` exposes `get`, `update`, `cancel` and `wait`. Waiting uses a separate,
  reference-counted task listen, falls back to polling (`pollIntervalMs`, 250 ms floor) when the listen is refused,
  unacknowledged within 3 s or dropped, fulfils `input_required` with the MRTR handlers, deduplicated per
  `(taskId, key)`, and maps `failed` / `cancelled` / missing handlers to `RPCError`, `TaskCancelledError` and
  `TaskInputUnavailableError`. `callTool`'s timeout and abort signal cover the automatic wait and send
  `tasks/cancel`; `tasks.wait` aborts only the wait.
- **HTTP routing.** The `Mcp-Name` header map sources `tasks/get|update|cancel` from `params.taskId`.

## What was built

Task schemas, types and `TASKS_EXTENSION` / `isCreateTaskResult` / `declaresTasksExtension` in
`@mokei/context-protocol`; the task manager, memory store, handler task context and `tasks/*` dispatch in
`@mokei/context-server`; auth and manager threading in `@mokei/http-server`; task waiter, `client.tasks` and
`callTool` overloads in `@mokei/context-client`; header routing in `@mokei/http-client`. Integration suites cover
mokei-to-mokei tasks over stdio and HTTP (including bearer ownership and wire-level `notifications/tasks`) and
MCP SDK 2.1.0 clients with `@modelcontextprotocol/ext-tasks` 0.1.0 against mokei servers. The architecture doc and
the context-server and context-client READMEs document ownership, recovery and waiting.

## Validation

Executed subagent-driven (15 tasks, per-task review, whole-branch review with one fix round and a scoped
re-review). The final review's fixes: acknowledged input no longer stalls on a transient store failure, `callTool`'s
timeout bounds the automatic wait, and the HTTP README example forwards auth for owner binding. Lint, full build
and full `pnpm test` pass. Released as a patch in the 0.14.x band.
