# Flow CLI and MCP design

**Milestone:** [flow daemon](../../agents/plans/milestones/2026-10-01-flow-daemon-milestone.md), sub-project 4
**Folds in:** [published declaration dependencies](../../agents/plans/next/2026-10-02-published-declaration-dependencies.md)
**Branch:** `feat/flow-cli`

## Goal

Make the shared daemon's flow service usable day to day and retire the flow rig:

- `mokei daemon`, `flows`, `runs` and `inbox` commands.
- A generic MCP server for flow runs, served by `mokei flows mcp`, replacing `scripts/flow-rig/serve.mjs` for Claude
  Code.
- Delete `scripts/flow-rig` and its suite.
- Correct the published dependency declarations and add a repeatable packed-consumer check.

Exit criteria: the end-to-end suite drives the real `mokei` binary and passes; manual macOS QA is done.

## Decisions

- **Agents cannot approve runs.** Over MCP, approval items are visible and can only be routed to a human through
  `prompt_input` (desktop dialog). Runs matching the `flows.json` approval globs still start at once.
- **Plain tools, not MCP tasks.** Claude Code does not support the tasks extension, and task elicitation would bypass
  the daemon inbox. A task-capable `start_flow` is deferred to the backlog.
- **The MCP server is generic.** It targets a `FlowControl` interface and works against the daemon or an in-process
  `FlowHost`. The CLI only wires it.
- **New package `@mokei/flow-client`** (approved). The client logic has three consumers: CLI commands, `mokei flows
  mcp`, and the monitor (sub-project 5). This replaces the milestone's placement of the MCP facade in
  `@mokei/flow-host-node`.
- **`@mokei/decision-flow-server` is unchanged.** It is the in-session task server the flow host drives; the new
  server sits above the run lifecycle.
- **CLI output** is human-readable by default with `--json` on every command.
- **`runs start` returns at once**; `--wait` follows the run and answers inputs and approvals in the terminal.
- **Terminal UI reuses existing primitives**: `@tejika/cli` (`runInk`, `renderStatic`, `withSocketPath`),
  `@tejika/ui` (`ConfirmCard`, `SelectCard`, `Spinner`, `StatusLine`) and `@inkjs/ui` (`TextInput`). No new
  prompt primitives.
- **Dropped rig features**: the fake predictor and automatic approval or input dialogs (`confirm`, `input: dialog`).
  Tests avoid System One by using flows without `decide` nodes.

## Architecture

```
@mokei/flow-client (portable)
  FlowControl interface, createRemoteFlowControl(client), waitForRun, runStatus,
  createFlowControlServer(control) -- MCP ServerConfig with the flow tools
@mokei/flow-host
  createLocalFlowControl(host, extras?) -- in-process FlowControl
@mokei/cli
  daemon, flows, runs, inbox commands; `flows mcp` serves createFlowControlServer over stdio
```

`@mokei/flow-host-node` and `@mokei/host-node` are unchanged: they are daemon-side and already expose every
procedure needed.

### `@mokei/flow-client`

Portable, no Node APIs. Dependencies: `@mokei/host-protocol`, `@mokei/context-server`, `@mokei/context-protocol`,
needed `@sozai/*` packages, and `@enkaku/client` for the `Client` type. It never imports `@mokei/flow-host`, so the
`flow-host` to `flow-client` dependency stays one-way.

**Types.** `flow-client` owns its public types and derives them from the host-protocol wire schemas:
`FlowRunSnapshot`, `RunState`, `InboxItem`, `InboxOutcome`, `FlowSummary`, `FlowCheckResult`, `RunTrace`
(`{ spans, logs }`), `StartRunParams` (the `runs.start` param), `RunListFilter` (the `runs.list` param) and
`PromptAction` (`'accept' | 'decline' | 'cancel'`). Wire fields that are generic objects (result `content`, an
input item's `requestedSchema`, `output`) stay generic in these types; consumers that need narrower shapes validate
them where they use them (the terminal prompts, section [Terminal prompts](#terminal-prompts)). `FlowHost` values
are structurally assignable to these types except check results, which the local adapter projects; its tests
check both.

```ts
type FlowEvent =
  | { type: 'run:state'; data: FlowRunSnapshot }
  | { type: 'inbox:added'; data: InboxItem }
  | { type: 'inbox:settled'; data: { item: InboxItem; outcome: InboxOutcome } }

type FlowSubscription = AsyncIterable<FlowEvent> & { close(): void }

type FlowControl = {
  flows: {
    list(): Promise<Array<FlowSummary>>
    check(definition: unknown): Promise<FlowCheckResult>
  }
  runs: {
    start(params: StartRunParams): Promise<FlowRunSnapshot>
    get(runID: string): Promise<FlowRunSnapshot>
    list(filter?: RunListFilter): Promise<Array<FlowRunSnapshot>>
    cancel(runID: string): Promise<FlowRunSnapshot>
    trace?(runID: string): Promise<RunTrace>
  }
  inbox: {
    list(filter?: { runID?: string }): Promise<Array<InboxItem>>
    get(id: string): Promise<InboxItem>
    answer(id: string, content?: Record<string, unknown>): Promise<void>
    decline(id: string, reason?: string): Promise<void>
    cancel(id: string): Promise<void>
    prompt?(id: string, signal?: AbortSignal): Promise<PromptAction>
  }
  subscribe(signal?: AbortSignal): Promise<FlowSubscription>
}
```

**Errors.** One class, `FlowControlError`, with `code`, `message` and optional `data` (for example `issues`). Codes
match the daemon's handler codes: `FLOW_UNAVAILABLE`, `FLOW_INVALID`, `FLOW_NOT_FOUND`, `RUN_NOT_FOUND`,
`INBOX_ITEM_NOT_FOUND`, `INBOX_ANSWER_INVALID`, `PROMPT_UNSUPPORTED`, `PROMPT_IN_PROGRESS`, `INTERNAL_ERROR`, plus
`DISCONNECTED` for a lost daemon connection. Every adapter method throws only `FlowControlError` (or the abort
reason when its signal aborts). `get` methods throw `RUN_NOT_FOUND` / `INBOX_ITEM_NOT_FOUND` instead of returning
`undefined`.

**Subscriptions.** `subscribe` resolves only once the subscription is live: events emitted after it resolves are
delivered. Events arriving before the caller iterates are buffered. Events are never replayed, so callers subscribe
first and then read snapshots (subscribe-then-query). A lost connection ends iteration with
`FlowControlError('DISCONNECTED')`.

**`createRemoteFlowControl(client: Client<Protocol>)`**:

- Maps procedures one to one and maps `HandlerError` codes and data to `FlowControlError`.
- `subscribe` opens the `events` stream, starts buffering at once, then completes an `info` request as a barrier: the
  daemon serves requests in order on one connection, so the stream's listener is registered when `info` returns.
  It filters to `run:state`, `inbox:added` and `inbox:settled`.
- When Enkaku replaces the transport (daemon restart), in-flight procedures abort and every open subscription ends
  with `DISCONNECTED`. The adapter does not resubscribe on its own; `waitForRun` does.
- Always provides `trace` and `prompt`.

**`createLocalFlowControl`** lives in `@mokei/flow-host` (below).

**Helpers:**

- `runStatus(control, runID)` reads the snapshot and the run's inbox items, and returns
  `{ runID, state, pending, result?, error? }`. `pending` is empty for terminal runs. If the snapshot's state
  changed between the two reads (a second `get` differs), it reads again, at most three times.
- `waitForRun(control, runID, { until, signal, timeoutMs })` returns `{ status, timedOut }`, where `until` is a
  predicate over `RunStatus`:
  1. Subscribe (awaiting readiness), then read `runStatus`. Return if `until` matches.
  2. On each event for the run (`run:state` with that run, or `inbox:*` with that `runID`), reread `runStatus` and
     test `until`.
  3. On `DISCONNECTED`, resubscribe with backoff (250 ms doubling to 2 s) until the timeout, then go back to step 1.
     After a restart the `info` barrier succeeds while the flow service is still recovering, so a read failing with
     `FLOW_UNAVAILABLE` whose `data.status.state` is `starting` is retried with the same backoff. A `failed` service
     rejects. This lets a wait survive a daemon restart, since runs are durable.
  4. On timeout, close the subscription and return the latest status with `timedOut: true`. On abort, close and
     reject with the signal's reason.
- `hasChanged(previous)`: a predicate true when the status differs from `previous` (state, pending item ids, result
  or error). Watch-only loops use it so they block until something changes instead of returning at once on an
  unanswered item.
- `isActionable(status)`: true when the run is terminal or has at least one pending item. An `input_required` or
  `awaiting_approval` run with no pending items (an answer settled, the watcher has not advanced the state yet) is
  not actionable.
- `TERMINAL_RUN_STATES`: `denied`, `completed`, `failed`, `cancelled`.

### `createLocalFlowControl` in `@mokei/flow-host`

`createLocalFlowControl(host: FlowHost, extras?: { trace?, prompt? })`:

- Adapts the synchronous inbox methods to promises.
- Converts `undefined` from `get` to the not-found codes.
- `flows.check` projects the result like the daemon handler does: copies `issues` into a mutable array and returns
  only `{ value, warnings, formatted }` or `{ issues, warnings, formatted }`. Other methods return host values
  directly where they are structurally assignable to the wire types.
- Normalizes every error the host throws to `FlowControlError`, using the same code mapping as
  `flow-host-node`'s `toHandlerError` (`FlowCheckError` to `FLOW_INVALID`, `FlowNotFoundError` to
  `FLOW_NOT_FOUND`, `RunNotFoundError` to `RUN_NOT_FOUND`, `InboxItemNotFoundError` (including the inbox's own
  unknown-id throws) to `INBOX_ITEM_NOT_FOUND`, `InboxAnswerInvalidError` to `INBOX_ANSWER_INVALID`, others to
  `INTERNAL_ERROR`).
- `subscribe` registers listeners on `host.events` synchronously, so it is live as soon as it resolves.

`flow-host` gains a dependency on `@mokei/flow-client` for the interface, types and error class.

## MCP server

`createFlowControlServer(control, options?: { name?, version? })` returns a `ServerConfig` (from
`@mokei/context-server`) with the tools below and `protocolVersions: ['2026-07-28', '2025-11-25']`. The caller adds
a transport: `serveProcess(config)` for stdio, or `new ContextServer({ ...config, transport })`. Every
status-returning tool uses one shape:

```ts
type RunStatus = {
  runID: string
  state: RunState
  pending: Array<
    | { id: string; kind: 'input'; message: string; requestedSchema: Record<string, unknown>; canPrompt: boolean }
    | { id: string; kind: 'approval'; plan: { tools: Array<string> }; canPrompt: boolean }
  >
  result?: FlowRunSnapshot['result']
  error?: FlowRunSnapshot['error']
}
```

`canPrompt` is `true` when `control.inbox.prompt` exists.

| Tool | Params | Behaviour |
|------|--------|-----------|
| `list_flows` | none | Registered flows. |
| `check_flow` | `{ definition }` | `FlowCheckResult`; text content is `formatted`. |
| `start_flow` | `{ flow }` or `{ definition }`, `input?`, `label?` | Starts the run; returns `RunStatus` at once. Exactly one of `flow` or `definition`; missing `input` defaults to `{}`. |
| `flow_status` | `{ runID }` | `RunStatus`. |
| `wait_flow` | `{ runID, timeoutMs? }` | `waitForRun` with `isActionable`: blocks until the run is terminal or has a pending item; returns at once if it already is. Default 60 000 ms, maximum 300 000 ms. Returns `RunStatus & { timedOut: boolean }`. |
| `list_runs` | `{ states?, limit? }` | Recent runs as `RunStatus` without `pending`. Default limit 20. |
| `cancel_flow` | `{ runID }` | `RunStatus`. |
| `answer_input` | `{ id, value }` | Input items only. An approval item returns an error: approvals need a human, use `prompt_input`. |
| `decline_input` | `{ id, reason? }` | Input items only; same error for approval items. |
| `prompt_input` | `{ id }` | Registered only when `control.inbox.prompt` exists. Opens the dialog for an input or approval item and blocks until it settles; returns `{ id, action }`. |

`prompt_input` outcomes follow the daemon's controller:

- Accept or decline in the dialog settles the item; the result reports the action.
- Cancel in the dialog settles the item as cancelled.
- Cancelling the tool call (request signal) closes the dialog and leaves the item pending.
- Settling the item elsewhere while the dialog is open closes it; the call fails with `INBOX_ITEM_NOT_FOUND` (the
  controller aborts the prompt with that error), returned as an error saying the item was settled elsewhere.
- `PROMPT_UNSUPPORTED` (schema the desktop cannot render) and `PROMPT_IN_PROGRESS` (another caller owns the dialog)
  return errors that name the item, which stays pending.

Errors are `isError` tool results with the `FlowControlError` message (and `code`). The server never throws from a
tool handler. Tool cancellation aborts `wait_flow` and `prompt_input` through the request signal.

## CLI

Every command takes `-s, --socket-path` (via `withSocketPath`). Errors print `✘ msg` and exit 1.

**Connection ownership.** `src/flow-control.ts` exports `connectFlowControl({ socketPath, autoStart })`, returning
`{ control, client, dispose }`. Each command disposes it in `finally`. SIGINT and SIGTERM abort the command's
signal, which closes subscriptions and prompts, then dispose runs. Every command except `daemon status`,
`daemon stop` and `daemon logs` auto-starts the daemon through `ensureMokeiDaemon`.

**JSON output.** One-shot commands (`flows list|check`, `runs start|get|list|cancel|trace`,
`inbox list|show|answer|decline|cancel|prompt`, `daemon start|stop|status|restart`) take `--json` and print one JSON
document. `runs start --wait --json` prints newline-delimited JSON: one `RunStatus` per change, the last one
terminal; it never prompts, as if stdin were not a TTY. `daemon logs` prints raw log lines and has no `--json`.
`flows mcp` writes only protocol messages to stdout; its diagnostics go to stderr.

### `mokei daemon`

**Identity.** The daemon is identified by its pid file, which records its socket path. The CLI resolves the pid
path from `@tejika/env` for app `mokei` (`mokei.pid` in the state dir, overridable with `MOKEI_STATE_DIR`). `status`
and `stop` read it with `getDaemonStatus`/`stopDaemon` and compare the recorded socket path with the selected
`--socket-path`. If they differ, `status` reports `not-running` for the selected socket and names the other one, and
`stop` refuses with an error naming both paths.

The comparison happens before `stopDaemon` takes its lock, so a daemon replaced in between could still be signalled.
The window is small for a per-user daemon and is accepted for this sub-project. An `expectedSocketPath` option
checked inside `stopDaemon`'s critical section is requested upstream from `@tejika/process`; adopt it when
released.

- `start`: ensure running, wait until `info.flowService` leaves `starting`, print pid, socket path and flow service
  state. A `failed` service prints the error and issues and exits 1.
- `stop`: `stopDaemon` with `waitForExit: true` and `killTimeoutMs: 75_000`, longer than the daemon's 60 s
  shutdown budget, so in-flight work drains and durable runs suspend before any SIGKILL. Reports only that the
  daemon stopped: `stopDaemon` does not say whether it escalated to SIGKILL. A result field for that is requested
  upstream from `@tejika/process`.
- `status`: `not-running`, `stale`, `booting` or `running`; when running, adds uptime, active contexts and flow
  service state. Never auto-starts.
- `restart`: `stop`, confirm exit, then `start`. Applies `flows.json` changes.
- `logs [-n <lines>] [-f]`: tail `daemon.log` (default 50 lines); `-f` follows until interrupted.

### `mokei flows`

- `list`: id, version and name per flow.
- `check <file>`: prints `formatted`; exits 1 when there are issues.
- `mcp`: `serveProcess(createFlowControlServer(remote))` from `@mokei/context-server-node` (new CLI dependency). It
  disposes the connection when stdin closes.

### `mokei runs`

- `start <flow> | --file <definition.json>`, `--input <json|@file>`, `--label <text>`, `--wait`: without `--wait`
  prints run id and state. With `--wait`, runs `waitForRun` with `isActionable` in a loop: shows state changes
  (`Spinner`, `StatusLine`), answers each pending item in the terminal, prints the result, and exits 0 on
  `completed`, 1 otherwise. When it does not answer (no TTY, or `--json`), it waits with `hasChanged` and prints
  each changed status once. It survives a daemon restart through `waitForRun`'s resubscription.
- `get <runID>`: status, pending items, result or error.
- `list [--state <state>...] [--limit <n>]`: table of id, flow, label, state, updated.
- `cancel <runID>`.
- `trace <runID>`: span tree indented by parent with durations, then the run's logs.

### `mokei inbox`

- `list [--run <runID>]`: table of id, run, kind, summary.
- `show <id>`: input message and schema, or the approval's planned tools.
- `answer <id> [--value <json|@file>] [--yes]`: without `--value`, prompts from the schema. For an approval item,
  `answer` approves after a `ConfirmCard`, skipped with `--yes`; `--value` is rejected for approvals.
- `decline <id> [--reason <text>]`: for an approval item this denies the run.
- `cancel <id>`.
- `prompt <id>`: opens the desktop dialog through the daemon; reports the action, or the `PROMPT_*` error.

### Terminal prompts

An input item's `requestedSchema` is the MCP elicitation form: `{ type: 'object', properties, required? }` whose
properties are primitives. One CLI module validates that shape and runs an Ink form with `runInk`, one property at a
time in declaration order:

- `boolean`: `ConfirmCard`.
- `string` with `enum` or `oneOf`: `SelectCard` (labels from `enumNames` or `oneOf[].title` when present).
- `string`, `number`, `integer`: `@inkjs/ui` `TextInput`. Numbers are parsed and checked against `minimum`/`maximum`;
  strings against `minLength`/`maxLength`. Invalid input shows the error and asks again.
- `default` values prefill the field. An optional field can be skipped with an empty entry and is then omitted.
- The answers form one object, sent with `inbox.answer`. An `INBOX_ANSWER_INVALID` reply shows the issues and asks
  again.
- Esc cancels the form without settling the item. A schema that is not this form, or has a non-primitive property,
  fails with an error suggesting `--value`.

Approvals list the planned tools, reusing chat's `ToolApprovalCard` if it fits, then a `ConfirmCard`. Without a TTY,
`--wait` only watches (it lists pending items and keeps waiting) and `inbox answer` without `--value` fails.
One-off output (tables, status, trace) uses `renderStatic`.

## Dependency declarations

All the imports are type-only but reach emitted public declarations, so each package moves to `dependencies`:

| Package | Change |
|---------|--------|
| `@mokei/context-server` | `@enkaku/transport` to `dependencies` |
| `@mokei/context-client` | `@enkaku/transport` to `dependencies` |
| `@mokei/context-rpc` | `@enkaku/transport`, `@sozai/schema` to `dependencies` |
| `@mokei/context-protocol` | add a `dependencies` block with `@sozai/schema` |
| `@mokei/model-provider` | `@mokei/context-protocol` to `dependencies` |

`integration-tests/dts-consumer/index.ts` gains `@mokei/flow-host`, `@mokei/flow-host-node` and
`@mokei/flow-client`.

**Packed-consumer check.** `scripts/check-packed-consumer.mjs`, run by a root `test:packed` script, manually and in
CI after build:

1. `pnpm pack` every public package into a temporary directory outside the workspace (`os.tmpdir()`), so no
   workspace `node_modules` or `pnpm-workspace.yaml` is reachable.
2. Write a consumer `package.json` depending on `@mokei/flow-host-node`, `@mokei/flow-client` and `mokei` (tarball
   paths), with dev dependencies pinned to the workspace catalog versions of `typescript` and `@types/node` (from
   the registry). The workspace pins pnpm 12, which ignores `package.json#pnpm` and non-registry `.npmrc` settings,
   so the consumer writes its own `pnpm-workspace.yaml` with `overrides` (every packed package name to its tarball),
   `nodeLinker: isolated`, `hoist: false`, `publicHoistPattern: []` and `linkWorkspacePackages: false`. Install.
3. Fail if the lockfile contains a `link:` or `workspace:` reference, or any `@mokei/*`/`mokei` resolution that is
   not a tarball.
4. Type-check `index.ts` importing the public entries of `@mokei/flow-host-node` and `@mokei/flow-client` with the
   consumer's own `tsc` (`skipLibCheck: false`, `types: ['node']`, `module`/`moduleResolution: NodeNext`), with no
   error filtering.
5. Run the installed `mokei --help` (the CLI has no type exports) to check its runtime dependency graph.

The check must fail before the declaration fix and pass after it.

## Rig removal

- Delete `scripts/flow-rig/`, `integration-tests/suites/flow-rig.test.ts` and `integration-tests/support/flow-rig/`.
- Remove the root `test:flow-rig` script and its use in `test`.
- `.mcp.json`: replace `flow-rig` with `flow`, running `node packages/cli/bin/run.js flows mcp`.
- Update `docs/agents/architecture.md` (rig row, package table, layering) and the rig references in
  `docs/agents/plans/roadmap.md`.
- `scripts/fix-node-pty-permissions.mjs` stays: it is the root `postinstall`, unrelated to the rig.

## Testing

- **`flow-client` unit**:
  - Remote adapter against a stub `Client<Protocol>`: every handler code mapped to `FlowControlError`;
    `subscribe` resolving only after the `info` barrier; `DISCONNECTED` on transport replacement.
  - `waitForRun`: already-matching run, timeout, abort, an event landing between subscribe and the snapshot read,
    resubscription after `DISCONNECTED`, and `isActionable` skipping an `input_required` run with no pending item.
  - `runStatus` rereading when the state changes between reads.
  - Every MCP tool against an in-memory `FlowControl`: approval refusal for `answer_input`/`decline_input`,
    `prompt_input` registered only when `prompt` exists, and each `prompt_input` outcome.
- **`flow-host` unit**: `createLocalFlowControl` against a real `FlowHost` with memory stores, including error
  normalization for unknown runs and inbox ids and wire-type assignability.
- **CLI unit**: formatters, the requested-schema form (property order, required and optional fields, defaults,
  numeric validation and retry, Esc cancel, unsupported schemas) with `ink-testing-library`, `--json` output,
  socket/pid identity mismatch in `daemon status|stop`, and command registration in `program.test.ts`.
- **Fixture changes** (`integration-tests/support/flow-daemon`):
  - The stub desktop entry accepts an arbitrary `{ action, content }` per prompt over IPC (not only
    `{ value }`) and records each request's schema, so tests can accept, decline and cancel input and approval
    dialogs (approvals answer `{ approve: true }`).
  - Its pid file becomes `mokei.pid` under `MOKEI_STATE_DIR`, matching the CLI's resolution, so `daemon status`
    works against the fixture.
- **End-to-end** (`integration-tests/suites/flow-cli.test.ts`): the binary (`packages/cli/bin/dev.js`) connects
  with `-s <fixture socket>` and the fixture's `MOKEI_*_DIR`, so it never spawns the native daemon. Scenarios:
  - CLI: `flows list`; `runs start` with an inline definition; `runs start --wait --json` on a flow without
    inputs; `inbox answer --value`; approval via `inbox answer --yes`; `inbox decline` on an approval (run
    `denied`); `runs cancel`; `runs trace`; `daemon status`.
  - `runs start --wait --json` across a fixture `restart`, finishing after recovery.
  - `flows mcp` driven by an MCP client over stdio: `start_flow`, `wait_flow` (actionable and timeout),
    `answer_input`, approval refusal, `prompt_input` accepting an approval and an input, dialog cancel settling the
    item, tool-call cancellation leaving the item pending, and a late answer after settlement rejected.
  - `daemon start/stop/restart` against the production entry with isolated `MOKEI_*_DIR`, notifications off, as
    in `cli-proxy.test.ts`; `stop` reports the daemon stopped and the run store shows suspended runs intact.
  - `cli-help.test.ts` lists the new commands.
- **Packed consumer**: `pnpm test:packed`.
- **Manual macOS QA**: `daemon start`, `flows mcp` from Claude Code, `inbox prompt` with native dialogs and
  notifications. This covers the [native desktop QA](../../agents/plans/next/2026-10-02-flow-daemon-native-desktop-qa.md)
  checklist and closes it.

## Docs

- READMEs for `@mokei/flow-client` and the CLI (also fixing the stale `-s, --path` and socket path).
- `docs/agents/architecture.md`: new package, layering, task table.
- Milestone: MCP server placement, folded dependency work, sub-project 4 status.
- Changeset: patch, all published packages (lockstep).
- Backlog: task-capable `start_flow` once Claude Code supports MCP tasks.

## Out of scope

- Monitor pages (sub-project 5).
- Triggers and schedules.
- A trace MCP tool.
- Config editing commands; `flows.json` is edited by hand and applied with `daemon restart`.
