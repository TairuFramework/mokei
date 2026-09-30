# Host desktop interaction design

Date: 2026-09-29
Status: draft, pending user review. Task input internals split out to the task input lifecycle design.

## Goal

Let a single-user host reach its user through the desktop when a server needs input and no
interactive UI is attached: a cron job, a daemon, or a headless `AgentSession`. Blocking mode
can show a dialog directly; delayed inbox mode requires a local answer surface supplied by the
application. The main case is a background decision flow whose `input` node suspends its task
in `input_required`. The host's context client fulfils that request through the host `elicit`
handler, and this design supplies that handler.

The desktop helpers live in a new Node-only package, `@mokei/host-desktop` (user-approved
2026-09-30). Task input changes in `@mokei/context-client` and `@mokei/context-server` are a
separate design (see Task input prerequisites). There is no new MCP server.

- **`createDesktopElicitHandler(options)`**: a host `elicit` handler. By default it shows a
  blocking desktop dialog (`alerter` or `osascript` on macOS, `zenity` on Linux). With
  `mode: 'inbox'` it sends a desktop notification and leaves the request pending in an
  input inbox only when the application has registered a local answer surface.
- **`createInputInbox()`**: the pending-input inbox. The application lists pending requests and
  answers, declines or cancels them, or opens the dialog for one on demand.
- **`createDesktopTools(options)`**: optional `local:notify` and `local:ask_user` tools, so a
  headless agent can notify or ask the user directly. `ask_user` goes through the same elicit
  handler (blocking or inbox).

The desktop backends drive OS tools directly with `execFile`. `node-notifier` is not used: its
last release is more than three years old and it ships stale vendored binaries.

### Scenarios, in priority order

1. **Background decision flow.** A flow run by a headless host reaches an `input` node. The user
   gets a dialog now (blocking mode) or, with an application answer surface registered, a
   notification to answer later (inbox mode).
2. **Any server elicitation in a headless host.** The same handler covers every context of the
   host, on both protocol revisions.
3. **Headless agent that wants to ask or notify.** The model calls `local:ask_user` or
   `local:notify`.

### Non-goals

- Windows. The backend interface allows adding it later.
- Adapters other than those listed (`kdialog`, `terminal-notifier`, and so on).
- URL-mode elicitation. Both modes decline it.
- A CLI or monitor surface for the inbox (see [Answer surfaces](#answer-surfaces)).
- Persisting inbox entries. The inbox is rebuilt from tasks instead (see
  [Durability](#durability)).
- Reaching a user with no graphical session (macOS LaunchDaemon, Linux without a display or
  D-Bus session).
- A shared or multi-user answer endpoint. Inbox entries have no authenticated owner binding;
  this helper is for one user's host process only.

## Placement

`@mokei/host-desktop` is a new Node-only package (`packages/host-desktop`), in the fixed release
group. It works with any `ContextHost`, not only `NodeContextHost`: the handler plugs into the
host `elicit` parameter and the tools into its local tools. Keeping it out of `@mokei/host-node`
means headless `host-node` users (servers, CI, the CLI over HTTP) never load desktop dialog code
or its platform branches, and the inbox can evolve on its own.

- **Layout:** it copies the `@mokei/host-node` scaffolding:
  - `package.json`: one `.` export, `lib/index.js`, `"type": "module"`, `sideEffects: false`;
  - the same `build`, `test`, `test:types` and `test:unit` scripts;
  - `tsconfig.json` and `tsconfig.test.json`;
  - `README.md`, and a `LICENSE` copied from the repo root (`host-node` has none).
- **Dependencies:**
  - `@mokei/host`, for `HostElicitHandler` and the local tool types;
  - `@mokei/context-client`, for `ElicitHandler`;
  - `@mokei/context-protocol`, for the elicitation types;
  - `@sozai/event` (catalog), for the inbox events.
- **No dependency on `@mokei/host-node`.** The `NodeContextHost` usage below is an example only.
  Dev dependencies: `@mokei/host-node` and `@mokei/context-server` (the integration tests use
  `NodeContextHost`, `ContextServer` and `createTaskManager`), plus `@types/node` as in `host-node`.
- **Workspace wiring:**
  - add the package to `versioning.fixed` in `pnpm-workspace.yaml`, with version `0.14.0` to
    match the group;
  - regenerate and commit `pnpm-lock.yaml` after adding `packages/host-desktop/package.json`
    (CI installs with `--frozen-lockfile`);
  - add it to the Feature Map, Package Structure and the Node-only packages paragraph in
    `docs/agents/architecture.md`.
- **Child processes** use `node:child_process` `execFile`, not `nano-spawn`, because the runner
  needs direct control of each child for tracking and kills.

### Source layout

```
packages/host-desktop/src/
  elicit-handler.ts     createDesktopElicitHandler, dialog queue
  inbox.ts              createInputInbox, InputInbox, PendingInput, InboxDisposedError
  form.ts               elicitation form to dialog mapping, answer validation
  tools.ts              createDesktopTools (notify, ask_user)
  runner.ts             createRunner: execFile, timeout, abort, child tracking
  detect.ts             backend detection, cached
  backends/types.ts     DesktopBackend, AskRequest, AskResult, NotifyRequest
  backends/alerter.ts
  backends/osascript.ts
  backends/zenity.ts
  backends/notify-send.ts
```

`packages/host-desktop/src/index.ts` exports `createDesktopElicitHandler`, `createInputInbox`,
`createDesktopTools`, `createRunner`, `InboxDisposedError` and their types. Nothing is added to
`@mokei/host`, `@mokei/host-node` or `@mokei/session`. The only new package is
`@mokei/host-desktop`.

## How a request reaches the handler today

A host builds each context's client with `elicit: this.createElicitHandler({ key, elicit })`
(`packages/host/src/host.ts:487`, `:564`; `packages/host-node/src/node-host.ts:159`). That
dispatcher adds the context `key` and calls the `AgentSession` override when one is installed,
otherwise the host's `elicit` handler; with `elicit: true` and no handler it declines
(`host.ts:292-319`). The request type is `HostElicitRequest = { key, params, signal }`
(`host.ts:134-140`).

The client reaches its `elicit` handler on three paths:

| Path | Where | Signal passed to the handler |
|---|---|---|
| `2025-11-25` server-initiated `elicitation/create` | `ContextClient._handleRequest` (`packages/context-client/src/client.ts:1292-1294`) | aborts on the server's `notifications/cancelled` |
| `2026-07-28` MRTR, a tool call answered `input_required` | `runInputRequiredFlow` dispatch (`packages/context-client/src/mrtr.ts:192-210`) through `#fulfilInputRequest` (`client.ts:1252-1281`) | per-round signal linked to the caller's `signal` |
| `2026-07-28` task in `input_required` | `TaskWaiter.#dispatchInputs` (`packages/context-client/src/task-waiter.ts:295-318`) through the same `#fulfilInputRequest` (`client.ts:1645-1647`) | the waiter entry's controller, aborted when the last waiter on that task releases (`task-waiter.ts:233-240`) |

On the task path:

- A task is waited on either by `callTool`'s automatic wait (`client.ts:1720-1727`), which uses
  the call's `signal` and `timeout` and sets `cancelOnAbort: true`, or by
  `client.tasks.wait(taskId, { signal })` (`client.ts:383`), which never sets `cancelOnAbort`.
- On each `input_required` snapshot the waiter dispatches every request key once per waiter
  entry (`task-waiter.ts:112-114`, `:297-298`). When the handler resolves, the waiter sends
  `tasks/update` only if the key is still outstanding (`task-waiter.ts:302`).
- A handler rejection becomes the wait's error (`task-waiter.ts:308-316`). A missing handler
  (`InputRequiredNotSupportedError`) becomes `TaskInputUnavailableError`, and only then, with
  `cancelOnAbort`, does the waiter send `tasks/cancel` (`task-waiter.ts:142-148`). Any other
  rejection leaves the task in `input_required`.
- Server side, `requestInput(requests, { signal })` withdraws the request when its signal fires:
  the task goes back to `working` with no `inputRequests`
  (`packages/context-server/src/task-manager.ts:510-534`). The decision-flow server uses this for
  an `input` node's deadline.

Gap found while tracing: a withdrawn request is not signalled to the handler. The waiter's next
snapshot clears `entry.inputs` (`task-waiter.ts:254`), but the handler's signal is the waiter
entry's, which stays live. A dialog stays open after the deadline and the answer is dropped at
`task-waiter.ts:302` (covered today by the test "does not send a fulfilled key withdrawn by the
latest snapshot" in `packages/context-client/test/task-waiter.test.ts:387`). The
[context-client change](#context-client-change) fixes this.

`AgentSession` installs its override with `handleElicitation` at construction when the host has
elicitation enabled (`packages/session/src/agent-session.ts:128-134`). The override calls
`onElicitation` when given, else `fallback({ signal })`, which is the host handler. The signal it
passes combines the request signal, the agent's signal, and, when the request's `key` matches the
in-flight context tool, that tool call's signal (`agent-session.ts:137-160`). The override is
removed when the agent is disposed and its runs have settled.

## Desktop elicit handler

```ts
function createDesktopElicitHandler(options?: DesktopElicitOptions): DesktopElicitHandler

type DesktopElicitHandler = ((request: DesktopElicitRequest) => Promise<ElicitResult>) & {
  dispose(): Promise<void>
}
type DesktopElicitRequest = {
  key?: string
  params: ElicitRequest['params']
  signal: AbortSignal
}
```

The call signature is assignable to `HostElicitHandler` (`host.ts:140`) and to the client
`ElicitHandler` (`packages/context-client/src/types.ts:62-64`), which has no `key`. Usage:

```ts
const desktop = createDesktopElicitHandler()
const host = new NodeContextHost({ elicit: desktop, dispose: () => desktop.dispose() })
```

`ContextHostParams.dispose` runs after the contexts are removed (`host.ts:149-153`, `:255-262`).
`Session` and `NodeSession` build their host from `elicit` only, so with them the application
disposes the handler itself.

**Composing with `onElicitation`.** The desktop handler is the host's base handler, so an
`AgentSession` without `onElicitation` falls back to it. An application with its own UI can
route between them:

```ts
const agent = new AgentSession({
  session,
  provider: 'anthropic',
  model,
  onElicitation: (request) => (ui.attached ? ui.ask(request) : desktop(request)),
})
```

### Options

| Option | Default | Notes |
|---|---|---|
| `mode` | `'dialog'` | `'dialog'` (blocking) or `'inbox'` (delayed) |
| `inbox` | none | Required when `mode` is `'inbox'`; construction throws otherwise |
| `timeoutSeconds` | `90` | Dialog budget: starts at handler invocation in blocking mode or at `inbox.prompt(id)` in inbox mode; includes queueing, all fields and retries; clamped to `maxTimeoutSeconds`. A pending inbox entry has no such budget |
| `maxTimeoutSeconds` | `600` | Upper clamp |
| `appName` | `'mokei'` | Dialog and notification title |
| `describeSource` | `(r) => r.key ?? 'A server'` | Names the requester in dialogs and notifications |
| `notificationPromptPreview` | `false` | Opt in to the first 200 characters of the prompt in OS notifications; may expose private input on a lock screen or in notification history |
| `backends` | detected | `{ ask?: 'alerter' \| 'osascript' \| 'zenity', notify?: 'osascript' \| 'notify-send' }` |
| `runner` | `createRunner()` | Owned and disposed by the handler unless passed in |
| `platform`, `env` | `process.platform`, `process.env` | Test injection for detection |
| `onUnsupported` | none | `(reason: string) => void`, called for unsupported requests and inbox notification or answer-route failures; inbox failures log to stderr when absent |

An unavailable forced `ask` backend makes the first dialog request decline with a clear error
sent to `onUnsupported` (or stderr when absent), not construction throw, because detection is
lazy. An unavailable forced `notify` backend follows the inbox notification rule: report the
delivery failure and leave the entry pending. `options.backends` is never overridden by another
adapter when the forced backend cannot represent a request.

### Blocking mode

The handler shows the request as one or more dialogs and resolves with the result.

- **One dialog at a time.** Requests are queued FIFO per handler, so concurrent elicitations do
  not stack dialogs. The request budget starts when the handler is invoked, includes queue time,
  every field and every retry, and never resets between dialogs. Each backend receives only the
  remaining time. When it expires, remove a queued request or kill its open dialog and return
  `{ action: 'cancel' }`. A request whose signal aborts while queued leaves the queue and rejects
  with the signal's reason.
- **Signal.** An abort kills the open dialog (runner kill) and rejects with the abort reason.
  The budget's own expiry is handled separately as `cancel`.

#### Form mapping

Only form mode with a flat `requestedSchema` is shown. Each property becomes one dialog, in the
order of `requestedSchema.properties`. The dialog text is `describeSource(request)`, the request
`message`, then the property's `title` (or name) and `description` on their own lines.

| Property schema | Dialog | Content value |
|---|---|---|
| `{ type: 'string' }` without `enum` or `oneOf` | `text`, prefilled with `default` | the string |
| `{ type: 'string', enum }` | `choice` over `enum`, labels from `enumNames` when present | the selected `enum` value |
| `{ type: 'string', oneOf: [{ const, title? }] }` | `choice`, labels from `title` or `const` | the selected `const` |
| `{ type: 'number' }` or `{ type: 'integer' }` | `text`, prefilled with `default` | `Number(answer)` |
| `{ type: 'boolean' }` | `confirm`, default choice from `default` | `true` or `false` |

- Constraints are checked after each answer: `minLength`, `maxLength`, `pattern`, `format`
  (`email`, `uri`, `date`, `date-time`), `minimum`, `maximum`, integer-ness. On a violation the
  dialog reopens with the violation on its first line, at most 3 attempts per property.
- An optional property whose `text` answer is empty is left out of `content`.
- An empty `properties` object shows one `confirm` with the message: Yes gives `accept` with
  `content: {}`; No or closing the dialog gives `cancel`.
- The decision-flow server sends a single primitive wrapped as a required `value` property
  (decision-flow server spec, Suspensions); it maps like any one-property form.

#### Result mapping

| Outcome | `ElicitResult` |
|---|---|
| Every dialog answered | `{ action: 'accept', content }` |
| A dialog dismissed (cancel or close button; `confirm` "No" is a boolean answer when a boolean property is being asked) | `{ action: 'cancel' }` |
| Explicit `Decline` button, if an adapter exposes one | `{ action: 'decline' }` |
| Overall request budget expires, a dialog times out, or constraint attempts are exhausted | `{ action: 'cancel' }` |
| `request.signal` aborted | open dialog killed; the handler rejects with the abort reason |

The supplied dialog backends need not expose a `Decline` button; they must never infer
`decline` from a window close, Escape, or another dismissal. The inbox's explicit
`decline(id)` action provides refusal in delayed mode. Handler refusal for unsupported
requests remains the separate case below.

#### Declined without a dialog

The handler returns `{ action: 'decline' }` and calls `onUnsupported` when:

- `params.mode` is `'url'`;
- a property is not in the mapping table (multi-select `type: 'array'`, or anything else);
- `properties` has more than 10 entries;
- an `enum` or `oneOf` has duplicate or empty values or labels;
- no `ask` backend is available. The handler never throws for this.

### Inbox mode

Inbox mode is an application integration primitive, not a complete headless answer UI. For each
request the handler:

1. declines URL mode, as in blocking mode;
2. checks `inbox.hasAnswerSurface`. If false, it reports the missing surface through
   `onUnsupported` (or stderr when no callback is supplied) and returns `{ action: 'cancel' }`
   without adding an entry;
3. adds the entry with `inbox.add(request, { prompt })` and keeps its pending answer promise;
   `prompt` opens this handler's blocking dialogs. Forms that the dialog mapping does not
   support are still added, with `canPrompt: false`; the registered local answer surface can
   handle them;
4. after adding the entry, starts a desktop notification with title `appName` and generic body
   `<describeSource(request)> needs your input`. Only `notificationPromptPreview: true` appends
   the first 200 characters of `message`. This delivery attempt has a 5-second runner timeout
   and does not hold up the answer promise. A missing backend, delivery failure or timeout is
   reported through `onUnsupported` (or logged to stderr by default), without removing the
   entry. The handler returns the pending answer promise without awaiting notification delivery.
   If the last answer surface unregisters while delivery is in flight, the inbox settles and
   removes the entry as `cancel` under its normal last-surface rule.

Only a missing registered answer surface fails the request visibly with no entry. Notification
delivery failure or timeout leaves an entry reachable through a registered surface. A successful
`execFile` notification only confirms handoff to the OS; the application still needs its
registered answer surface because the OS may suppress display.

The returned promise settles when the user answers through the inbox, or rejects when the
request's signal aborts or the inbox is disposed. A pending entry has no 90-second handler
budget: it lives until task expiry, withdrawal, caller abort, or answer (or explicit inbox
settlement/disposal). `inbox.prompt(id)` starts a fresh dialog budget at invocation, including
queue time. The caller may impose its own earlier bound (see [Caller timeouts](#caller-timeouts)).

## Input inbox

```ts
function createInputInbox(): InputInbox

type InputInbox = {
  readonly events: EventEmitter<InputInboxEvents>
  readonly hasAnswerSurface: boolean
  registerAnswerSurface(): () => void
  add(request: DesktopElicitRequest, options?: { prompt?: InboxPrompt }): Promise<ElicitResult>
  list(): Array<PendingInput>
  get(id: string): PendingInput | undefined
  answer(id: string, content: ElicitResult['content']): boolean
  decline(id: string): boolean
  cancel(id: string): boolean
  prompt(id: string): Promise<ElicitResult>
  dispose(): void
}

type InboxPrompt = (signal: AbortSignal) => Promise<ElicitResult>

type PendingInput = {
  id: string                                   // random UUID, stable for the entry's life
  key?: string                                 // host context key
  message: string
  requestedSchema: { type: 'object'; properties: Record<string, PrimitiveSchemaDefinition>; required?: Array<string> }
  createdAt: number                            // epoch ms
  canPrompt: boolean
}

type InputInboxEvents = {
  added: PendingInput
  settled: { id: string; action: ElicitResult['action'] }
  removed: { id: string; reason: 'withdrawn' | 'aborted' | 'disposed' }
}
```

- `add` accepts form-mode params only (URL mode throws `TypeError`). It registers the entry,
  emits `added`, and returns a promise for the answer. `add` is public, so an application can
  build its own delayed handler (for example one that posts to a chat) on the same inbox.
- `registerAnswerSurface()` is called after the application's local UI or keyboard answer route
  is ready. It marks the route available and returns an unregister function; registrations are
  counted, and `hasAnswerSurface` is true while at least one remains. The route uses
  `list`/`get` and `answer`/`decline`/`cancel`/`prompt`. It must stay registered while requests
  are pending. If the last route unregisters while entries are pending, the inbox reports an
  error to stderr and settles them as `cancel` rather than leaving them unreachable. A custom
  delayed handler using this inbox registers its own answer route under the same rule.
- `answer(id, content)` validates `content` against the entry's `requestedSchema`: only declared
  properties, every required property present, types, `enum` and `oneOf` membership, string
  arrays for multi-select with every item matching an offered `items.enum` value or
  `items.anyOf[].const` value, and the constraints listed under the form mapping. Invalid content
  throws `InboxAnswerInvalidError` with the issues and leaves the entry pending. Valid content
  resolves the entry with `{ action: 'accept', content }`.
- `decline(id)` resolves `{ action: 'decline' }`; `cancel(id)` resolves `{ action: 'cancel' }`.
- `answer`, `decline` and `cancel` return `false` when the entry no longer exists (already
  settled, withdrawn or aborted). That race is normal and is not an error.
- `prompt(id)` runs the entry's `InboxPrompt` and returns its result. `accept`, `decline`, and
  `cancel` all settle the entry; closing or dismissing a prompt therefore cancels the request.
  A second `prompt` for the same entry while one is open returns the same promise. It rejects
  when the entry has no prompt or does not exist. Settlement through another answer action
  aborts any open prompt and ignores its late result.
- When the request's signal aborts, the entry is removed, any open prompt dialog is killed, the
  `add` promise rejects with the signal's reason, and `removed` is emitted with `'withdrawn'`
  when the reason is a `TaskInputWithdrawnError` (below), `'aborted'` otherwise.
- `dispose()` removes every entry, rejects each `add` promise with `InboxDisposedError`, and
  emits `removed` with `'disposed'`. It deliberately does not answer `cancel`: for a decision
  flow, `cancel` would abort the run, while a rejection leaves the task in `input_required`
  (`task-waiter.ts:308-316`), so it can be picked up again after a restart.
- Settlement emits `settled` with the action only, never the content.

### Answer surfaces

The inbox lives in a single-user host process. `@mokei/host-desktop` provides only the programmatic
API; the application registers its local UI or a keyboard shortcut calling `prompt` before it
starts inbox-mode work. Entries carry a context key but no authenticated owner, and
`answer(id, content)` checks only the entry ID and schema. A shared or multi-user HTTP answer
endpoint is out of scope; it would require authenticated owner binding on creation, listing,
and every answer action. A `mokei` CLI command (`packages/cli`) or a `monitor` view is also out
of scope: both run in another process and need an IPC surface for the inbox, most naturally on
the host daemon socket (`runDaemon` and `@mokei/host-protocol`).

## Task input prerequisites

The desktop handler depends on how task input requests behave, which is specified separately
in the task input lifecycle design
(`docs/superpowers/specs/2026-09-29-task-input-lifecycle-design.md`). This spec relies only on
this contract:

- **Withdrawal reaches the handler.** When a request key leaves the task's outstanding input
  (withdrawn at a deadline, answered by another waiter, task ended or expired), the signal the
  waiter passed to the handler aborts with `TaskInputWithdrawnError` (or `TaskExpiredError` on
  TTL deletion). Blocking mode closes its dialog; inbox mode removes the entry with
  `'withdrawn'`. The decision-flow server withdraws at every `input` node deadline, so this is
  the normal path.
- **A late answer is harmless.** An answer submitted after withdrawal does not fail the wait;
  the waiter re-reads the task and carries on.
- **Snapshots are consistent.** A task snapshot never shows `input_required` with an empty
  `inputRequests` map, lists only unanswered keys, and a stale snapshot never reopens a
  withdrawn request.

No change to `@mokei/host`: the host dispatcher and the `AgentSession` override pass the signal
through unchanged.

## Caller timeouts

An inbox entry remains pending until it is settled or the handler's signal ends; a blocking
dialog also has its own budget. Which callers can wait long:

| Caller | Bound | Long wait? |
|---|---|---|
| `AgentSession` tool call (including a flow tool) | `toolTimeout`, 120 s by default (`packages/session/src/agent-types.ts:387`), applied at `agent-session.ts:792-794`; the turn's `timeout`, 300 s (`agent-types.ts:386`) | No, unless both are raised |
| `ContextHost.callNamespacedTool` or `client.callTool` with `timeout` or `signal` | that timeout or signal; the automatic task wait sends `tasks/cancel` on abort (`client.ts:1722-1727`, `task-waiter.ts:134-141`) | Only as long as the bound |
| `client.callTool` without `timeout` or `signal`, task or MRTR | none on the client side | Yes |
| `client.callTool({ task: 'handle' })`, then `client.tasks.wait(taskId)` without a signal | no caller timeout; a finite task TTL is checked even with a subscription | Yes, until expiry |
| The decision-flow server's own sibling waits (`caller.waitTask`, decision-flow server spec, ToolCaller) | the flow run's signal | Yes, while the flow runs |
| `2025-11-25` server-initiated elicitation | the server's own request timeout | Server-dependent |

Bounds that apply to every task wait:

- **Task TTL.** A task expires `ttlMs` after creation, whatever its status; the default is one
  hour (`task-manager.ts:185`, `:260-265`). The subscribed wait's expiry refresh observes a
  silently deleted task, fails with `TaskExpiredError`, and releases the inbox entry when its
  last caller exits. The polling path applies the same check. An answer racing expiry is also
  reported as `TaskExpiredError` only when its failed `tasks/update` is followed by a
  `tasks/get` that finds the task gone and the last known snapshot's finite TTL deadline has
  passed; otherwise the original update error is preserved.
- **The server's own deadline.** A decision-flow `input` node with a deadline withdraws the
  request at that time; the node takes its timeout edge and, with the context-client change, the
  inbox entry is removed with `'withdrawn'`.

The blocking handler's default 90-second budget starts when it receives a request, including
queue time and every field. A pending inbox entry has no 90-second budget; a later
`inbox.prompt(id)` starts a fresh dialog budget. The dialog budget is shorter than
`AgentSession`'s default 120-second tool timeout, whose clock starts before tool execution.
Upstream tool work can consume the 30-second margin before elicitation begins, so the agent
timeout can still win; callers needing a guaranteed `cancel` response must set a handler budget
based on their remaining tool time or raise `toolTimeout`.

When `AgentSession`'s `toolTimeout` fires during a flow tool call, the call ends with
`ToolCallTimeoutError`, the automatic wait sends `tasks/cancel`, the flow run is aborted, and the
pending request's signal aborts (dialog killed or entry removed). This is why the blocking
default is 90 s total, and why inbox mode only helps an `AgentSession` whose `toolTimeout` and
`timeout` are raised to cover the expected answer time.

## Durability

In-process state (the dialog queue, inbox entries, the promises behind them) dies with the
process. The server-side task and its `inputRequests` survive when the server uses a persistent
`TaskStore`.

Decision: the inbox is not persisted. It is rebuilt by waiting on the task again. After a
restart, `client.tasks.wait(taskId)` on a task in `input_required` creates a new waiter entry,
which dispatches every outstanding request to the host's `elicit` handler
(`task-waiter.ts:112-114`, `:295-300`); in inbox mode that adds a new entry (with a new `id`) and
sends a new notification. No inbox API is needed for this.

- For an in-session decision-flow server with a persistent store, `addDecisionFlow` runs
  `tasks.recover` before registering the context (decision-flow server spec, Session wiring,
  step 4), and recovery re-issues the `input` node's request under the same key (Recovery,
  step 3). The application then calls `tasks.wait` for the task IDs it kept.
- `@mokei/host-desktop` stores no task IDs. The application persists the IDs it wants to resume;
  it gets them from `callTool({ task: 'handle' })`.
- A flow started by an `AgentSession` tool call cannot be resumed this way: the task ID never
  reaches the application (the automatic wait hides it), and the agent turn died with the
  process. The task stays in `input_required` until its TTL. The docs state this limitation.

## Local tools

```ts
function createDesktopTools(options: DesktopToolsOptions): Array<LocalToolDefinition>
```

Registered like any local tool: `host.addLocalTools(createDesktopTools({ elicit: desktop }))`
(`host.ts:437-454`), or `new Session({ localTools })`. The host exposes them as `local:notify`
and `local:ask_user` (`host.ts:408-411`). Local tools receive `{ input, meta, signal }`
(`packages/host/src/local-tools.ts:29-33`) and have no access to the host.

| Option | Default | Notes |
|---|---|---|
| `elicit` | none | The handler `ask_user` calls, normally the desktop handler (either mode). Without it, `ask_user` is not returned |
| `notify` | `true` | `false` leaves `notify` out |
| `timeoutSeconds` | `90` | `ask_user`'s overall limit, below the default `toolTimeout` |
| `appName`, `backends`, `runner`, `platform`, `env` | as for the handler | Used by `notify` |

### `notify`

Input `{ message: string, title?: string, subtitle?: string, sound?: boolean }`. `subtitle` is
macOS only; `sound` is ignored on Linux. Returns once the notification is handed to the OS,
within the 5-second delivery timeout, with `structuredContent: { delivered: true, backend }`
and the same object as JSON text. With no notify backend, failed delivery or a delivery timeout,
it returns `isError: true` with an install hint or failure reason.

### `ask_user`

Input, flat for models:

```ts
{
  question: string
  kind: 'text' | 'confirm' | 'choice'
  choices?: string[]     // choice only, 2 to 20 unique non-empty strings
  default?: string       // text: prefill; confirm: 'yes' | 'no'; choice: one of choices
}
```

- It builds one form elicitation, `message: question`, with a single required `answer` property:
  `{ type: 'string' }`, `{ type: 'boolean' }` or `{ type: 'string', enum: choices }`, carrying
  `default`. Invalid input returns `isError: true` naming the field.
- It calls `options.elicit({ key: 'local', params, signal })`, where `signal` combines the tool's
  `signal` with `AbortSignal.timeout(timeoutSeconds * 1000)`. So `ask_user` is the same code
  path as any server elicitation, in blocking or inbox mode. Inbox mode still requires the
  application to register a local answer surface before the call.
- Result, in `structuredContent` and as JSON text:
  `{ status: 'answered', value }` for `accept`, `{ status: 'declined' }` for `decline`, and
  `{ status: 'cancelled' }` for `cancel` or for its own timeout. The tool description says
  `cancelled` covers timeouts. None of these is `isError`, and none has a top-level `error`
  property, so the tools fit decision-flow `tool` nodes.
- A cancelled tool call (the signal's reason is not its own timeout) rethrows, which
  `callLocalTool` turns into an `isError` result (`host.ts:744-753`).
- `ask_user` calls the handler directly, not through the host dispatcher, so an `AgentSession`
  `onElicitation` override does not see it and no `elicitation-*` events are emitted. An
  application that wants its own routing passes its routing function as `elicit`.
- To permit these tools, the application supplies a custom `ToolApprovalFn` that actually
  handles approval, or explicitly allows `local:ask_user` and `local:notify` in its approval
  policy. `toolApproval: 'ask'` alone emits pending then denies because no approval handler is
  configured (`agent-session.ts:721-727`); it does not show a prompt.

## Desktop backends

### Interface

```ts
type DesktopBackend = {
  name: string
  ask?: (request: AskRequest, options: { timeoutMs: number; signal: AbortSignal }) => Promise<AskResult>
  notify?: (request: NotifyRequest, options: { timeoutMs: number; signal: AbortSignal }) => Promise<void>
}
type AskRequest = { kind: 'text' | 'confirm' | 'choice'; title: string; text: string; default?: string; choices?: Array<{ value: string; label: string }> }
type AskResult = { status: 'answered'; value: string | boolean } | { status: 'declined' } | { status: 'dismissed' } | { status: 'timeout' }
```

Each adapter is split into pure functions (`buildArgs`, `parseResult`) and a thin wrapper that
calls the runner. The pure functions carry the logic and the tests. `declined` is reserved for
an adapter with a separately identifiable button labelled `Decline`; the supplied adapters do
not emit it.

### Runner

`createRunner()` returns `{ run, dispose }`. `run(cmd, args, { timeoutMs, signal })` returns
`{ code, stdout, stderr, timedOut }`.

- Uses `execFile`, never a shell.
- Kills the child on timeout (`timedOut: true`) and on abort.
- Tracks live children in a set. `dispose()` sends `SIGTERM` to each, then `SIGKILL` to any still
  alive after 1 second, and makes later `run` calls reject.
- The runner timeout is normally the backend's native timeout plus 5 seconds, so the native
  timeout, which reports cleanly, wins. For a blocking elicitation it is capped by the request's
  remaining overall budget; expiry of that budget maps to `cancel`, even if the runner kills the
  child first. A runner kill for an adapter timeout also maps to `timeout`.
- Notifications have no native timeout. Both the inbox handler and `local:notify` pass
  `timeoutMs: 5_000` to the backend and runner; a runner timeout is a delivery failure. The
  inbox handler catches and reports it without settling the registered entry.
- Injected through options, so tests use a fake runner.

### macOS

**`ask` via `alerter`** when it is on `PATH` ([vjeantet/alerter](https://github.com/vjeantet/alerter),
signed and notarized, `brew install vjeantet/tap/alerter`):

- Base: `alerter --json --timeout <N> --title <title> --message <text>`.
- `text`: `--reply <default or ''>`. `confirm`: `--actions Yes,No`. `choice`:
  `--actions <labels joined by ','>` (a dropdown for more than one action).
- A choice label containing a comma cannot be represented. Use `osascript` for that dialog only
  when `alerter` was auto-selected and `osascript` is available. With forced `alerter`, report
  a clear unsupported-choice error through `onUnsupported` (or stderr when absent) and return
  `decline`; never fall back. With auto-selected `alerter` and no `osascript`, report a missing
  choice-dialog capability with the macOS `osascript` install hint and return `decline`.
- JSON `activationType`: `replied` gives the reply; `actionClicked` gives the selected action
  (`Yes`/`No` become `true`/`false` for `confirm`); `closed` and `contentsClicked` give
  `dismissed`; `timeout` gives `timeout`.
- The JSON field names and values must be checked against alerter v26.5 output during
  implementation, and the parser tests built from captured real output.

**`ask` via `osascript`** otherwise:

- The AppleScript source is a fixed constant per kind, wrapped in `on run argv ... end run`. User
  strings (text, title, default, labels) are passed as argv after `--`, never interpolated into
  the script.
- `text`: `display dialog (item 1 of argv) with title ... default answer ... giving up after <N>`.
- `confirm`: `display dialog ... buttons {"No", "Yes"} default button ... giving up after <N>`.
- `choice`: `choose from list ... default items ...`. It has no native timeout; the runner
  enforces it.
- `gave up:true` gives `timeout`; exit code 1 with error `-128` gives `dismissed`; `choose from
  list` returning `false` gives `dismissed`.

**`notify` via `osascript`**: `display notification` with the same argv pattern, plus
`sound name "default"` when requested. `alerter` is not used for notifications because it blocks
until the alert is dismissed.

### Linux

**`ask` via `zenity`:**

- `text`: `zenity --entry --title <title> --text <text> --entry-text <default> --timeout <N>`.
- `confirm`: `zenity --list --radiolist` with explicit Yes/No rows and a native timeout, so
  the selected row gives `true` or `false` and closing the window is distinguishable.
- `choice`: `zenity --list --radiolist --column Pick --column Choice` with one `TRUE|FALSE <label>`
  row per choice; the default's row (else the first) is `TRUE`.
- Exit 0 gives `answered`, 1 gives `dismissed`, 5 gives `timeout` for every kind.

**`notify` via `notify-send`:** `notify-send [--app-name <appName>] <title> <message>`.

### Detection

Runs once, lazily, cached per handler or tool set:

| Adapter | Available when |
|---|---|
| `alerter` | platform `darwin` and `alerter` on `PATH` |
| `osascript` | platform `darwin` and `osascript` on `PATH` |
| `zenity` | platform `linux`, `zenity` on `PATH`, and `DISPLAY` or `WAYLAND_DISPLAY` set and non-empty |
| `notify-send` | platform `linux`, `notify-send` on `PATH`, and `DBUS_SESSION_BUS_ADDRESS` set and non-empty |

The `ask` backend is the first available of `alerter` then `osascript` (macOS), or `zenity`
(Linux). The `notify` backend is `osascript` or `notify-send`. `options.backends` forces one
for its capability and is never overridden; the choice-label `osascript` fallback above applies
only to auto-selected `alerter`.

**Graphical session required.** Detection cannot tell whether a user will see anything. The
README states:

- macOS: the process must run in the user's GUI session (Terminal, a LaunchAgent). A
  LaunchDaemon runs outside it: `osascript` dialogs fail, and `display notification` can be
  dropped silently. A `display notification` is attributed to Script Editor and dropped when
  that app's notifications are off.
- Linux: cron jobs and system services usually lack `DISPLAY`, `WAYLAND_DISPLAY` and
  `DBUS_SESSION_BUS_ADDRESS`, so detection finds nothing. A user systemd service, or a job that
  exports the desktop session's variables, works.

## Decision-flow integration

This section uses the decision-flow server as its spec describes it
(`../decision-flow-server/docs/superpowers/specs/2026-09-29-decision-flow-server-design.md`);
`addDecisionFlow` and `createDecisionFlowServer` are not on `main` yet. Nothing here requires a
change to that spec.

### Blocking, headless `AgentSession`

```ts
const desktop = createDesktopElicitHandler()
const session = new NodeSession({ providers, elicit: desktop })
await session.addContext({ key: 'tickets', command: 'node', args: ['tickets-server.js'] })
const flows = await addDecisionFlow(session, { key: 'flow', flows: [triage], predictor })
const agent = new AgentSession({ session, provider: 'anthropic', model,
  toolApproval: flows.wrapApproval('auto') })
await agent.run({ prompt: 'Triage the new tickets' })
```

1. The model calls `flow:flow_support_triage`. `AgentSession` calls
   `callNamespacedTool` with its per-call signal (`agent-session.ts:811-814`); the client gets a
   `CreateTaskResult` and waits automatically, with `cancelOnAbort`.
2. The flow reaches an `input` node. The flow server calls `requestInput` with one
   `elicitation/create` form and a signal for the node's deadline; the task goes to
   `input_required`.
3. The waiter dispatches the request to the host dispatcher with `key: 'flow'`. The
   `AgentSession` override attributes it to the flow tool call, emits `elicitation-request`, and
   calls `fallback`, which is the desktop handler.
4. The dialog shows "flow", the node's prompt, and the field. The answer goes back through
   `tasks/update`; the flow resumes; the tool call returns the flow result.

What the flow sees:

| User action | Handler result | Flow | Agent |
|---|---|---|---|
| Answers | `accept` | resumes with the value | flow result |
| Cancel or close button | `cancel` | run aborted, siblings cleaned up, task cancelled | tool call error (`TaskCancelledError`) |
| Explicit Decline button, when offered | `decline` | run aborted, siblings cleaned up, task cancelled | tool call error (`TaskCancelledError`) |
| Overall 90 s request budget exhausted (queue time, fields, retries) before other deadlines | `cancel` | run aborted, siblings cleaned up, task cancelled | tool call error (`TaskCancelledError`) |
| Node deadline before the dialog closes | handler signal aborts with `TaskInputWithdrawnError`; dialog killed | node takes its timeout edge | flow continues |
| `toolTimeout` (120 s by default) first, possible when prior tool work used the margin | handler signal aborts; dialog killed | `tasks/cancel` from the waiter; run aborted | `ToolCallTimeoutError` |

### Delayed, inbox mode

```ts
const inbox = createInputInbox()
const unregisterAnswerSurface = inbox.registerAnswerSurface() // after local UI is ready
inbox.events.on('added', (entry) => myUI.show(entry))
const desktop = createDesktopElicitHandler({ mode: 'inbox', inbox })
// later, from that single-user local answer surface:
inbox.answer(entryID, { value: 'escalate' })              // or inbox.prompt(entryID)
// unregisterAnswerSurface() when the UI closes; pending entries then cancel
```

The OS receives a generic notification "flow needs your input"; including a prompt preview
requires `notificationPromptPreview: true`. The user answers through the registered local
surface. Two ways to run the flow:

- **`AgentSession`, raised limits.** Set `toolTimeout` and `timeout` above the expected answer
  time. The turn stays open while the entry is pending. Not durable: if the process dies, the
  run is recoverable server-side only with a persistent store, and nothing resumes the wait
  (see [Durability](#durability)).
- **Application-driven run.** The application calls the flow tool itself with
  `task: 'handle'`, keeps the task ID, and waits with `client.tasks.wait(taskId)` and no
  timeout. With a persistent store it survives restarts: recover, then wait again, and the inbox
  gets the question again. The server must accept a call without an `AgentSession` grant: the
  decision-flow server spec allows this with `createDecisionFlowServer` and the application's
  own `approval` hook (Approval, last item), but not through `addDecisionFlow`, whose approval
  consumes grants minted by `wrapApproval`. An application-run entry point on
  `addDecisionFlow` is a follow-on for that spec, not part of this change.

Outcomes in inbox mode:

| Event | Flow |
|---|---|
| `inbox.answer` | resumes with the value |
| `inbox.decline` or `inbox.cancel` | run aborted, task cancelled |
| `inbox.prompt` dismissed or timed out | `cancel`; run aborted, task cancelled |
| Last registered answer surface closes | pending entries receive `cancel`; run aborted, task cancelled |
| No answer surface when request arrives | no entry is added; visible error and `cancel` |
| Notification delivery fails or times out with a registered surface | error is reported; entry stays available in the surface |
| Node deadline | request withdrawn; entry removed (`'withdrawn'`); node takes its timeout edge |
| One `tasks.wait` caller aborts while another still waits | shared entry stays; remaining caller can answer |
| Last `tasks.wait` caller aborts | entry removed (`'aborted'`); task stays `input_required` |
| A `callTool` automatic wait aborts | sends `tasks/cancel` even if another caller shares the wait; cancellation eventually removes the entry |
| `inbox.dispose()` | entry removed (`'disposed'`); the wait rejects; the task stays `input_required` |
| Task TTL reached, with or without a live subscription | expiry refresh, polling `tasks/get`, or failed-answer follow-up detects deletion after the last known finite TTL deadline; wait fails with `TaskExpiredError`; entry removed (`'aborted'`) after the last caller releases |

## Lifecycle

- The handler owns its runner unless one is passed; `handler.dispose()` disposes it (kills every
  dialog), rejects queued requests, and makes later requests reject.
- `execFile` children outlive a parent that exits without cleanup. The README shows wiring
  `dispose` to host disposal and to `SIGTERM`/`SIGINT`.
- The inbox is independent of the handler: disposing the handler kills an open `prompt` dialog
  but leaves entries pending; disposing the inbox rejects them.
- With `ProxyHost` (daemon-backed hosts), the handler runs in the proxy's process, where the
  application passed it, like any host handler.

## Error handling

| Situation | Result |
|---|---|
| URL mode, unsupported form (blocking), no `ask` backend | `decline`, `onUnsupported` called |
| Choice label containing a comma with forced `alerter` | `decline`, clear unsupported-choice error via `onUnsupported` or stderr; no backend switch |
| Choice label containing a comma with auto-selected `alerter` and no `osascript` | `decline`, missing choice-dialog capability via `onUnsupported` or stderr with the macOS `osascript` install hint |
| Dialog dismissed / timed out / attempts exhausted / overall request budget exhausted | `cancel` in every case |
| Explicit Decline action in a dialog, when an adapter exposes it | `decline` |
| Unexpected exit code or stderr from a backend | `cancel`, `onUnsupported` called with the first stderr line |
| Request signal aborted | dialog killed or entry removed; rejects with the reason |
| `mode: 'inbox'` without `inbox` | construction throws |
| Inbox request without a registered answer surface | reports error via `onUnsupported` or stderr; returns `cancel`, no entry added |
| Inbox notification fails or times out with a registered answer surface | reports error via `onUnsupported` or stderr; the already-added entry remains available to the local surface |
| `inbox.answer` with invalid content | throws `InboxAnswerInvalidError`; entry stays pending |
| `answer`, `decline`, `cancel` on a gone entry | returns `false` |
| `ask_user` invalid input | `isError: true` naming the field |
| `notify` without backend | `isError: true`; hint identifies the missing notification capability and platform: macOS `osascript` plus a GUI session, or Linux `notify-send` (`libnotify-bin`) plus `DBUS_SESSION_BUS_ADDRESS` when absent |

Install hints are selected from the failed capability, not a combined desktop package list.
Missing **dialog** support points to `alerter` or `osascript` on macOS, and `zenity` plus
`DISPLAY`/`WAYLAND_DISPLAY` on Linux. Missing **notification** support points to `osascript`
on macOS or `notify-send` on Linux. The hint names a missing session variable when detection
failed for that reason.

## Testing

Desktop unit tests run on any OS with vitest in `packages/host-desktop/test/*.test.ts`.

- **Adapters:** table-driven `buildArgs` and `parseResult` for each backend, kind, exit code and
  activation type, including an injection test (quotes, backslashes and AppleScript syntax in the
  text stay one argv item and never reach the script source).
- **Detection:** each row of the detection table with injected `platform` and `env`, including
  `zenity` without a display and `notify-send` without `DBUS_SESSION_BUS_ADDRESS`; a comma in a
  choice label falls back from auto-selected `alerter` to available `osascript`, forced
  `alerter` reports an error without switching, and auto-selected `alerter` without
  `osascript` reports the choice-specific install hint.
- **Runner and dispose:** kill on timeout and on abort, and `dispose()` killing tracked children,
  using `node -e` child scripts; `run` after `dispose` rejects.
- **Form mapping:** each mapping row; the wrapped `value` form; multi-property forms asked in
  order; optional empty text left out; constraint retries and exhaustion to `cancel`; empty
  `properties` with No mapping to `cancel`; dismissal mapping to `cancel`; only an explicit
  Decline action mapping to `decline`; every unsupported-request reason with `onUnsupported`.
- **Blocking handler** with a fake runner: result mapping, FIFO queue (a second request waits for
  the first dialog), a 90-second budget from invocation that expires while queued or across
  multiple fields and retries, abort while queued, abort while open (child killed), `dispose()`
  killing an open dialog and rejecting queued requests; a type test that the handler is
  assignable to `HostElicitHandler` and to the client `ElicitHandler`.
- **Inbox:** `add`/`list`/`get`; `answer` with valid and invalid content (each validation rule);
  a multi-select string array whose every item matches the offered `items.enum` or
  `items.anyOf[].const` choices, and rejection of an unknown item; `decline`; `cancel`;
  `false` on a gone entry; `prompt` settling on all three actions, with
  dismissal settling as `cancel`; concurrent `prompt` sharing one dialog; abort removing the
  entry with `'aborted'` and `'withdrawn'`; `dispose()` rejecting with `InboxDisposedError`;
  an external answer action aborting an open prompt; registration count and last-surface
  unregister cancelling pending entries; event order and no answer content in `settled`.
- **Inbox-mode handler:** no answer surface reports an error and returns `cancel` without an
  entry; with a registered surface, `added` fires before the generic notification attempt and
  the entry is answerable while delivery is in flight; preview text only with explicit opt-in;
  missing, failed or timed-out notify, including an unavailable forced `notify` backend,
  reports through `onUnsupported` or stderr after at most 5 seconds but leaves the entry
  reachable; unregistering the last surface while notification
  is in flight settles `cancel` and removes the entry; a pending entry remains available past
  90 seconds, while a later `prompt(id)` gets a fresh 90-second dialog budget;
  `canPrompt: false` for forms the dialog cannot show.
- **Task input contract:** covered by the task input lifecycle design's tests; here, a fake
  waiter aborting the handler signal with `TaskInputWithdrawnError` closes the dialog (blocking)
  and removes the inbox entry with `'withdrawn'` (inbox).
- **Decision-flow-style task through the inbox:** an in-memory `ContextServer` with
  `createTaskManager()` and a tool whose `req.task.run` work calls
  `handle.requestInput({ value: { method: 'elicitation/create', params } }, { signal })`,
  connected with `ContextHost.addDirectContext` on a host whose `elicit` is the inbox-mode
  handler with a fake runner and a registered answer surface. Cases: `inbox.answer` completes
  the task with the value; `inbox.decline` reaches the work function as `decline` and
  `inbox.cancel` as `cancel`; the work function's signal firing (a deadline) removes the entry
  with `'withdrawn'`; the last `client.tasks.wait` abort removes the entry and leaves the task
  `input_required`; a second `tasks.wait` on the same task adds the entry again (the rebuild
  path); a live-subscription wait crosses a short task TTL without a status event and the inbox
  entry is removed after its wait fails.
- **Local tools:** `notify` result, missing backend and 5-second delivery timeout;
  `ask_user` validation, each status, its own timeout giving `cancelled`, a cancelled call
  rethrowing, through `host.callLocalTool`.
- **Linux integration (CI only):** tests gated by `describe.runIf(process.env.DESKTOP_E2E)`. A
  new step in `.github/workflows/build-test.yml` (which runs on `ubuntu-latest`) installs
  `zenity` and `xvfb` and runs
  `xvfb-run -a env DESKTOP_E2E=1 pnpm --filter @mokei/host-desktop run test:unit` (the root test
  step does not set `DESKTOP_E2E`). They run
  real `zenity` with a 1 second timeout for each kind and assert `timeout`. `notify-send` is not
  run end to end (it needs a notification daemon).
- **macOS:** unit tests, plus a manual QA checklist in the README (alerter present and absent,
  each kind, timeout, abort, inbox notification, `prompt`, through a `NodeContextHost`).

## Release and docs

- One `pnpm change` intent, `patch`, for `@mokei/host-desktop` (the task input lifecycle work
  carries its own intent for `@mokei/context-client` and `@mokei/context-server`). The fixed release group moves every public package together; the
  repo stays in 0.14.x.
- `packages/host-desktop/README.md`: the package guide (blocking and inbox modes, the
  inbox API and answer-surface registration, single-user scope, generic notifications and
  opt-in previews, composing with `onElicitation`, caller timeouts, durability, local tools,
  graphical session requirements, macOS QA checklist).
- `docs/agents/architecture.md`: `@mokei/host-desktop` in the Feature Map, Package Structure and Node-only packages paragraph, and a paragraph under Session Elicitation on the desktop handler
  and inbox, and one line under MCP Tasks on withdrawn input requests aborting the handler and
  subscribed waits checking finite task TTLs and public task snapshots omitting answered keys.

## Follow-on

- Inbox IPC on the host daemon socket, then a `mokei inbox` CLI command and a `monitor` view.
- Authenticated owner binding for inbox entries and every list/answer action before any shared
  or multi-user HTTP answer endpoint is offered.
- An application-run entry point on `addDecisionFlow` (decision-flow server spec), so delayed,
  durable flow runs do not need `createDecisionFlowServer` and a custom approval hook.
- Actionable notifications (an "Answer" button that opens the dialog), where the backend supports
  it.
- Windows backends.
