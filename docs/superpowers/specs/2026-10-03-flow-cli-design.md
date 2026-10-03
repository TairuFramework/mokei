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
  createFlowControlServer(control) -- the MCP tools
@mokei/flow-host
  createLocalFlowControl(host, extras?) -- in-process FlowControl
@mokei/cli
  daemon, flows, runs, inbox commands; `flows mcp` serves createFlowControlServer over stdio
```

`@mokei/flow-host-node` and `@mokei/host-node` are unchanged: they are daemon-side and already expose every
procedure needed.

### `@mokei/flow-client`

Portable, no Node APIs. Dependencies: `@mokei/host-protocol`, `@mokei/context-server`, `@mokei/context-protocol`,
needed `@sozai/*` packages, and `@enkaku/client` for the `Client` type. Types are the host-protocol wire types
(`FlowRunSnapshot`, `InboxItem`, `FlowSummary`, `FlowCheckResult`, `StoredSpan`, `StoredLog`).

```ts
type FlowEvent =
  | { type: 'run:state'; data: FlowRunSnapshot }
  | { type: 'inbox:added'; data: InboxItem }
  | { type: 'inbox:settled'; data: { item: InboxItem; outcome: InboxOutcome } }

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
  subscribe(signal: AbortSignal): AsyncIterable<FlowEvent>
}
```

- `get` methods throw `RunNotFoundError` / `InboxItemNotFoundError` (exported by `flow-client`) instead of
  returning `undefined`.
- `createRemoteFlowControl(client: Client<Protocol>)` maps procedures one to one, opens the `events` stream for
  `subscribe` and filters to flow events, and maps handler errors to typed errors: not found, `FLOW_UNAVAILABLE`
  to `FlowUnavailableError`, others to `FlowControlError` with code and message. It always provides `trace` and
  `prompt`.
- `waitForRun(control, runID, { until, signal, timeoutMs })` subscribes before reading the snapshot, then returns
  on the first snapshot whose state is in `until`. Returns `{ snapshot, timedOut }`. An abort rejects with the
  signal's reason.
- `runStatus(control, runID)` returns `{ runID, state, pending, result?, error? }`; `pending` lists the run's inbox
  items and is empty for terminal runs.
- Terminal states are exported as `TERMINAL_RUN_STATES` (`denied`, `completed`, `failed`, `cancelled`).

### `createLocalFlowControl` in `@mokei/flow-host`

`createLocalFlowControl(host: FlowHost, extras?: { trace?, prompt? })` adapts the synchronous inbox methods,
converts `undefined` from `get` to the not-found errors, and turns `host.events` into `subscribe`. `flow-host`
gains a dependency on `@mokei/flow-client` for the interface and errors.

## MCP server

`createFlowControlServer(control, options?: { name?, version? })` returns a `ContextServer`. Every status-returning
tool uses one shape:

```ts
type RunStatus = {
  runID: string
  state: RunState
  pending: Array<
    | { id: string; kind: 'input'; message: string; requestedSchema: RequestedSchema; canPrompt: boolean }
    | { id: string; kind: 'approval'; plan: { tools: Array<string> }; canPrompt: boolean }
  >
  result?: { outcome?: string; output?: unknown; content: Array<ContentBlock> }
  error?: { type: string; message: string; code?: string }
}
```

`canPrompt` is `true` when `control.inbox.prompt` exists.

| Tool | Params | Behaviour |
|------|--------|-----------|
| `list_flows` | none | Registered flows. |
| `check_flow` | `{ definition }` | `FlowCheckResult`; text content is `formatted`. |
| `start_flow` | `{ flow }` or `{ definition }`, `input?`, `label?` | Starts the run; returns `RunStatus` at once. Exactly one of `flow` or `definition`; missing `input` defaults to `{}`. |
| `flow_status` | `{ runID }` | `RunStatus`. |
| `wait_flow` | `{ runID, timeoutMs? }` | Blocks until the run is `awaiting_approval`, `input_required` or terminal; returns at once if already there. Default 60 000 ms, maximum 300 000 ms. Returns `RunStatus & { timedOut: boolean }`. |
| `list_runs` | `{ states?, limit? }` | Recent runs as `RunStatus` without `pending`. Default limit 20. |
| `cancel_flow` | `{ runID }` | `RunStatus`. |
| `answer_input` | `{ id, value }` | Input items only. An approval item returns an error: approvals need a human, use `prompt_input`. |
| `decline_input` | `{ id, reason? }` | Input items only; same error for approval items. |
| `prompt_input` | `{ id }` | Registered only when `control.inbox.prompt` exists. Opens the dialog for an input or approval item and blocks until it settles; returns `{ id, action }`. Cancelling the call closes the dialog and leaves the item pending. |

Errors are `isError` tool results with a plain message. The server never throws from a tool handler. Tool
cancellation aborts `wait_flow` and `prompt_input` through the request signal.

## CLI

Every command takes `-s, --socket-path` (via `withSocketPath`) and `--json`. Every command except `daemon status` and
`daemon stop` auto-starts the daemon through `ensureMokeiDaemon`. Errors print `✘ msg` and exit 1. The CLI builds
one `FlowControl` per command with `createRemoteFlowControl` (`src/flow-control.ts`).

### `mokei daemon`

Uses `@tejika/process` (`getDaemonStatus`, `stopDaemon`) and the existing `ensureMokeiDaemon`.

- `start`: ensure running, wait until `info.flowService` leaves `starting`, print pid, socket path and flow service
  state. A `failed` service prints the error and issues and exits 1.
- `stop`: graceful stop; in-flight work drains and durable runs suspend.
- `status`: `not-running`, `stale`, `booting` or `running`; when running, adds uptime, active contexts and flow
  service state. Never auto-starts.
- `restart`: stop then start; applies `flows.json` changes.
- `logs [-n <lines>] [-f]`: tail `daemon.log` (default 50 lines); `-f` follows.

### `mokei flows`

- `list`: id, version and name per flow.
- `check <file>`: prints `formatted`; exits 1 when there are issues.
- `mcp`: serves `createFlowControlServer(remote)` over stdio with `serveProcess` from
  `@mokei/context-server-node` (new CLI dependency), protocol versions `2026-07-28` and `2025-11-25`.

### `mokei runs`

- `start <flow> | --file <definition.json>`, `--input <json|@file>`, `--label <text>`, `--wait`: without `--wait`
  prints run id and state. With `--wait`, shows state changes (`Spinner`, `StatusLine`), answers pending inputs and
  approvals in the terminal, prints the result, and exits 0 on `completed`, 1 otherwise.
- `get <runID>`: status, pending items, result or error.
- `list [--state <state>...] [--limit <n>]`: table of id, flow, label, state, updated.
- `cancel <runID>`.
- `trace <runID>`: span tree indented by parent with durations, then the run's logs.

### `mokei inbox`

- `list [--run <runID>]`: table of id, run, kind, summary.
- `show <id>`: input message and schema, or the approval's planned tools.
- `answer <id> [--value <json|@file>] [--yes]`: without `--value`, prompts from the schema. For an approval item,
  `answer` approves after a `ConfirmCard`, skipped with `--yes`.
- `decline <id> [--reason <text>]`: for an approval item this denies the run.
- `cancel <id>`.
- `prompt <id>`: opens the desktop dialog through the daemon.

### Terminal prompts

One CLI module maps a requested schema to an Ink form run with `runInk`:

- `boolean`: `ConfirmCard`.
- `enum` (string with `enum` or `oneOf`): `SelectCard`.
- `string`, `number`, `integer`: `@inkjs/ui` `TextInput`, with numeric parsing and validation for number fields.
- Any other schema: error suggesting `--value`.

Approvals list the planned tools, reusing chat's `ToolApprovalCard` if it fits, then a `ConfirmCard`.
Without a TTY, `--wait` only watches (it lists pending items and keeps waiting) and `inbox answer` without
`--value` fails. One-off output (tables, status, trace) uses `renderStatic`.

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

1. `pnpm pack` every public package into a temporary directory.
2. Create a consumer with `node-linker=isolated`, no hoisting, and overrides pointing every `@mokei/*` and `mokei`
   dependency at its tarball; install.
3. Fail if the lockfile contains a workspace link.
4. Type-check a file importing `@mokei/flow-host-node` and `@mokei/flow-client` with `tsc`,
   `skipLibCheck: false`, without filtering `node_modules` errors.
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

- **`flow-client` unit**: the remote adapter against a stub `Client<Protocol>`, including error mapping;
  `waitForRun` with an already-matching run, a timeout, an abort, and an event landing between subscribe and the
  snapshot read; every MCP tool against an in-memory `FlowControl`, including the approval refusal and
  `prompt_input` registration only when `prompt` exists.
- **`flow-host` unit**: `createLocalFlowControl` against a real `FlowHost` with memory stores.
- **CLI unit**: formatters, schema-to-prompt mapping, and prompt components with `ink-testing-library`; command
  registration in `program.test.ts`.
- **End-to-end** (`integration-tests/suites/flow-cli.test.ts`): reuses `startFlowDaemonFixture` (stub desktop entry);
  the binary connects with `-s <fixture socket>`, so it never spawns the native daemon. Scenarios: `flows list`,
  `runs start` with an inline definition, `runs start --wait` on a flow without inputs, `inbox answer --value`,
  approval via `inbox answer --yes`, `runs cancel`, `runs trace`, `daemon status`; `flows mcp` driven by an MCP
  client over stdio (`start_flow`, `wait_flow`, `answer_input`, approval refusal, `prompt_input` through the stub
  desktop). `daemon start/stop/restart` run against the production entry with isolated `MOKEI_*_DIR`, notifications
  off, as in `cli-proxy.test.ts`. `cli-help.test.ts` lists the new commands.
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
