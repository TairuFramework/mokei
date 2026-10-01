# Flow rig

The flow rig runs decision flows locally and lets Claude Code drive them over MCP. It is a plain Node ESM script.
It starts a `NodeSession` with sibling MCP servers (System One, SQLite) and creates an `@mokei/flow-host` runtime.
A small facade MCP server serves the runtime over stdio. One `@mokei/host-desktop` input surface provides notifications and dialogs.

The runtime owns run IDs, approval, task watching and the inbox. The facade exposes these through ordinary MCP tool calls.
Shutdown cancels non-terminal runs, then disposes the runtime, desktop surface and session.

## Prerequisites

- Run `pnpm build` first. The rig imports the built `lib/` of the workspace packages, so it uses stale code until
  you rebuild after a source change.
- Optional: a System One server on `http://localhost:8000`. It is only needed when `predictor` is `real`. Set
  `predictor` to `fake` to run without it.
- Optional: the `alerter` command on your `PATH` (`brew install alerter` on macOS), for desktop notifications.
  Desktop features are tested on macOS only. The rig should start on Linux, but that is not tested.

## How Claude Code picks it up

The repository's `.mcp.json` registers the rig as the `flow-rig` MCP server, started with
`node scripts/flow-rig/serve.mjs`. Open Claude Code in the repository root and approve the server. All rig logs go
to stderr, because stdout carries MCP.

To use a different config file, set the `FLOW_RIG_CONFIG` environment variable to its path.

## Config

The rig reads `scripts/flow-rig/rig.config.json`, or the file named by `FLOW_RIG_CONFIG`.

The `system-one` sibling's `SYSTEM_ONE_MODEL` env is optional. When it is unset, `laya-serve` picks its default
model.

| Field | Default | Meaning |
|-------|---------|---------|
| `siblings` | `{}` | MCP servers to spawn, keyed by context key, with `command`, `args` and optional `env`. Same shape as `mcp-servers/config.json`. Relative `.js` paths in `args` resolve from the repository root. A spawn failure stops the rig, except that `system-one` is skipped when `predictor` is `fake`. |
| `flowsDir` | `flows` | Directory of flow definitions (`*.json`), resolved from the config file's directory. An invalid flow stops the rig, naming the flow files and the issues on stderr. |
| `allow` | `[]` | Tool-id globs. A run whose tool plan fits these globs is approved without asking. `*` matches within one segment, so `sqlite:*` matches every sqlite tool but not tools of other contexts. |
| `predictor` | `real` | `real` uses the sibling `system-one:predict`. `fake` answers `decide` questions from `fakeAnswers`. |
| `fakeAnswers` | `{}` | Used when `predictor` is `fake`. Maps each question key to a complete typed answer for that question kind, exactly as System One would return it. A missing key fails the prediction with `No fake answer for <key>`. |
| `input` | `inbox` | `inbox` sends a notification for runtime input items, opened with `prompt_input`. `dialog` opens a dialog automatically. |
| `confirm` | `desktop` | How to answer an approval item for a run outside `allow`. `desktop` shows a confirm dialog that lists the flow and its tool plan (cancel or timeout denies). `deny` and `approve` settle the approval item immediately. |

## Tools

| Tool | Input | Result |
|------|-------|--------|
| `list_flows` | none | The flow server's list of registered flows |
| `check_flow` | `{ definition }` | The flow server's check of an inline definition, without running it |
| `start_flow` | `{ flow?, definition?, input? }` | `{ runID }`, or an error result. Give exactly one of `flow` (a registered id) or `definition` (an inline flow). For inline flows, missing `input` defaults to `{}`. Queued runs return a `runID` immediately. Refused approval gives a `denied` run. Starting after shutdown returns `Rig is shutting down`. |
| `flow_status` | `{ runID }` | `{ state, pending, result?, error? }`. `pending` entries are `{ id, message, requestedSchema, canPrompt }`. |
| `cancel_flow` | `{ runID }` | `{ state }` after the cancel is sent |
| `prompt_input` | `{ id }` | Opens desktop dialogs for the inbox entry and blocks until it settles. Returns `{ id, action }`. |
| `answer_input` | `{ id, value }` | Answers the inbox entry with a value matching its requested schema. Returns `{ id, action }` with action `accept`. An invalid value or unknown id returns an error result. |
| `decline_input` | `{ id }` | Declines the inbox entry. Returns `{ id, action }` with action `decline`. |

`state` is one of `awaiting_approval`, `denied`, `working`, `input_required`, `completed`, `failed` or `cancelled`.
A flow error reports `failed`, with `error: { type, message, code? }`. Denial reports `denied`, with a `FlowDenied` error.
Successful `result` values keep the MCP shape: `{ content, structuredContent: { outcome?, output? } }`.
Polling errors retry with backoff and preserve the current state.

`pending` lists the run's input items, excluding items under open automatic dialogs. Approval items do not appear in `pending`.
`canPrompt` tells whether the desktop surface can show the requested form.
A rejected desktop prompt returns a tool error and leaves its input item open for another attempt.
Accept, decline and cancel responses settle through the runtime inbox. Settling elsewhere aborts the item's open dialog.

`prompt_input`, `answer_input` and `decline_input` exist only when `input` is `inbox`.
The rig uses memory stores, so runs do not survive a process restart.
`flow_status` on an unknown `runID` returns an error result.

## Sample flows

- `demo/triage`: takes `input: { message }` and classifies it as a bug or a question with a `decide` node through
  `system-one:predict`, then runs a `sqlite:sqlite_get` lookup using the predicted label.
- `demo/ask`: an `input` node with a `decline` edge.
- `demo/nested`: a `call` node to `demo/ask`, so the inner input shows up under the outer run.

## Tests

- Unit tests: `pnpm run test:flow-rig`.
- Integration: `pnpm run test:integration` runs `integration-tests/suites/flow-rig.test.ts` against a stub desktop
  and the fake predictor, with no System One or desktop needed.

## Manual QA checklist

Run these from Claude Code on macOS with the rig built and System One running. This checklist covers the real desktop and real System One.

- [x] `start_flow` with `demo/triage` against a running System One completes with a predicted label.
- [x] `start_flow` with `demo/ask` shows an inbox notification. `flow_status` lists one pending entry. `prompt_input`
      opens the dialog, and answering it completes the run with that answer.
- [x] With `input` set to `dialog`, `start_flow` with `demo/ask` opens the dialog directly.
- [ ] A flow outside `allow` returns a queued `runID` and shows the confirm dialog. Approval runs it. Denial reports `denied`.
- [x] `cancel_flow` during a pending input removes the inbox entry and the run ends as `cancelled`.

- [ ] Shutdown with a queued approval closes its confirm dialog and cancels the run.
