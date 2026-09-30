# Flow rig — design

**Date:** 2026-09-30
**Branch:** `feat/flow-rig`
**Milestone:** phase 1 of 3 of `docs/agents/plans/milestones/2026-09-30-flow-rig-milestone.md`. Phase 2 turns the
rig into an integration/e2e harness; phase 3 uses the rig's findings to drive session, host and CLI features.

## Goal

Run decision flows locally, with the flow driven from Claude Code through MCP. The flows use System One,
sibling MCP servers, and desktop notifications and dialogs. The rig exercises the real `NodeSession`,
`addDecisionFlow` and `@mokei/host-desktop` path end to end, and records the gaps it hits.

## Constraints

- A plain Node ESM script under `scripts/flow-rig/`, with no build step and no new package. It imports the built
  `lib/` of workspace packages, so `pnpm build` must run first.
- No changes to published packages in this phase. Gaps go to the milestone's Findings section instead.
- macOS only for manual QA. The rig must not fail to start on Linux, but Linux is not tested.

## Why a facade

Claude Code cannot call the decision-flow server directly:

- `run_flow` and the per-flow tools only run as tasks: after the definition check and the grant check, a call from a
  client that did not declare the tasks extension throws `Client did not declare the tasks extension`. Whether
  Claude Code declares it is outside this repo; the rig does not depend on it.
- A call with no grant returns `Flow denied`.
- The flow server's approval hook is synchronous and only consumes a single-use `dev.mokei/flow-grant` token. The
  grant is minted by `DecisionFlowWiring.wrapApproval`, which runs on the `AgentSession` side.

The rig is therefore a facade: it owns the session, approves runs, drives flow tasks, and exposes its own small MCP
server with blocking tools to Claude Code.

## Files

| Path | Purpose |
|------|---------|
| `scripts/flow-rig/serve.mjs` | Entry point: builds the session and serves the facade over stdio |
| `scripts/flow-rig/rig.config.json` | Siblings, allowlist, predictor, input mode, flows directory |
| `scripts/flow-rig/flows/*.json` | Registered flow definitions |
| `scripts/flow-rig/smoke.mjs` | Scripted smoke run against `serve.mjs` |
| `scripts/flow-rig/README.md` | Setup, config reference, manual QA checklist |
| `.mcp.json` | Adds `flow-rig`: `node scripts/flow-rig/serve.mjs` |
| `package.json` | Adds `./scripts` to the `lint` script |
| `docs/agents/plans/milestones/2026-09-30-flow-rig-milestone.md` | Findings section updated with gaps found while building and using the rig |

`serve.mjs` may be split into a few sibling modules (config, approval, runs, facade tools) if it grows past a
readable size.

## Config

`rig.config.json`, or the path in `FLOW_RIG_CONFIG`:

```json
{
  "siblings": {
    "system-one": { "command": "node", "args": ["mcp-servers/system-one/lib/serve.js"], "env": { "SYSTEM_ONE_URL": "http://localhost:8000" } },
    "sqlite": { "command": "node", "args": ["mcp-servers/sqlite/lib/serve.js"] }
  },
  "flowsDir": "flows",
  "allow": ["system-one:predict", "sqlite:sqlite_get"],
  "predictor": "real",
  "fakeAnswers": {},
  "input": "inbox",
  "confirm": "desktop"
}
```

- `siblings` uses the same shape as `mcp-servers/config.json`. Relative `args` resolve from the repo root;
  `flowsDir` resolves from the config file's directory.
- `allow` holds tool-id globs (`*` matches within one segment, so `sqlite:*` matches every sqlite tool).
- `predictor`: `real` uses the sibling `system-one:predict`. `fake` passes a scripted `Predictor` to
  `addDecisionFlow`. Its `predict` returns `{ model: 'fake', answers, usage: { inputTokens: 0, outputTokens: 0 } }`,
  where `answers[key]` is `fakeAnswers[key]` for each question key. Each `fakeAnswers` value is a complete typed
  answer for its question kind, exactly as System One would return it. A question key missing from `fakeAnswers`
  fails the prediction with `No fake answer for <key>`.
- `input`: `inbox` (default) or `dialog` (opt-in blocking dialogs).
- `confirm`: `desktop` (default) shows a desktop confirm dialog. `deny` and `approve` skip the dialog; they exist
  for the smoke run.

## Architecture

**Inner side.**

- **Session.** `NodeSession({ elicit: true })`, then `addContext` for each sibling. Elicitation stays enabled so
  flows with `input` nodes register, but the facade answers flow input requests itself (see Inputs).
- **Flows.** `addDecisionFlow(session, { key: 'flow', flows, predictor? })`, with the definitions from `flowsDir`
  and the in-memory task store.
- **Desktop.** One `createDesktopElicitHandler`, in `inbox` mode with a `createInputInbox()` inbox or in `dialog`
  mode. In inbox mode the facade registers itself as the inbox's answer surface.
- **Approval.** `flows.wrapApproval(strategy)`. The strategy approves when every tool in `request.flow.tools`
  matches an `allow` glob. Otherwise it follows `confirm`: a desktop confirm dialog lists the flow name and its
  complete tool plan, and cancel or timeout denies. A request with no `flow` (a check failure) is approved so the
  flow tool reports the issues itself.

**Outer side.** A `ContextServer` over stdio with these tools:

| Tool | Input | Result |
|------|-------|--------|
| `list_flows` | none | Passes through the flow server's `list_flows` |
| `check_flow` | `{ definition }` | Passes through the flow server's `check_flow` |
| `start_flow` | `{ flow?, definition?, input? }` | `{ runId }`, or an error result |
| `flow_status` | `{ runId }` | `{ state, pending, result?, error? }` |
| `cancel_flow` | `{ runId }` | `{ state }` after the cancel is sent |
| `prompt_input` | `{ id }` | Opens desktop dialogs for the inbox entry; returns the settled action |
| `answer_input` | `{ id, value }` | Answers the inbox entry |
| `decline_input` | `{ id }` | Declines the inbox entry |

`state` is one of `working`, `input_required`, `completed`, `failed`, `cancelled`, or `unknown` while polling fails
(with the last poll error in `error`). `pending` lists
`{ id, message, requestedSchema }` for the run's inbox entries (always empty in `dialog` mode). The `prompt_input`,
`answer_input` and `decline_input` tools are registered only in inbox mode.

## Data flow

**Startup.**

1. Read the config.
2. Spawn the siblings. A spawn failure is fatal, except for `system-one` when `predictor` is `fake`, which skips it.
3. Load every `flows/*.json` and register them through `addDecisionFlow`. An invalid flow is fatal, reported on
   stderr with the file name and the formatted issues.
4. Start the facade on stdio.

All logs go to stderr, since stdout carries MCP.

**`start_flow`.**

1. Resolve the definition: a registered `flow` id, or an inline `definition`. Exactly one is required, otherwise an
   error result.
2. Build the tool name and arguments once. A registered id uses the per-flow tool `flow_<id>` named as `flowToolName` does
   (`demo/triage` becomes `flow_demo_triage`), with `input` (default `{}`) as its arguments. An inline definition uses `run_flow` with arguments `{ definition, input }`.
3. Run the wrapped approval with a `ToolApprovalRequest`: `toolCall` `{ id: runId, name: 'flow:<tool>', arguments:
   JSON.stringify(args) }`, `iteration: 1`, `history: []`, and a signal that aborts on shutdown. Normalize the result:
   `true` or `{ approved: true, meta }` approves; `false` or `{ approved: false, reason }` returns
   `Flow denied: <reason>`.
4. Call the tool through `session.contextHost.getContext('flow').client` with `task: 'handle'`, the same `args`
   object, and the approval's `meta` as `_meta`. The grant is single use and bound to the tool name and a digest of
   the arguments, so the approved arguments and the called arguments must be identical.
   - A `CallToolResult` is a synchronous error and is returned as is.
   - A `CreateTaskResult` registers the run as `runId -> { taskId, inputs: Map<requestKey, entry> }`, starts its
     watcher, and returns `{ runId }`.

**Watcher.** One per run. It polls `client.tasks.get(taskId)` about every 500 ms until the task is terminal. It
never calls `tasks.wait`, which would answer input requests itself.

- On a terminal state it stores the result or error and withdraws every open input (see below).
- A failed `tasks.get` does not mean the task is gone. After three failures in a row the run's state becomes
  `unknown`, with the last error in `flow_status`, and polling continues with backoff up to 5 seconds. A later
  successful poll restores the real state. `cancel_flow` still works on an `unknown` run.

**Inputs.** Each run keeps one input record per request key, reconciled against every snapshot in a single place:

| Record state | Meaning |
|--------------|---------|
| `asking` | The desktop handler is running for this key, with its own abort controller |
| `sending` | The handler resolved; the record holds the result until `tasks.update` succeeds |
| `done` | Answered, withdrawn or failed; never dispatched again |

Reconciliation of a snapshot:

1. A key in `inputRequests` with no record: create an `asking` record and call the desktop handler with
   `{ key: runId, params, signal }`. In inbox mode the entry's `PendingInput.key` is the `runId`, which is how
   `flow_status` finds the run's entries (`inbox.list().filter((entry) => entry.key === runId)`).
2. A key with an `asking` record that is missing from the snapshot, or any `asking` record once the task is not
   `input_required` any more: abort its controller, which withdraws the inbox entry or closes the dialog, and mark it
   `done`.
3. A key with a `sending` record and no update in flight (the last attempt failed): send the stored result again.
   After three failed attempts the record becomes `done` and the run's `error` reports the failure; the run stays
   `input_required` until `cancel_flow`.
4. A key with a `sending` record missing from the snapshot, or any `sending` record once the task is not
   `input_required`: mark it `done` (the server took the answer, or the run moved on).
5. A key with a `done` record: nothing. The desktop is never asked twice for one key.

When the handler resolves while its record is still `asking`, the record moves to `sending` and the watcher sends
`client.tasks.update(taskId, { [requestKey]: result })`, and marks it `done` when the update succeeds. If the record
was already withdrawn, the result is dropped.

- A `cancel` or `decline` from the handler is sent unchanged, so the flow's `decline` edge applies.
- A handler that throws answers `cancel` and logs the error.
- A `tasks.update` rejected because the key is no longer pending (the answer raced a cancel, a timeout or a
  withdrawal) marks the record `done` and is logged. Other `tasks.update` errors leave the record in `sending`
  for the retry in step 3.
- `answer_input` validates through the inbox. `InboxAnswerInvalidError` or an unknown id returns an error result.

**Shutdown.** On SIGINT, SIGTERM or stdin close:

1. Stop accepting facade calls and stop every watcher loop. No new `tasks.update` starts after this point.
2. Abort every approval in progress and every `asking` record, so no late handler result reaches `tasks.update`.
3. Within one 5-second bound, together:
   - wait for `start_flow` calls already past approval; a task one of them creates is cancelled like a live run;
   - wait for `tasks.update` calls already in flight;
   - send `tasks.cancel` for each live run.
   Anything still pending after 5 seconds is abandoned; the in-memory task store ends with the process.
4. Dispose the inbox, the flow wiring and the session, in that order.

**Not handled.** Runs do not survive a restart. `flow_status` on an unknown `runId` returns an error result.

## Sample flows

- `demo/triage`: a `decide` node through `system-one:predict`, then a `tool` node calling `sqlite:sqlite_get`
  with `SELECT :label AS label` and the predicted label as a parameter, which works against the sibling's default
  in-memory database.
- `demo/ask`: an `input` node with a `decline` edge.
- `demo/nested`: a `call` node to `demo/ask`.

## Testing

**Smoke run.** `node scripts/flow-rig/smoke.mjs` spawns `serve.mjs` through a `NodeContextHost` with a temporary
config (`predictor: 'fake'`, `input: 'inbox'`, `confirm: 'deny'`, and a `fakeAnswers` entry holding a complete
typed answer for `demo/triage`'s question key) and checks:

- `list_flows` lists the three sample flows.
- `check_flow` on an invalid inline flow reports issues.
- `start_flow demo/ask`, poll `flow_status` until `pending` has one entry, `answer_input`, then the run completes
  with the answer.
- The same run answered with `decline_input` takes the `decline` edge.
- `demo/nested` surfaces the inner input under the outer `runId`.
- An inline flow calling a tool outside `allow` is denied.
- `demo/triage` completes with the fake prediction.

It exits non-zero on the first failure. It is not part of `pnpm test`; phase 2 moves it into
`integration-tests/`.

**Manual QA from Claude Code** (checklist in the README):

- `demo/triage` against a running System One.
- Inbox notification appears, then `prompt_input` opens the dialog and the answer completes the run.
- `input: 'dialog'` opens the dialog directly.
- A flow outside `allow` shows the confirm dialog; approve and deny both behave.
- `cancel_flow` during a pending input removes the entry and ends as `cancelled`.

**Lint.** `./scripts` joins the root `lint` script.

## Findings

The milestone's Findings section records each gap found, for phase 3. It starts with:

- No public API calls a tool with approval outside `AgentSession`; the rig calls `wrapApproval` and the raw client.
- Inbox entries carry only a context key, not a task or run id; the rig uses the run id as the key.
- `tasks.wait` answers input requests automatically; a host that routes task input itself must poll `tasks.get`.
