# CLI Refactoring — Completed

**Status:** complete
**Completed:** 2026-06-06
**Branch:** feat/cli-refactoring → PR #21
**Origin specs/plans (ephemeral, removed):** cli-chat-ink (2026-04-22),
tool-call-monitoring (2026-06-03), cli-chat-ux-fixes (2026-06-05),
cli-commander-migration (2026-06-05).

## Goal

End-to-end refactor of the `mokei` CLI: a fully Ink-based chat UI on top of
`@mokei/session`, the oclif framework replaced with `commander`, a flattened and
unified command surface, and the session/host fixes surfaced along the way.

This rolled up four sequential efforts (foundation → monitoring → UX fixes →
framework swap) plus follow-on bug fixes, all on one branch.

## Command surface (breaking)

Flat, four leaf commands — no `context` group:

| Now | Was |
|-----|-----|
| `mokei chat --provider <ollama\|openai\|anthropic>` | `mokei chat ollama` / `openai` / `anthropic` |
| `mokei inspect <command> [args...]` | `mokei context inspect` |
| `mokei monitor` | `mokei context monitor` |
| `mokei proxy <command> [args...]` | `mokei context proxy` |

`--provider` defaults to an interactive picker; `--api-url` moved off the
confusing `-p` to `-u`; `-p` = provider on `chat`, port on `monitor` (shorts are
per-command). `mokei context proxy` → `mokei proxy` matters most — MCP clients
spawn it by name.

## Key design decisions

### Ink chat foundation (was cli-chat-ink)

- **Ink renderer reusing `@mokei/session` orchestration** (not a Pastel rewrite),
  replacing the imperative `enquirer` + `ora` + raw-stdout loop (~300 lines of
  duplicated orchestration removed).
- One `Session` per CLI invocation, disposed on app unmount.
- `@mokei/session` made multi-turn: `stream/run` accept optional
  `{ messages, signal }`; `AgentResult.messages` returns full post-turn history.
  Existing one-shot callers unaffected.
- `<Static>` holds only committed transcript items; streaming delta and approval
  card live in a re-rendering `<PendingTurn>` that flushes on completion.
- Tool approval via a deferred-promise bridge (`useToolApproval`); event-driven
  reducer maps `AgentEvent` → UI state
  (`idle | streaming | awaiting-approval | calling-tool`).
- Slash commands via a pure `slash.ts` parser.

### Tool-call monitoring (was tool-call-monitoring)

- **No new event types** — per-tool timeout and user-cancel ride the existing
  `tool-call-error` event carrying typed errors (`ToolCallTimeoutError`,
  `ToolCallCancelledError`); UI discriminates by `error.name`.
- **Per-tool timeout** default 120s via `AgentSessionParams.toolTimeout`; no CLI
  flag. Per-call `AbortController` combined with the turn signal via `anySignal`;
  cancelling aborts only the tool, so the turn survives. Catch discriminates by
  abort-reason sentinels.
- **Single active call, not a concurrent list** (sequential execution; completed
  calls already live in the transcript).
- Elapsed always shown; warns red past 10s (`HANG_WARN_MS`), driven by a
  `useElapsed` 1s tick since no events fire while a tool hangs.
- **Contextual Esc:** `calling-tool` → cancel tool; `streaming` → abort turn.
- Transcript errors single-line; full text via a new `/details` command (Static
  can't toggle).

### UX fixes (was cli-chat-ux-fixes)

- **Concurrent-turn guard:** input disabled during a turn; second `submit`
  rejected — abort controller never orphaned, cancel stays reliable.
- **Clean disposal on all providers** (await teardown; the old anthropic path did
  `void dispose(); process.exit(0)` and exited early).
- **Safe context removal:** `/context remove` shows a y/n `ConfirmCard` and
  reports the actual `removeContext` result (now `boolean` through session +
  `useSession`); no false-success on a missing key.
- **Restored tool-enable granularity:** `/context add` auto-enables all, then
  immediately opens `ToolSelectCard` to deselect.
- Orphan-pending approval resolver cleared on mid-approval abort.

### oclif → commander (was cli-commander-migration)

- **commander over pastel:** pastel forces Ink `render()` on *every* command
  (corrupting `proxy`'s raw stdio MCP transport) and pulls in `zod`; commander
  renders only where a UI is wanted.
- **`proxy` never imports Ink** — pure stdio pipe, verified by an e2e round-trip
  asserting zero ANSI/Ink escape bytes (the regression proving the swap didn't
  corrupt the passthrough).
- **Per-command factories** (`createXCommand(): Command`) composed in
  `program.ts` — the whole tree is testable by introspection without spawning.
- **`runInk(Component, props)`** wraps `createElement` +
  `render(..., { exitOnCtrlC: false })` + `waitUntilExit()`; `renderStatic` for
  one-shot frames (`inspect`). `ChatLauncher` picks the provider (flag or
  `ProviderSelectCard`), builds the session, renders `<ChatApp>`.
- Both bin entries run built `dist/` (JSX can't be stripped at runtime).
- Dropped oclif deps/config/scripts + dead `enquirer`/`ora`; added `commander`.

## Follow-on bug fixes (same branch)

- **Daemon socket leak on quit (root-caused):** `ContextHost` never wired
  `_dispose()` into the `@enkaku/async` `Disposer` — the base only runs the
  `dispose` fn passed to its constructor, so `client.dispose()` never ran and the
  daemon socket kept the event loop alive. Fixed via a `ContextHost` constructor
  (`super({ dispose: () => this._dispose() })`), in concert with the upstream
  enkaku 0.16.2 socket-unref fix; the CLI `process.exit()` band-aid was removed.
- **`DEFAULT_HTTP_TIMEOUT`** exported from `@mokei/http-client` (de-magicked the
  inlined 30s default).
- **No-arg / usage-error UX:** `mokei` with no command prints help to stdout and
  exits 0 (guarded in `run()`, not via a root action — a root action breaks
  `mokei help` / `mokei bogus` under `enablePositionalOptions`); usage errors
  print full subcommand help via `showHelpAfterError()` propagated to each
  `addCommand`ed subcommand.

## Testing

- **Unit:** program introspection, ProviderSelectCard, providers, slash parser,
  turn reducer, `useElapsed` / `useAgentTurn` hooks, components, help/usage
  regressions.
- **e2e (PTY + raw-pipe):** cli-chat (core/cancel/model), cli-chat-context
  (lifecycle), cli-chat-tools (approval/deny/tools), proxy stdio round-trip
  (zero ANSI), help/version, inspect. `ChatDriver` updated to `--provider`.

## Non-goals (unchanged)

Pastel migration; `chat llama` wiring; cross-invocation history persistence;
slash autocomplete; multi-line input; plugin system; auto-generated README
commands block; concurrent tool-call tracking; per-tool retry.
