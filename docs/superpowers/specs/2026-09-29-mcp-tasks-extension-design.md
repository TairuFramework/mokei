# MCP Tasks extension (`io.modelcontextprotocol/tasks`)

**Date:** 2026-09-29
**Branch:** `feat/mcp-tasks-extension`
**Origin:** decision-flow follow-ons (`docs/agents/plans/backlog/2026-09-28-decision-flow-follow-ons.md`),
second of four specs. Spec 3 (`check_flow` / `run_flow` in `mcp-servers/system-one`) builds on
this one.

## Goal

Implement the MCP Tasks extension for protocol revision `2026-07-28` in `@mokei/context-protocol`,
`@mokei/context-server`, `@mokei/context-client` and `@mokei/http-server`. A server tool can
answer `tools/call` with a durable task handle; clients poll or subscribe for its status, supply
input mid-flight and retrieve the final result. Existing callers of `callTool` (host, session,
agent) keep receiving a final `CallToolResult`.

Reference: the extension overview at
`https://modelcontextprotocol.io/extensions/tasks/overview` and the schema in
`modelcontextprotocol/ext-tasks`, `schema/2026-07-28/schema.ts` (SEP-2663).

This reverses the earlier record in
`docs/agents/plans/completed/2026-08-28-mcp-2026-07-28-migration-milestone.complete.md`
("Tasks removed from the spec (SEP-2663) — mokei never implemented them"): tasks left the core
spec and came back as an extension.

## Scope

In: protocol schemas, server task execution and store, `tasks/get` / `tasks/update` /
`tasks/cancel`, `input_required` inside tasks, `notifications/tasks` through
`subscriptions/listen`, owner binding from HTTP bearer auth, client waiting (polling and
notifications) and a handle API, mokei-to-mokei and SDK interop tests.

Out: task augmentation of any request other than `tools/call`; the `2025-11-25` task
vocabulary; tasks from `@mokei/host` local tools; a persistent `TaskStore` implementation
(only the interface and an in-memory default ship).

## 1. Protocol (`@mokei/context-protocol`, `2026-07-28` only)

Add to `versions/2026-07-28.ts`, matching the ext-tasks `2026-07-28` schema:

- `taskStatus`: `'working' | 'input_required' | 'completed' | 'failed' | 'cancelled'`.
- `task`: `taskId`, `status`, optional `statusMessage`, `createdAt` and `lastUpdatedAt` (ISO
  8601), `ttlMs` (integer or `null`), optional `pollIntervalMs` (integer).
- Detailed variants: `working`, `input_required` (with `inputRequests`), `completed` (with
  `result`), `failed` (with a JSON-RPC `error` object), `cancelled`.
- `createTaskResult`: `task` fields plus `resultType: 'task'`. A closed schema added to the
  `serverResult` union and the hand-written `ServerResult` TS union, like `inputRequiredResult`.
- Requests `tasks/get` (`{ taskId }`), `tasks/update` (`{ taskId, inputResponses }`) and
  `tasks/cancel` (`{ taskId }`), each wrapped `withProtocolMeta(forbidRetryParams(...))` and added
  to `PROTOCOL.clientMethods`.
- Results: `tasks/get` returns a detailed task with `resultType: 'complete'`; `tasks/update` and
  `tasks/cancel` return an empty acknowledgement with `resultType: 'complete'`.
- `notifications/tasks`: params are a detailed task. Added to `serverNotification`.
- `inputRequests` / `inputResponses` reuse the MRTR schemas.
- Subscriptions: `subscriptionFilter` gains `taskIds?: Array<string>`; the acknowledged
  notification may carry `taskIds` (the IDs the server accepted).

Exports: `TASKS_EXTENSION = 'io.modelcontextprotocol/tasks'`, `isCreateTaskResult(result)`,
`declaresTasksExtension(capabilities)`, and the task types.

`PROTOCOL.wrapResult` preserves `resultType: 'task'` as it preserves `'input_required'`; every
other result is still stamped `'complete'`.

Only `tools/call` may be answered with a task. `2025-11-25` is unchanged.

## 2. Server (`@mokei/context-server`)

### Configuration

New `ContextServer` option:

```ts
tasks?: {
  store?: TaskStore          // default: in-memory
  ttlMs?: number             // default: 3_600_000
  pollIntervalMs?: number    // default: 1_000
  recover?: (record: TaskRecord, resume: TaskResume) => Promise<void> | void
}
```

When `tasks` is set, `server/discover` advertises `capabilities.extensions['io.modelcontextprotocol/tasks'] = {}`.
When unset, the extension is not advertised, handlers never receive a task context, and
`tasks/*` requests fail with "Task not found".

### Handler API

The tool handler request gains `task?: TaskContext`, present only when the server has `tasks`
configured, the method is `tools/call`, and the request's client capabilities declare the
extension. The handler decides per request:

```ts
createTool({
  inputSchema,
  handler: async (req) => {
    if (!req.task) return runInline(req.input)
    return req.task.run(async (task) => {
      task.setStatus('starting')
      const answers = await task.requestInput({
        pick: { method: 'elicitation/create', params },
      })
      return { content: [/* ... */] } // CallToolResult
    })
  },
})
```

`req.task.run(work)`:

1. Creates the record in the store (`status: 'working'`, timestamps, `ttlMs`, owner) and only
   then returns the `CreateTaskResult` (the spec requires durable creation before the response).
2. Runs `work(handle)` detached. `handle` provides:
   - `taskId`.
   - `signal`: aborted on `tasks/cancel`, TTL expiry or server close.
   - `setStatus(message)`: sets `statusMessage`, bumps `lastUpdatedAt`.
   - `requestInput(inputRequests)`: moves the task to `input_required` with those requests and
     resolves with the `inputResponses` once `tasks/update` has supplied every key; the task
     then returns to `working`. Rejects with the abort reason if the signal aborts first.
3. Settles the task:
   - A returned `CallToolResult` passes the usual `outputSchema` / `structuredContent`
     validation, then `completed` with that `result`.
   - A thrown error that the synchronous path maps to a tool result (`isError: true`) also
     ends `completed`, with that result.
   - A thrown error that the synchronous path maps to a JSON-RPC error ends `failed`, with that
     error object.
   - After cancellation or expiry, the work's outcome is ignored.

`createTool` passes `CreateTaskResult` through without output validation, as it does for
`input_required`. `_handleRequest` gets a task branch next to the MRTR branch: gated on method
and declared capability, wrapped with `wrapResult`, and skipping `applyCacheHints`. A handler
that returns a `CreateTaskResult` when `req.task` was not provided is a server bug and fails the
request with an internal error.

### `tasks/*` requests

- `tasks/get`: returns the detailed task for its current status.
- `tasks/update`: records responses for keys currently outstanding in `inputRequests`; ignores
  unknown or already-satisfied keys; acknowledges with an empty result.
- `tasks/cancel`: aborts the work's signal and moves a non-terminal task to `cancelled`
  immediately; a terminal task is left unchanged. Acknowledges with an empty result.
- An unknown, expired or inaccessible task returns JSON-RPC `-32602` with message
  `Task not found`, in every case, so existence is never revealed.

### Store

```ts
type TaskStore = {
  create(record: TaskRecord): Promise<void>
  get(taskId: string): Promise<TaskRecord | undefined>
  update(taskId: string, patch: Partial<TaskRecord>, expected: { status: TaskStatus }): Promise<TaskRecord>
  delete(taskId: string): Promise<void>
  list(filter: { status: Array<TaskStatus> }): Promise<Array<TaskRecord>>
}
```

`update` rejects with a conflict error when the stored status differs from `expected.status`,
so concurrent cancel and completion cannot both win. `TaskRecord` is plain JSON: `taskId`,
`status`, `statusMessage`, `createdAt`, `lastUpdatedAt`, `ttlMs`, `pollIntervalMs`, `owner`,
`result`, `error`, `inputRequests`, `inputResponses` (received so far). The default in-memory
store ships as `createMemoryTaskStore()`.

### Expiry, restart and IDs

- Expiry is checked on every access and by an `unref`'d sweep timer; an expired record is
  deleted and its work aborted.
- On startup the server lists records in `working` or `input_required`. With `recover`, it calls
  `recover(record, resume)` for each, where `resume(work)` re-attaches a worker to that task
  with the same handle semantics. Without `recover`, or if `recover` does not call `resume`,
  the task becomes `failed` with message `Task interrupted by server restart`.
- Task IDs are `crypto.randomUUID()` (128-bit).

### Owner binding

- `@mokei/http-server` passes the verified bearer `authInfo` into
  `handler.handleRequest(request, { authInfo })` from `serve()`'s auth gate.
- Handler requests expose `auth?: { subject: string; scopes: Array<string> }`.
- A task created with `auth` records `owner = auth.subject`. Any `tasks/*` request or task
  subscription from another subject, or without auth, gets `Task not found` / is left out of
  the acknowledgement. A task created without auth (stdio) has no owner and works for any
  holder of the ID.

### Notifications

Every task status change emits a `taskStatus` server event carrying the detailed task. The
subscription hub sends `notifications/tasks` to listeners whose filter's `taskIds` include the
task and whose subject matches the owner. The acknowledgement lists only the accepted
`taskIds`.

## 3. Client (`@mokei/context-client`)

- On `2026-07-28`, every request declares `extensions['io.modelcontextprotocol/tasks'] = {}` in
  the per-request client capabilities. `2025-11-25` requests are unchanged.
- `request()` intercepts `resultType: 'task'` on `tools/call`. By default it waits for the task
  and returns its final `CallToolResult`, so `callTool` keeps its return type and host, session
  and agent code is unchanged.
- `callTool(params, { task: 'handle' })` returns `CallToolResult | CreateTaskResult` (an
  overload, like `allowInputRequired`).
- `client.tasks`:
  - `get(taskId)`, `update(taskId, inputResponses)`, `cancel(taskId)`.
  - `wait(taskId, { signal?, onStatus? })`: resolves with the final `CallToolResult`.
- Waiting:
  - When the server advertises subscriptions, open `subscriptions/listen` with
    `taskIds: [taskId]` and follow `notifications/tasks`; after the acknowledgement, issue one
    `tasks/get` so a change before the listen is not missed.
  - Otherwise poll `tasks/get` at the task's `pollIntervalMs`, with a 250 ms floor.
  - `input_required`: fulfil each input request with the same handlers MRTR uses
    (elicitation, sampling, roots) and send the responses with `tasks/update`.
- Outcomes:
  - `completed`: return `result`, after the same `structuredContent` / `outputSchema` check
    `callTool` applies.
  - `failed`: throw the same error class the synchronous path throws for that JSON-RPC error.
  - `cancelled`: throw `TaskCancelledError`.
  - An input request with no handler: throw `TaskInputUnavailableError`. On `callTool`'s
    automatic wait, the client sends `tasks/cancel` first.
  - Caller `signal` aborts during `callTool`'s automatic wait: send `tasks/cancel`, then reject
    with the abort reason. During `tasks.wait`: stop waiting only; the task keeps running.

## 4. Testing

Unit:

- Protocol: schemas for each task variant and request, `wrapResult` keeping `'task'`,
  `clientMethods` and the `clientNotification` / `serverNotification` guards in
  `versions.test.ts`, `isCreateTaskResult`, `declaresTasksExtension`.
- Server: task context present only when configured, declared and `tools/call`; durable create
  before response; status transitions; `requestInput` and partial `tasks/update`; cancel
  (including cancel after completion); settle mapping for results, tool errors and JSON-RPC
  errors; expiry; restart with and without `recover`; owner mismatch returns `Task not found`;
  store conflict on concurrent settle and cancel; notifications only to matching subscribers.
- Client: default wait by polling and by notifications; handle mode; `tasks.*`; input
  fulfilment through existing handlers; failed and cancelled outcomes; missing input handler
  cancels; caller abort cancels in `callTool` but not in `tasks.wait`.

Integration (`integration-tests`):

- mokei client against a mokei server over stdio and over HTTP: a task that completes, one that
  requests elicitation input, one that is cancelled, and a subscription receiving
  `notifications/tasks`.
- HTTP with bearer auth: a second subject gets `Task not found`.
- Interop: the SDK 2.1.0 client with `@modelcontextprotocol/ext-tasks@0.1.0` against a mokei
  server over stdio and HTTP. If ext-tasks cannot run against SDK 2.1.0, record the gap in the
  plan's completion notes rather than working around it.

## 5. Docs and release

- `docs/agents/architecture.md`: a tasks section (server opt-in, store, owner binding, client
  waiting).
- Update the migration milestone record quoted above.
- READMEs for `@mokei/context-server` and `@mokei/context-client`.
- A changeset with a minor bump (lockstep versioning moves all public packages).

## Verification

- `rtk proxy pnpm run lint` clean.
- `pnpm build`, then `pnpm test` passes.
