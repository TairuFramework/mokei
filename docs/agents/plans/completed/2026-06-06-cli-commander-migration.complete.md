# CLI Refactor: oclif → commander, flatten + unify commands — Completed

**Status:** complete
**Completed:** 2026-06-06
**Origin spec:** 2026-06-05-cli-commander-migration-design.md (ephemeral, removed)
**Branch:** feat/cli-refactoring

## Goal

Remove the oclif command framework from the `mokei` CLI, replacing it with
`commander` as a thin arg router. Keep the UI fully Ink-based, flatten the
command tree to top level, and fold the three provider-specific chat commands
into a single `mokei chat` with a `--provider` flag plus an interactive prompt.
Drop dead deps (`enquirer`, `ora`).

## Key design decisions

- **commander over pastel:** pastel forces an Ink `render()` on *every* command
  (which would corrupt `proxy`'s raw stdio MCP transport) and pulls in `zod`;
  commander lets us call `render()` only where a UI is wanted.
- **Four flat leaf commands, no groups:** `chat`, `inspect <command> [args...]`,
  `monitor`, `proxy <command> [args...]`. Breaking renames: `context inspect/
  monitor/proxy` → top-level; `chat <provider>` → `chat --provider`.
- **`proxy` never imports Ink** — pure stdio pipe, verified by an e2e
  round-trip asserting **zero ANSI/Ink escape bytes** on stdout (the regression
  proving the framework swap didn't corrupt the passthrough).
- **Short-flag remap:** `--provider -p` on chat, `--api-url` moved off the
  confusing `-p` to `-u`, `--port -p` on monitor (shorts are per-command).
- **Per-command factories** (`createXCommand(): Command`) composed in
  `program.ts`, making the whole tree testable by introspection without
  spawning.
- **`runInk(Component, props)` helper** wraps `createElement` +
  `render(..., { exitOnCtrlC: false })` + `waitUntilExit()`; `renderStatic` for
  one-shot frames (`inspect`). `ChatLauncher` picks the provider (flag or
  `ProviderSelectCard`), builds the session, and renders `<ChatApp>`.
- **Both bin entries run built `dist/`** (JSX can't be stripped at runtime).

## What was built

`index.ts` / `program.ts` / `options.ts` / `ink.ts`; the four command files
(`chat.tsx`, `inspect.tsx`, `monitor.tsx`, `proxy.ts`); `ChatLauncher` +
`providers.ts` + `ProviderSelectCard`; removed `commands/chat/*` and
`commands/context/*`. Dropped oclif deps/config/scripts and the catalog entries;
added `commander`. Program-introspection + ProviderSelectCard + providers unit
tests; new e2e suites (proxy stdio round-trip, help/version, inspect) plus the
`ChatDriver` update to `--provider`.

## Follow-on work folded into this branch (post-merge cleanup)

- **Daemon socket leak on quit (root-caused):** `ContextHost` never wired
  `_dispose()` into the `@enkaku/async` `Disposer` (the base only runs the
  `dispose` fn passed to its constructor), so `client.dispose()` never ran and
  the daemon socket kept the loop alive. Fixed by a `ContextHost` constructor
  (`super({ dispose: () => this._dispose() })`), in concert with the upstream
  enkaku 0.16.2 socket-unref fix. The CLI `process.exit()` band-aid was removed.
- **`DEFAULT_HTTP_TIMEOUT`** exported from `@mokei/http-client` (de-magicked the
  inlined 30s default).
- **No-arg / usage-error UX:** `mokei` with no command prints help to stdout and
  exits 0 (guarded in `run()`, not via a root action — a root action breaks
  `mokei help` / `mokei bogus` under `enablePositionalOptions`); usage errors
  print full subcommand help via `showHelpAfterError()` propagated to each
  `addCommand`ed subcommand.

## Non-goals (unchanged)

No change to the chat TUI internals; no plugin system; no auto-generated README
commands block.
