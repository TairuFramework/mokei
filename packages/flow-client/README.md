# @mokei/flow-client

Portable flow control for the Mokei flow daemon: the `FlowControl` interface, wire-derived run, inbox and trace types, `FlowControlError`, a remote adapter, status and wait helpers, and a generic MCP server exposing a `FlowControl` as tools. It uses no Node APIs.

## Installation

```sh
pnpm add @mokei/flow-client
```

## `FlowControl`

One interface over the flow service, with `flows` (`list`, `check`), `runs` (`start`, `get`, `list`, `cancel`, optional `trace`), `inbox` (`list`, `get`, `answer`, `decline`, `cancel`, optional `prompt`) and `subscribe(signal?)`, which resolves to an async iterable of `run:state`, `inbox:added` and `inbox:settled` events with a `close()` method.

`inbox.prompt` opens a dialog for a pending item and resolves with the action taken (`accept`, `decline` or `cancel`). Adapters that cannot prompt leave it out.

Failures are `FlowControlError`, carrying a `code` (`FLOW_UNAVAILABLE`, `FLOW_INVALID`, `FLOW_NOT_FOUND`, `RUN_NOT_FOUND`, `INBOX_ITEM_NOT_FOUND`, `INBOX_ANSWER_INVALID`, `PROMPT_UNSUPPORTED`, `PROMPT_IN_PROGRESS`, `INTERNAL_ERROR`, `DISCONNECTED`) and optional `data`. Use `isFlowControlError(error, code?)` to narrow.

## Adapters

### Remote

`createRemoteFlowControl(client)` adapts an Enkaku `Client<Protocol>` connected to the flow daemon. Subscriptions end with `DISCONNECTED` when the connection is lost.

```ts
import { createRemoteFlowControl } from '@mokei/flow-client'

const control = createRemoteFlowControl(client)
const run = await control.runs.start({ flow: 'review', input: {} })
```

### In-process

`createLocalFlowControl` from `@mokei/flow-host` wraps a flow host directly, with the same interface and error codes.

## Helpers

- `runStatus(control, runID)` returns a `RunStatus`: the run state, its pending input and approval items (empty for terminal runs), and the result or error. It rereads at most three times if the state changes while it reads.
- `isTerminalRun(run)` is true when a run snapshot or status is in a terminal state.
- `isActionable(status)` is true when the run is terminal or has a pending item.
- `hasChanged(previous)` returns a predicate true when a status differs from `previous`.
- `waitForRun(control, runID, { until, timeoutMs, signal })` resolves with `{ status, timedOut }`. It subscribes first, rereads on each event for the run, and retries a lost connection with backoff (250 ms doubling to 2 s) within the timeout. On timeout it returns the latest status with `timedOut: true`. If the timeout passes before any read succeeded, it rejects with the last retryable error (`DISCONNECTED`, or `FLOW_UNAVAILABLE` while the service starts). If no error occurred, it reads once more, bounded only by `signal`, and returns that status with `timedOut: true` or rejects with the read's own error (such as `RUN_NOT_FOUND`).

## MCP server

`createFlowControlServer(control, { name?, version? })` returns a `ServerConfig` for `@mokei/context-server`, serving protocol revisions `2026-07-28` and `2025-11-25`. The default name is `mokei-flows`.

```ts
import { ContextServer } from '@mokei/context-server'
import { createFlowControlServer } from '@mokei/flow-client'

const server = new ContextServer({ ...createFlowControlServer(control), transport })
```

Tools never throw: failures are `isError` results that name the error code. Status-returning tools return a `RunStatus`, as text and as structured content.

| Tool | Params | Behaviour |
|------|--------|-----------|
| `list_flows` | none | Registered flows. |
| `check_flow` | `{ definition }` | Validates a definition. Text is the formatted result. |
| `start_flow` | `{ flow }` or `{ definition }`, `input?`, `label?` | Starts a run and returns its status at once. Supply exactly one of `flow` or `definition`. `input` defaults to `{}`. |
| `flow_status` | `{ runID }` | Run status with pending items. |
| `wait_flow` | `{ runID, timeoutMs? }` | Blocks until the run is terminal or has a pending item. Default 60 000 ms, maximum 300 000 ms. Returns the status and `timedOut`. |
| `list_runs` | `{ states?, limit? }` | Recent runs without `pending`. Default limit 20. |
| `cancel_flow` | `{ runID }` | Cancels the run and returns its status. |
| `answer_input` | `{ id, value }` | Answers an input item. Approval items are refused: use `prompt_input`. |
| `decline_input` | `{ id, reason? }` | Declines an input item. Approval items are refused: use `prompt_input`. |
| `prompt_input` | `{ id }` | Registered only when `control.inbox.prompt` exists. Opens the dialog and blocks until it settles. Returns `{ id, action }`. |

Cancelling a `wait_flow` or `prompt_input` call aborts it through the request signal. A cancelled prompt leaves the item pending.
