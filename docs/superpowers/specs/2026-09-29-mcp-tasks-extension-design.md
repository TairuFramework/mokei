# MCP Tasks extension (`io.modelcontextprotocol/tasks`)

**Date:** 2026-09-29
**Branch:** `feat/mcp-tasks-extension`
**Origin:** decision-flow follow-ons (`docs/agents/plans/backlog/2026-09-28-decision-flow-follow-ons.md`),
second of four specs. Spec 3 (`check_flow` / `run_flow` in `mcp-servers/system-one`) builds on
this one.

## Goal

Implement the MCP Tasks extension for protocol revision `2026-07-28` in `@mokei/context-protocol`,
`@mokei/context-server`, `@mokei/context-client`, `@mokei/http-server` and `@mokei/http-client`. A server tool can
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

In: protocol schemas, an application-owned task manager and store, `tasks/get` / `tasks/update` /
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
  `result`), `failed` (with a JSON-RPC `error` object: `code`, `message`, optional `data`),
  `cancelled`.
- `createTaskResult`: `task` fields plus `resultType: 'task'`. A closed schema added to the
  `serverResult` union and the hand-written `ServerResult` TS union, like `inputRequiredResult`.
- Requests `tasks/get` (`{ taskId }`), `tasks/update` (`{ taskId, inputResponses }`) and
  `tasks/cancel` (`{ taskId }`), added to `PROTOCOL.clientMethods`. `tasks/get` and
  `tasks/cancel` are wrapped `withProtocolMeta(forbidRetryParams(...))`. `tasks/update` requires
  `inputResponses`, which `forbidRetryParams` rejects, so it is wrapped with `withProtocolMeta`
  plus a schema that forbids only `requestState`.
- Results: `tasks/get` returns a detailed task with `resultType: 'complete'`; `tasks/update` and
  `tasks/cancel` return an empty acknowledgement with `resultType: 'complete'`.
- `notifications/tasks`: params are a detailed task. Added to `serverNotification`.
- `inputRequests` / `inputResponses` reuse the MRTR schemas.
- Subscriptions: `subscriptionFilter` gains `taskIds?: Array<string>`; the acknowledged
  notification may carry `taskIds` (the IDs the server accepted).

Typed plumbing, changed together with the schemas:

- `procedure.ts`: `ClientRequests` gains the three `tasks/*` entries (params and results), so
  `client.request('tasks/get', ...)` is typed. Its `tools/call` result widens to include
  `CreateTaskResult`.
- The exported aggregates (`ServerResult`, `ServerNotification`, `ServerMessage`, and the
  revision-union types in `index.ts` / `server.ts`) include the task result and notification.
- Per-revision validation: the `2025-11-25` validators reject the new methods, results and
  notification; the `2026-07-28` validators accept them.

Exports: `TASKS_EXTENSION = 'io.modelcontextprotocol/tasks'`, `isCreateTaskResult(result)`,
`declaresTasksExtension(capabilities)`, and the task types.

`PROTOCOL.wrapResult` preserves `resultType: 'task'` as it preserves `'input_required'`; every
other result is still stamped `'complete'`.

Only `tools/call` may be answered with a task. `2025-11-25` is unchanged.

HTTP routing (`@mokei/http-client`): the `Mcp-Name` header map gains `tasks/get`,
`tasks/update` and `tasks/cancel`, each sourced from `params.taskId`, as the extension's
Streamable HTTP section requires.

## 2. Server (`@mokei/context-server`, `@mokei/http-server`)

### Task manager

Over `2026-07-28` HTTP, every POST gets a throwaway `ContextServer` that is disposed when its
response ends. Task state therefore lives in a standalone, application-owned `TaskManager`,
like the durable `SubscriptionHub`:

```ts
type TaskManagerParams = {
  store?: TaskStore          // default: createMemoryTaskStore()
  ttlMs?: number             // default: 3_600_000
  pollIntervalMs?: number    // default: 1_000
  recover?: (record: TaskRecord, resume: TaskResume) => Promise<void> | void
}

const tasks = createTaskManager(params)
```

The manager owns the store, the registry of running workers and their abort controllers, the
expiry sweep, and a `taskStatus` event source. It holds no tool definitions: live tasks settle
through the creating server's tool, and recovered tasks through the tools passed to
`tasks.recover(tools)` (see Restart). Worker signals belong to the manager, not to
the POST that created the task, so a task outlives its creating request. `tasks.dispose()`
aborts running workers (outcomes ignored, records left as-is for recovery) and stops the sweep.

Wiring:

- `ContextServer` takes `tasks?: TaskManager`. Over stdio, one manager per process.
- `HTTPHandlerParams.createServer` receives `tasks` alongside `subscriptionHub`, and the
  handler takes `tasks?: TaskManager`, threading it to every per-POST server. The handler
  never disposes it; the caller does.
- `createSubscriptionHub({ events, tasks? })` also consumes the manager's `taskStatus` events.

When a server has `tasks`, `server/discover` advertises
`capabilities.extensions['io.modelcontextprotocol/tasks'] = {}`. When it has none, the
extension is not advertised, handlers never receive a task context, and `tasks/*` requests get
`-32601` method not found.

### Handler API

The tool handler request gains `task?: TaskContext`, present only when the server has `tasks`,
the method is `tools/call`, and the request's client capabilities declare the extension. The
handler decides per request:

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
    }, { resumeData: { input: req.input } })
  },
})
```

`req.task.run(work, options?)`:

1. Creates the record in the store (`status: 'working'`, timestamps, `ttlMs`, owner,
   `toolName`, the request's declared client capabilities, optional `resumeData`) and only then returns the `CreateTaskResult` (the
   extension requires durable creation before the response).
2. Runs `work(handle)` detached, on the manager. `handle` provides:
   - `taskId`.
   - `signal`: aborted on `tasks/cancel`, TTL expiry or manager disposal.
   - `setStatus(message)`: sets `statusMessage`, bumps `lastUpdatedAt`.
   - `requestInput(inputRequests)`: moves the task to `input_required` with those requests and
     resolves with the `inputResponses` once `tasks/update` has supplied every key; the task
     then returns to `working`. Keys must be unique for the task's lifetime: reusing a key
     already issued rejects with an error. Rejects with the abort reason if the signal aborts
     first. Before persisting, it applies the same client-capability check as MRTR
     (`server.ts` input gating) against the capabilities the creating request declared, which
     the record stores. An undeclared capability rejects with the MRTR error; if the work does
     not catch it, the task ends `failed` with that `-32021` error.
   - `awaitInput()`: resolves with the responses to the requests currently outstanding,
     without issuing new keys. Used by recovered work (see Restart).
3. Settles the task through the same finalisation seam as the synchronous path (below).

`options.resumeData` is a JSON value stored on the record for `recover` (see Restart).

### One finalisation seam

Today `createTool` validates output in `finalizeResult` and `#callTool` maps thrown errors to
`isError` results or JSON-RPC errors. Both steps move into one reusable function,
`settleToolOutcome(tool, outcome)`, used by the synchronous path and by task settlement:

- A returned `CallToolResult` passes the `outputSchema` / `structuredContent` validation.
- A thrown error that maps to a tool result (`isError: true`) becomes that result.
- A thrown error that maps to a JSON-RPC error becomes that error object.

Task settlement stores the result exactly as a synchronous `tools/call` would send it on
`2026-07-28`, including `resultType: 'complete'`, and ends `completed`; a JSON-RPC error ends
`failed` with that error. After cancellation or expiry, the work's outcome is ignored.

`createTool` passes `CreateTaskResult` through without output validation, as it does for
`input_required`. `_handleRequest` gets a task branch next to the MRTR branch: gated on method
and declared capability, wrapped with `wrapResult`, and skipping `applyCacheHints`. A handler
that returns a `CreateTaskResult` when `req.task` was not provided fails the request with an
internal error.

### `tasks/*` requests

Checks, in order:

1. The request's `_meta` client capabilities must declare the extension. Otherwise
   `-32021` (`MISSING_REQUIRED_CLIENT_CAPABILITY`) with
   `data.requiredCapabilities.extensions['io.modelcontextprotocol/tasks'] = {}`. The same check
   applies to a `subscriptions/listen` whose filter has `taskIds`, before any acknowledgement.
2. The task must exist, be unexpired and be accessible to the caller (see Owner binding).
   Otherwise `-32602` with message `Task not found`, in every case, so existence is never
   revealed.

Methods:

- `tasks/get`: returns the detailed task for its current status.
- `tasks/update`: records responses for keys currently outstanding in `inputRequests`. Each
  response's kind must match its request's method (an `elicitation/create` request takes an
  elicitation result, and so on); a mismatch is `-32602`. Unknown, already-satisfied or stale
  keys are ignored, because they can race with state changes. An update on a terminal task is
  acknowledged and ignored. Acknowledges with an empty result.
- `tasks/cancel`: aborts the work's signal and moves a non-terminal task to `cancelled`; a
  terminal task is left unchanged. Acknowledges with an empty result.

The client side of `tasks/update` sends only keys it observed as outstanding (section 3).

### Store and atomicity

```ts
type TaskStore = {
  create(record: TaskRecord): Promise<void>
  get(taskId: string): Promise<TaskRecord | undefined>
  update(taskId: string, patch: Partial<TaskRecord>, expected: { revision: number }): Promise<TaskRecord>
  delete(taskId: string): Promise<void>
  list(filter: { status: Array<TaskStatus> }): Promise<Array<TaskRecord>>
}
```

Every record carries an integer `revision`. `update` is a compare-and-swap: it rejects with
`TaskStoreConflictError` when the stored revision differs from `expected.revision`, and
otherwise writes the patch with `revision + 1`. On conflict the manager re-reads and retries.
A terminal transition retries for as long as the record is still non-terminal, and stops only
when the re-read shows another terminal transition already won. A concurrent `setStatus` or
partial `tasks/update` therefore never strands a completing task.

`TaskRecord` is plain JSON: `taskId`, `revision`, `status`, `statusMessage`, `createdAt`,
`lastUpdatedAt`, `ttlMs`, `pollIntervalMs`, `owner`, `toolName`, `clientCapabilities`,
`resumeData`, `result`,
`error`, `inputRequests`, `inputResponses` (received so far for the outstanding requests), and
`issuedInputKeys` (every key ever requested). Partial `tasks/update` calls merge into
`inputResponses`; the CAS makes two concurrent partial updates both land, or one retry.
`createMemoryTaskStore()` ships as the default.

### Races, expiry and cancellation

- Terminal transitions (`completed`, `failed`, `cancelled`, expiry deletion) are
  first-writer-wins: once a record is terminal, a later settle, cancel or update is a no-op.
  Cancel wins over completion if its write commits first, and the work's outcome is then
  ignored.
- Expiry is measured from `createdAt` (status changes do not extend it). It is checked on every
  access and by an `unref`'d sweep timer; an expired record is deleted and its work aborted.
- On cancel or expiry, a pending `requestInput` promise rejects with the abort reason.
- Tests drive these rules with a controlled clock.

### Restart

- Restart recovery needs a persistent store; with the default memory store there are no
  records after a restart and this section is a no-op.
- Recovery is explicit: after creating the manager, the application calls
  `await tasks.recover(tools)`, passing the same tool map it gives `ContextServer`. The manager
  lists records in `working` or `input_required`. With `recover`, it calls
  `recover(record, resume)` for each. `record.toolName` and `record.resumeData` identify the
  work; `resume(work)` re-attaches a worker with the same handle semantics. Outstanding
  `inputRequests` stay outstanding, and the new worker collects their responses with
  `handle.awaitInput()`. The outcome settles through `settleToolOutcome` with
  `tools[record.toolName]`, so output validation still applies. A missing tool counts as not
  recovered. `tasks/*` for these tasks returns `Task not found` until `recover` has returned
  for them.
- Without `recover`, or if `recover` returns without calling `resume` or throws, the task ends
  `failed` with error `{ code: -32603, message: 'Task interrupted by server restart' }`.
- Task IDs are `crypto.randomUUID()` (128-bit).

### Owner binding

- `HTTPHandler.handleRequest(request, options?: { auth?: AuthInfo })`. `serve()`'s bearer gate
  passes the `authInfo` it verified instead of discarding it.
- The handler threads that identity into every `2026-07-28` per-POST server
  (`createServer({ ..., auth })`), including `subscriptions/listen` servers held open.
- Handler requests expose `auth?: { issuer?: string; subject: string; scopes: Array<string> }`.
  `issuer` comes from the token's `iss` claim when the verifier exposes it in `raw`.
- The owner of a task is `{ issuer, subject, scopes }` from the creating request.
- `AuthInfo` gains an optional `issuer`. The built-in JWKS and DID verifiers set it; a custom
  verifier may. Tokens whose verifier sets no issuer share one `undefined` issuer namespace,
  which is correct only when one verifier serves the endpoint.
- The owner also records the creating token's `scopes`. Access requires the same issuer and
  subject, and caller scopes that include every recorded scope. A same-subject token with
  fewer scopes gets `Task not found` on `tasks/*` and is left out of listen acknowledgements.
- When a request carries verified auth, the task gets that owner. When it has none (stdio, or
  HTTP without auth), the task has no owner and the ID works as a bearer secret. An ownerless
  task is inaccessible to an authenticated caller, and an owned task to an unauthenticated one.

### Notifications

Every task status change emits a `taskStatus` event on the manager carrying the detailed task.
A hub entry for a listen records the listener's identity. On a listen with `taskIds`, the hub
checks each ID against the listener's identity before writing the acknowledgement, which
lists only the accepted IDs; rejected IDs are left out without an error. The hub then sends
`notifications/tasks` only for accepted IDs.

## 3. Client (`@mokei/context-client`)

- On `2026-07-28`, every request declares `extensions['io.modelcontextprotocol/tasks'] = {}` in
  the per-request client capabilities. `2025-11-25` requests are unchanged.
- `callTool({ name, arguments, task: 'handle' })` returns `CallToolResult | CreateTaskResult`.
  `callTool` strips `task` from the params itself before sending (`splitRequestOptions` is
  unchanged).
- Overloads: neither option returns `CallToolResult`; `task: 'handle'` adds
  `CreateTaskResult`; `allowInputRequired: true` adds `InputRequiredResult`; both together
  return the union of all three.
- Ordering inside `callTool`: without `allowInputRequired`, the existing MRTR loop runs first
  (a server may ask for input before deciding to create a task), and a `resultType: 'task'`
  response ends that loop. With `allowInputRequired`, an `input_required` response is returned
  as today. Without
  `task: 'handle'`, the client then waits for the task and returns its final
  `CallToolResult`, so `callTool` keeps its return type and host, session and agent code is
  unchanged.
- `client.tasks`:
  - `get(taskId)`, `update(taskId, inputResponses)`, `cancel(taskId)`.
  - `wait(taskId, { signal?, onStatus?, toolName? })`: resolves with the final `CallToolResult`.

### Waiting

- Task listens use their own `subscriptions/listen` exchanges, separate from the resource
  subscription driver. Concurrent waits on the same task share one listen, reference-counted.
- The client tries a listen with `taskIds: [taskId]`. If the method is unavailable, the
  request fails, or the acknowledgement's `taskIds` omits the ID, it polls instead. After an
  accepted acknowledgement it issues one `tasks/get`, so a change before the listen is not
  missed.
- If an accepted listen ends or fails before the task is terminal, the waiter releases its
  reference (closing the shared listen when the count reaches zero) and continues by polling.
- Polling uses `tasks/get` at the task's `pollIntervalMs`, with a 250 ms floor.
- Snapshots whose `taskId` differs from the awaited task are ignored.
- `input_required`: the client fulfils each input request with the handlers MRTR uses
  (elicitation, sampling, roots), then sends the responses with `tasks/update`. Fulfilment is
  deduplicated by `(taskId, key)`: a key already being fulfilled or already sent is not
  presented again, across repeated notifications, polls and concurrent waiters. The client
  sends only keys present in the latest `inputRequests` it observed.

### Outcomes

- `completed`: return `result`. The `structuredContent` / `outputSchema` check runs when the
  tool name is known: always on `callTool`'s automatic wait, and on `tasks.wait` only when
  `toolName` is passed.
- `failed`: throw the `RPCError` the synchronous path would throw for that error object, with
  its `code`, `message` and `data`.
- `cancelled`: throw `TaskCancelledError`.
- An input request with no handler: throw `TaskInputUnavailableError`. On `callTool`'s
  automatic wait, the client sends `tasks/cancel` first.
- Caller `signal` aborts during `callTool`'s automatic wait: send `tasks/cancel`, then reject
  with the abort reason. During `tasks.wait`: stop waiting only; the task keeps running.

## 4. Testing

Unit:

- Protocol: schemas for each task variant and request, `wrapResult` keeping `'task'`,
  `clientMethods` and the `clientNotification` / `serverNotification` guards in
  `versions.test.ts`, `2025-11-25` rejecting the task vocabulary, typed `ClientRequests`
  entries, `isCreateTaskResult`, `declaresTasksExtension`.
- Server:
  - task context present only with a manager, declared extension and `tools/call`;
  - durable create before response; status transitions;
  - `-32021` for undeclared `tasks/*` and task listens; `-32601` without a manager;
  - `tasks/update` validates with `inputResponses` and rejects `requestState`;
  - `requestInput`, reused-key rejection, undeclared input capability, partial `tasks/update`,
    wrong response kind;
  - two partial updates racing both land; cancel racing completion (first writer wins);
    completion racing a `setStatus` or partial update still completes;
    cancel after completion;
  - settle mapping for results, tool errors and JSON-RPC errors through the shared seam;
    stored result carries `resultType: 'complete'`;
  - expiry from `createdAt` with a controlled clock; pending `requestInput` rejects on
    cancel and expiry;
  - restart with a persistent test store, with and without `recover`, and with `recover`
    throwing; the interrupted error object; recovery while `input_required` using
    `awaitInput`; a recovered task returning invalid output fails validation;
  - owner mismatch (subject, issuer, fewer scopes, owned versus ownerless) returns
    `Task not found`;
  - listen acknowledgement with mixed owned and unowned IDs; notifications only for accepted
    IDs.
- Client: default wait by polling and by notifications; fallback to polling when the listen
  fails or omits the ID, and when an accepted listen drops before completion; shared listen for
concurrent waits; handle mode, `task` stripped from the wire, overload combinations with
`allowInputRequired`; `Mcp-Name` set to the task ID on `tasks/*` over HTTP;
  MRTR before task creation; `tasks.*`; input fulfilment through existing handlers; duplicate
  `input_required` snapshots presented once; mismatched `taskId` snapshots ignored; failed
  (error code and data) and cancelled outcomes; missing input handler cancels; caller abort
  cancels in `callTool` but not in `tasks.wait`; output validation with and without `toolName`.

Integration (`integration-tests`):

- mokei client against a mokei server over stdio and over HTTP: a task that completes, one that
  requests elicitation input, one that is cancelled, and a subscription receiving
  `notifications/tasks`.
- HTTP: the creating POST's per-POST server is disposed before the task completes, and a later
  `tasks/get` still returns the result.
- HTTP with bearer auth: a second subject gets `Task not found`, and its listen acknowledgement
  omits the task.
- Interop: the SDK 2.1.0 client with `@modelcontextprotocol/ext-tasks@0.1.0` (pinned) against a
  mokei server over stdio and HTTP. The plan's first interop step inspects the `0.1.0` adapter
  API (its V2 guidance uses raw dispatch plus request framing) and builds the fixture from it.
  A failure is diagnosed as an adapter or mokei bug, not recorded as a gap.

## 5. Docs and release

- `docs/agents/architecture.md`: a tasks section (the task manager and why it is
  application-owned, store and CAS, owner binding, client waiting).
- Update the migration milestone record quoted above.
- READMEs for `@mokei/context-server` and `@mokei/context-client`.
- A changeset with a minor bump (lockstep versioning moves all public packages).

## Verification

- `rtk proxy pnpm run lint` clean.
- `pnpm build`, then `pnpm test` passes.
