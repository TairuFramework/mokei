# Host desktop interaction — complete

**Status:** complete
**Date:** 2026-09-30
**Branch:** `feat/host-desktop`
**Origin:** reaching the user of a headless host (cron job, daemon, headless `AgentSession`) when a
server needs input, mainly a background decision flow whose `input` node suspends its task in
`input_required`. Builds on the [task input lifecycle](2026-09-30-task-input-lifecycle.complete.md),
which made withdrawal reach the handler and late answers harmless.

## Goal

Give a single-user host a desktop `elicit` handler: a blocking native dialog by default, or a
notification plus a pending entry in an application-owned input inbox. Optional local tools let a
headless agent notify or ask the user directly.

## Key design decisions

- **New Node-only package `@mokei/host-desktop`** (user-approved), in the fixed release group. It
  works with any `ContextHost`; nothing was added to `@mokei/host-node` or `@mokei/session`, so
  headless `host-node` users never load dialog code. The only `@mokei/host` change widens the
  direct-context config type to `Omit<ServerParams, 'transport'>`.
- **OS tools driven directly through `execa`, without a shell** (`alerter` or `osascript` on macOS,
  `zenity` and `notify-send` on Linux). `node-notifier` was rejected: unmaintained, stale vendored
  binaries. A runner tracks every child and kills it on abort, timeout or dispose (SIGTERM, then
  SIGKILL after 1 second); the next dialog waits until a killed one has exited.
- **Answer validation with `@sozai/schema`** (AJV, JSON Schema 2020-12 with formats) against the
  request's `requestedSchema`; the dialog mapping (`planForm`) stays custom and runs first.
- **Argument safety.** Server-supplied text never becomes an option: `--` precedes zenity rows and
  notify-send positionals; `alerter`, which has no `--`, refuses any value starting with `-` or a
  choice label containing a comma (auto-selection falls back to `osascript`, a forced `alerter`
  declines). zenity dialog text is escaped so it shows exactly as sent (entry text goes through
  escape and mnemonic processing, list text through Pango markup, per the zenity 4 source).
- **Blocking mode.** One dialog at a time (FIFO per handler). One budget per request —
  `timeoutSeconds` 90, clamped to `maxTimeoutSeconds` 600 — covers queue time, every field and
  retries (up to 3 attempts per field); expiry returns `cancel`, a signal abort rejects with its
  reason. URL mode and forms the dialog mapping cannot show are declined without a dialog and
  reported through `onUnsupported` (stderr by default). Timeout options must be finite and positive.
- **Inbox mode.** Requires a registered answer surface, otherwise `cancel` with no entry. Each
  request becomes a pending entry with no dialog budget (it lives until answer, withdrawal, task
  expiry, caller abort or disposal), plus a best-effort notification (5-second timeout, generic
  body; the prompt preview is opt-in because of lock screens). `inbox.prompt(id)` opens the
  dialogs with a fresh budget; an outcome no person chose (no dialog backend, backend failure)
  rejects the prompt and leaves the entry pending, so one click can never cancel a task.
- **Not persisted.** After a restart the application calls `client.tasks.wait(taskId)` again and
  the waiter re-dispatches outstanding requests, creating new entries. Flows started by an
  `AgentSession` tool call cannot be resumed this way (the task ID never reaches the application).
- **Caller timeouts are documented, not changed.** The 90-second default sits under
  `AgentSession`'s 120-second `toolTimeout`; inbox mode only helps sessions whose timeouts are
  raised to cover the answer time.
- **Non-goals:** Windows, other adapters, URL mode, a CLI or monitor inbox surface, users with no
  graphical session, shared or multi-user answering.

## What was built

- `createDesktopElicitHandler(options)` (blocking and inbox modes), `createInputInbox()` with
  `added`/`settled`/`removed` events and answer surfaces, `createDesktopTools(options)`
  (`local:notify`, `local:ask_user`), `createRunner()`, cached backend detection with install
  hints, and form mapping and validation.
- Tests: unit tests per module, a task integration test (ContextServer tasks answered through an
  inbox-mode handler), and a zenity end-to-end suite (timeout and answered paths via `xdotool`)
  gated by `DESKTOP_E2E` and run under `xvfb-run` in one Linux CI job.
- README (usage, answer surfaces, shutdown),
  `docs/agents/architecture.md` entries, and a patch changeset.

## Follow-ons

Deferred minors are in [host desktop follow-ons](../backlog/2026-09-30-host-desktop-follow-ons.md).
