# @mokei/host-desktop

Desktop dialogs, notifications and input inbox for Mokei hosts.

When a server asks for input (MCP elicitation), `createDesktopElicitHandler` answers it through
the desktop of the user running the host: native dialogs (`alerter` or `osascript` on macOS,
`zenity` on Linux) and notifications (`osascript` or `notify-send`). It is a `HostElicitHandler`,
so it plugs into `ContextHost`, `NodeContextHost`, `Session` and `NodeSession` through `elicit`.
The package is Node-only: it spawns the dialog and notification commands.

It has two modes:

- **`dialog`** (default, blocking): each request opens dialogs right away and the handler
  resolves with the answer.
- **`inbox`** (delayed): each request becomes a pending entry in an input inbox, the user gets a
  generic notification, and the application answers the entry later through its own UI.

## Blocking mode

```ts
import { createDesktopElicitHandler } from '@mokei/host-desktop'
import { NodeContextHost } from '@mokei/host-node'

const desktop = createDesktopElicitHandler()
const host = new NodeContextHost({ elicit: desktop, dispose: () => desktop.dispose() })
```

`ContextHostParams.dispose` runs after the host's contexts are removed. `Session` and
`NodeSession` build their host from `elicit` only, so with them dispose the handler yourself
(or pass a `contextHost` built as above).

- Each form property becomes one dialog, in schema order: a string is a text entry, a string
  `enum` or `oneOf` is a choice list, a number or integer is a text entry converted with
  `Number`, and a boolean is a Yes/No confirm. An empty form shows one confirm. Constraints
  (`minLength`, `maxLength`, `pattern`, `format`, `minimum`, `maximum`, integer-ness) are
  checked after each answer with JSON Schema 2020-12 semantics (AJV through `@sozai/schema`):
  lengths count code points and `pattern` is unanchored. A violation reopens the dialog with a
  readable message on its first line, at most 3 attempts.
- URL mode, multi-select arrays, other property types and forms with more than 10 properties
  are declined without a dialog, and `onUnsupported` (or stderr) gets the reason.
- Dialogs open one at a time; concurrent requests queue. A dialog killed by an abort or a
  timeout gets SIGTERM, then SIGKILL after 1 s, and the next queued dialog opens only once it has
  exited.
- Each request has a budget, `timeoutSeconds` (90 by default, clamped to `maxTimeoutSeconds`,
  600). It starts when the handler is called and covers queue time, every field and every
  retry. When it runs out, the handler returns `cancel`. Both options must be finite numbers
  greater than 0; any other value throws a `TypeError` when the handler is created.
- A dismissed dialog, a dialog timeout and exhausted attempts all give `cancel`. The supplied
  backends never infer `decline` from a close.
- Aborting the request's signal (for example when a task withdraws its input request) kills the
  open dialog and rejects with the abort reason.

Options: `mode`, `inbox`, `timeoutSeconds`, `maxTimeoutSeconds`, `appName` (dialog and
notification title, `'mokei'`), `describeSource` (names the requester, `request.key` by
default), `notificationPromptPreview`, `backends` (force `{ ask, notify }` backends), `runner`,
`onUnsupported`, and `platform` / `env` for detection.

## Inbox mode

Inbox mode suits input that may take longer than a dialog budget, such as a decision-flow task
waiting for a person. The inbox is a programmatic API; the application provides the UI.

```ts
import { createDesktopElicitHandler, createInputInbox } from '@mokei/host-desktop'

const inbox = createInputInbox()
// Register once the local UI or keyboard answer route is ready
const unregisterAnswerSurface = inbox.registerAnswerSurface()
inbox.events.on('added', (entry) => myUI.show(entry))
inbox.events.on('removed', ({ id }) => myUI.hide(id))

const desktop = createDesktopElicitHandler({ mode: 'inbox', inbox })

// Later, from the answer surface:
inbox.answer(entryID, { value: 'escalate' }) // or inbox.decline(id), inbox.cancel(id)
await inbox.prompt(entryID) // or open this handler's dialogs for the entry

// When the UI closes; entries still pending are then cancelled
unregisterAnswerSurface()
```

For each request the handler:

1. declines URL mode;
2. returns `cancel` and reports an error, without adding an entry, when no answer surface is
   registered;
3. adds the entry and returns its pending answer;
4. sends a desktop notification, `<describeSource(request)> needs your input`, without waiting
   for it. Delivery has a 5-second limit; a missing backend, a failure or a timeout is reported
   through `onUnsupported` (or stderr) and the entry stays pending.

A pending entry has no dialog budget. It lives until it is answered, the request is withdrawn or
aborted, or the inbox is disposed. `inbox.prompt(id)` starts a fresh `timeoutSeconds` budget.

### Inbox API

- `list()` and `get(id)` return `PendingInput` entries: `id`, context `key`, `message`,
  `requestedSchema`, `createdAt` and `canPrompt`.
- `answer(id, content)` validates `content` against the entry's schema (declared properties,
  required properties, types, `enum` and `oneOf` membership, multi-select items and the
  constraints above). Invalid content throws `InboxAnswerInvalidError` and leaves the entry
  pending; valid content resolves `accept`.
- `decline(id)` and `cancel(id)` resolve `decline` and `cancel`.
- `answer`, `decline` and `cancel` return `false` when the entry is already gone. That race is
  normal.
- `prompt(id)` opens the handler's dialogs for the entry. An outcome the person chose settles
  it: an answer, a decline, a dismissal, or the `timeoutSeconds` budget running out (`cancel`).
  An outcome no person chose rejects the prompt and leaves the entry pending, so the
  application can fall back to `answer`, `decline` or `cancel`: no dialog backend can show the
  form, or the backend fails (a missing command, an unknown exit code). When the prompt opens,
  the problem is also reported through `onUnsupported` (or stderr). A second `prompt` while one is open returns the
  same promise. Another answer action closes an open prompt.
- `canPrompt` is `true` when the form maps to dialogs and the detected dialog backend can show
  every one of them. It is `false` when no dialog backend is available, or when no available
  backend can show the form: a forced `alerter` refusing it (a choice label containing a comma,
  a value starting with `-`), or an auto-selected `alerter` refusing it with no `osascript` to
  fall back to. `prompt` then rejects without opening a dialog or reporting.
- Events: `added` (the entry), `settled` (`{ id, action }`, never the content) and `removed`
  (`{ id, reason }`, with `'withdrawn'` when a task withdrew the request, `'aborted'` for any
  other abort and `'disposed'`).
- `dispose()` removes every entry and rejects each pending answer with `InboxDisposedError`. It
  does not answer `cancel`, so a task stays in `input_required` and can be picked up again.
  `disposed` is then `true`, and a later request gets no notification.
- `add(request, { prompt })` is public, so an application can build its own delayed handler (one
  that posts to a chat, for example) on the same inbox. It registers its own answer surface
  under the same rule.

### Answer surfaces and single-user scope

`registerAnswerSurface()` marks an answer route as available and returns an unregister
function. Registrations are counted. The route must stay registered while entries are pending:
when the last one unregisters, pending entries are settled as `cancel` rather than left
unreachable.

The inbox lives in one single-user host process. Entries carry a context key but no
authenticated owner, and `answer` checks only the entry ID and the schema. Do not expose it
through a shared or multi-user endpoint.

### Notifications

Notifications are generic by default: title `appName`, body `<source> needs your input`.
`notificationPromptPreview: true` appends the first 200 characters of the request message,
which may expose private input on a lock screen or in notification history. A delivered
notification only means the OS accepted it; the OS may still suppress it, so the answer surface
is what the user relies on.

## Composing with `onElicitation`

The desktop handler is the host's base handler, so an `AgentSession` without `onElicitation`
falls back to it. An application with its own UI can route between them:

```ts
const agent = new AgentSession({
  session,
  provider: 'anthropic',
  model,
  onElicitation: (request) => (ui.attached ? ui.ask(request) : desktop(request)),
})
```

## Caller timeouts

A pending entry or open dialog lasts only as long as its caller waits:

- An `AgentSession` tool call is bounded by `toolTimeout` (120 s by default) and the turn's
  `timeout` (300 s). When `toolTimeout` fires, the automatic task wait sends `tasks/cancel`, and
  the dialog closes or the entry is removed. Inbox mode only helps an `AgentSession` whose
  `toolTimeout` and `timeout` cover the expected answer time. The 90-second dialog budget is
  below the default `toolTimeout`, but earlier tool work can use up the margin; set
  `timeoutSeconds` from the remaining tool time when a guaranteed `cancel` matters.
- `callTool` or `callNamespacedTool` with a `timeout` or `signal` waits as long as that bound.
- `client.callTool({ task: 'handle' })` followed by `client.tasks.wait(taskId)` without a signal
  waits until the task's TTL (one hour by default). The wait fails with `TaskExpiredError` when
  the task expires, and the entry is removed.
- A decision-flow `input` node with a deadline withdraws its request at that time: the entry is
  removed with `'withdrawn'` and the flow takes its timeout edge.

## Durability

Inbox entries, the dialog queue and the promises behind them live in the process. The server's
task and its input requests survive a restart when the server uses a persistent `TaskStore`.

The inbox is not persisted. It is rebuilt by waiting on the task again: after a restart,
`client.tasks.wait(taskId)` on a task in `input_required` dispatches its outstanding requests to
the host's `elicit` handler, which adds a new entry (with a new `id`) and sends a new
notification. The application keeps the task IDs it wants to resume; it gets them from
`callTool({ task: 'handle' })`. For an in-session decision-flow server with a persistent store,
`addDecisionFlow` recovers the flow run before the context registers; then call `tasks.wait` for
the kept IDs.

**Limitation:** a flow started by an `AgentSession` tool call cannot be resumed this way. The
automatic wait hides the task ID from the application, and the agent turn dies with the
process. The task stays in `input_required` until its TTL.

## Local tools

```ts
import { createDesktopTools } from '@mokei/host-desktop'

const tools = createDesktopTools({ elicit: desktop })
host.addLocalTools(tools)
// On shutdown: await tools.dispose()
```

The host exposes them as `local:notify` and `local:ask_user`.

- `notify` takes `{ message, title?, subtitle?, sound? }` (an empty or blank `title` gives the
  app name; `subtitle` is macOS only; `sound` is ignored on Linux) and returns `{ delivered: true, backend }` once the OS accepts the
  notification, within 5 seconds. With no backend or a failed delivery it returns an
  `isError` result with an install hint or the failure reason.
- `ask_user` takes `{ question, kind: 'text' | 'confirm' | 'choice', choices?, default? }`,
  builds a one-property form and calls `elicit` with it (key `'local'`), in either mode. It
  returns `{ status: 'answered', value }`, `{ status: 'declined' }` or
  `{ status: 'cancelled' }`; its own `timeoutSeconds` limit (90 by default) gives `cancelled`.
  It is left out when `elicit` is not given. It calls `elicit` directly, so an `AgentSession`
  `onElicitation` override does not see it; pass your routing function as `elicit` if needed.
- `toolApproval: 'ask'` alone denies these tools, because no approval handler shows a prompt.
  Supply a `ToolApprovalFn` or allow `local:notify` and `local:ask_user` explicitly.

`tools.dispose()` disposes the runner `createDesktopTools` created itself, killing a running
notification; `notify` then returns an error. A `runner` you pass in stays yours to dispose.

## Shutdown

Dialog and notification commands run as child processes through `execa`, without a shell. The
runner asks `execa` to kill them when the Node process exits, but a parent killed with SIGKILL
still leaves them running, and exit-time cleanup cannot wait for them. `handler.dispose()` disposes the handler's own runner (killing every open
dialog), rejects queued requests and makes later dialog requests reject; it does not dispose a runner
you passed in. Wire it to host disposal and to process signals:

```ts
async function shutdown() {
  await host.dispose() // runs desktop.dispose() through ContextHostParams.dispose
  inbox.dispose()
  await tools.dispose()
  process.exit(0)
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
```

The inbox is independent of the handler: disposing the handler kills an open `prompt` dialog
but leaves entries pending; disposing the inbox rejects them.

## Graphical session requirements

Detection finds commands and environment variables, but cannot tell whether a user will see
anything.

- **macOS:** the process must run in the user's GUI session (Terminal, a LaunchAgent). A
  LaunchDaemon runs outside it: `osascript` dialogs fail, and `display notification` can be
  dropped silently. A `display notification` is attributed to Script Editor and dropped when
  that app's notifications are off. `alerter` (`brew install vjeantet/tap/alerter`) is preferred
  for dialogs; `osascript` is the fallback. alerter has no `--` option terminator, so a request
  whose alerter option values would include a choice label containing a comma, or a title,
  text, reply default or actions list starting with `-`, uses `osascript` instead. When
  `alerter` is forced, such a request is declined and reported through `onUnsupported`.
- **Linux:** `zenity` needs `DISPLAY` or `WAYLAND_DISPLAY`, and `notify-send` (`libnotify-bin`)
  needs `DBUS_SESSION_BUS_ADDRESS`. Cron jobs and system services usually lack them, so
  detection finds nothing. A user systemd service, or a job that exports the desktop session's
  variables, works.
