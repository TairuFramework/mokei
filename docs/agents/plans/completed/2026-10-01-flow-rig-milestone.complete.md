# Milestone: flow rig

**Status:** complete
**Dates:** 2026-09-30 to 2026-10-01
**PR:** #68 (phases 1, 2 and 3A, one branch)

## Goal

Run the whole stack locally: [decision flows](2026-09-29-decision-flow.complete.md) that use System One, sibling MCP
servers and desktop input from `@mokei/host-desktop`. Drive it first from Claude Code through MCP. Then turn the same
setup into integration tests. Finally, use what both phases found to drive new session, host and CLI features.

Phases 1, 2 and the phase 3 quick fixes shipped here. The rest of phase 3 was replaced by the
[flow daemon milestone](2026-10-05-flow-daemon-milestone.complete.md). That milestone later deleted the rig, and the
`mokei` CLI and `mokei flows mcp` replaced it.

## Phase 1 -- local rig

### Key decisions

- **Plain Node script, not a package or binary.** Everything lives in `scripts/flow-rig/` and imports the built
  `lib/` of workspace packages by relative path. No package code changed.
- **Facade MCP server.** Claude Code cannot call the decision-flow tools directly. They run only as MCP tasks, and
  each run needs a single-use `dev.mokei/flow-grant` minted by `DecisionFlowWiring.wrapApproval`. The grant is bound
  to the tool name and an args digest.
- **Facade tools.** The rig approves a run itself and calls the flow tool with `task: 'handle'`, using the identical
  args object. It exposes `start_flow`, `flow_status` and `cancel_flow`, plus `list_flows` and `check_flow`
  pass-throughs.
- **Input goes to the desktop, not upstream.** The rig never calls `tasks.wait`, which answers input requests itself.
  It polls `tasks.get`, hands each input request to the desktop elicit handler and answers with `tasks.update`. The
  run ID is the inbox key.
- **Inbox mode by default.** The `prompt_input`, `answer_input` and `decline_input` tools drive the inbox. Blocking
  dialogs are opt-in.
- **Input record state machine.** One record per request key moves through `asking`, `sending` and `done`.
  `sending` holds the result until `tasks.update` succeeds, retried up to 3 attempts.
- **Withdrawal.** A key that leaves the snapshot withdraws its prompt, aborted with `TaskInputWithdrawnError`. A late
  handler result is dropped. A `-32602` update means the key is no longer pending.
- **Poll failure is not task failure.** Three failed polls give state `unknown`, with backoff up to 5 s. A later
  success restores the real state.
- **Approval by allowlist.** A run whose static tool plan fits the configured tool-ID globs is approved. A `*` stays
  within one segment. Otherwise a desktop confirm dialog decides, or `confirm: deny|approve` for scripted runs. A
  caller that cancels `start_flow` during approval never starts the run.
- **Real or fake predictor.** `system-one:predict` is the default. A scripted fake (`fakeAnswers`) serves runs without
  System One. The fake is a plain `Predictor`, so flow plans exclude `system-one:predict`.
- **Bounded shutdown.** Stop watchers, then abort approvals and open prompts. Within 5 s, wait for in-flight starts
  and updates, cancelling any task those starts create, and cancel live runs. Then dispose the inbox, handlers, flow
  wiring and session.

### What was built

`scripts/flow-rig/` holds the config, fake predictor, input, run and approval modules, the server and a smoke script.
It ships sample flows `demo/triage`, `demo/ask` and `demo/nested`, and a README with a manual QA checklist. 43
`node:test` unit tests and an 8-check smoke run over stdio cover it. The root `.mcp.json` registers the rig for
Claude Code, and root `lint` now covers `./scripts`.

Manual macOS QA passed on 2026-10-01 against a local `laya-serve`. It found that the system-one sibling needs
`SYSTEM_ONE_MODEL`, which `rig.config.json` then set.

One edge was left for phase 3. A caller that cancels `start_flow` while the flow tool call is in flight still
registers a run. Its ID never reaches Claude Code, which a `list_runs` tool would cover.

## Phase 2 -- integration harness

Run the rig's facade scenarios in CI over a real stdio boundary, without a desktop or System One. The suite replaced
the phase 1 smoke run. It automates the manual QA checklist, except the parts that need a real desktop or System One.

### Key decisions

- **Target the rig facade.** The suite calls `start_flow`, `flow_status` and the input tools, as Claude Code does. It
  covers approval, the run manager, inbox and dialog routing, and the stack below them.
- **Real process boundary.** The suite spawns a rig process through `NodeContextHost` and never calls it in-process.
- **Stubs are injected in code, not config.** `serve.mjs` exports `createRig({ configPath, desktop })`. `desktop` is
  the existing `@mokei/host-desktop` seam (`createBackend`, `runner`, `platform`, `env`), passed to both elicit
  handlers. The rig config gained no test-only fields, and no package changed.
- **The stub desktop passes backend detection honestly.** It writes executable `zenity` and `notify-send` stubs to a
  temporary directory. It sets `PATH`, `DISPLAY` and `DBUS_SESSION_BUS_ADDRESS`. Its runner rejects, and the suite
  asserts the runner call count stays 0.
- **A stub ask always settles.** It stays pending until a test answers it or its signal aborts. The elicit handler
  releases its dialog queue only when the backend promise settles. An abandoned ask would block later dialogs.
- **Shutdown beats the host's kill grace.** Host disposal sends `SIGKILL` 5 seconds after `SIGTERM`, but rig shutdown
  can take longer. The suite calls a `stub_shutdown` tool before it disposes the host.
- **Blocking calls are tracked.** Every call started without `await` gets an abort controller and a rejection
  handler. Each test aborts and joins them, then cancels its runs. A failure cannot leak into the next test.
- **The fake predictor stays config-driven**, through `predictor: fake` and `fakeAnswers`.

### What was built

`integration-tests/support/flow-rig/` holds the stub desktop with its `stub_dialogs` and `stub_answer` tools and the
stub rig entry with `stub_shutdown`. It also holds a driver with deadline-bound call, wait, watermark and cleanup
helpers. `integration-tests/suites/flow-rig.test.ts` has 16 tests. They cover listing, checks, answered, declined and
nested input, and inbox prompting. They also cover confirm outside the allowlist, fake triage, a missing fake answer,
cancellation, the direct dialog mode, and abort and withdrawal.

The smoke run was deleted. The root `test` script also runs `test:flow-rig`, so CI needed no workflow change.

Aborting or timing out a client `callTool` cancels the server-side approval or prompt, and the stub ask settles. The
suite pinned two behaviours that phase 3 might change. A failed flow reported `state: completed` with `isError`.
Inline flows had to pass `input: {}`.

## Phase 3A -- quick fixes

Phase 3 was split into sub-projects A (quick fixes and sozai asks), B (flow runs as a session API) and C (CLI
surfaces). A closed the small findings in the packages that own them and dropped the matching rig workarounds. B and
C moved to the flow daemon milestone.

### Key decisions

- **A cancellable inbox prompt.** `InputInbox.prompt(id, { signal })` shares one prompt run across concurrent
  callers. The shared run aborts only when its last waiting caller aborts. The entry stays pending, so it can be
  prompted again.
- **Prompt edge cases.** A signal that is already aborted opens no dialog. An abort after the entry settled elsewhere
  resolves with the entry's outcome.
- **Withdrawal rejection deferred by design.** An elicit handler aborted with a `TaskInputWithdrawnError` still
  rejects. The aborting caller owns that rejection, as documented on `createDesktopElicitHandler`.
- **Typed predictor errors across the MCP hop.** Sozai's sanitising already kept the error type. The loss was the
  hop, since the system-one server threw a plain `Error`.
- **Error meta.** The server now returns an error result with `_meta['dev.mokei/system-one-error']`, holding
  `{ name, status?, retryAfterMs? }`. The predictor rebuilds the matching `SystemOneError` subclass. Missing or unknown
  meta falls back to a plain `SystemOneError`. Aborted requests still throw.
- **Optional System One model.** The request `model` is optional end to end. The HTTP backend omits it, so
  `laya-serve` picks its default. The backend result still reports the model it used.
- **Inline input default.** `run_flow` treats an `undefined` input as `{}`. An explicit `null` is still validated.
- **Upstream asks.** A more detailed `Invalid flow input` message and a `ref` for an `end` node `outcome` were
  requested upstream from `@sozai/flow-graph`.

### What was built

- `@mokei/host-desktop`: the `prompt` signal option. The rig's `prompt_input` passes its request signal.
- `@mokei/system-one-client`: the optional request model, plus `SYSTEM_ONE_ERROR_META`, `SystemOneErrorInfo`,
  `systemOneErrorInfo` and `systemOneErrorFromInfo`.
- `@mokei/mcp-system-one`: error results carrying the error meta.
- `@mokei/decision-flow-server`: typed predictor errors and the inline input default.

Over MCP, rate-limit and overloaded predictor errors are now retryable at flow level. They already were with an
in-process predictor. A possible follow-up is a meta parser export, so the predictor does not parse the wire shape
inline.

## Findings

Gaps found while building and using the rig, with their final status.

- **No public "call a tool with approval" outside `AgentSession`.** The rig called `wrapApproval` and the raw context
  client itself. Moved to the flow daemon milestone.
- **Inbox entries carry only a context key.** No task or run ID, so a host cannot tell which run an entry belongs to.
  Moved to the flow daemon milestone.
- **`tasks.wait` answers task input requests automatically.** A host that routes input itself must poll `tasks.get`
  and answer with `tasks.update`. Moved to the flow daemon milestone.
- **`InputInbox.prompt(id)` takes no abort signal.** Shipped in phase 3A.
- **A flow `end` node's `outcome` must be a literal.** Passing a nested outcome through needs a `branch` per outcome,
  as in `demo/nested`. Requested upstream.
- **Aborting a desktop elicit handler rejects its promise.** The inbox records the entry as `withdrawn`, but a host
  must ignore rejections from inputs it withdrew itself. Deferred by design.
- **Desktop elicit handling and the flow task API share no notion of a run.** The rig kept its own run-to-task map.
  Moved to the flow daemon milestone.
- **A predictor failure hides its message.** The flow error reported only `lastFailure: { type: "SystemOneError" }`.
  Shipped in phase 3A through the error meta.
- **The system-one server needs a model with no fallback.** The integration suite cannot catch this, since it uses
  the fake predictor. Shipped in phase 3A, as `model` is now optional.
- **A failed flow reports `state: completed`.** The failure shows only as `isError` in the result. Moved to the flow
  daemon milestone.
- **An inline flow started without `input` fails with `Invalid flow input`.** Shipped in phase 3A as the `{}` default.
  The clearer error detail was requested upstream.
