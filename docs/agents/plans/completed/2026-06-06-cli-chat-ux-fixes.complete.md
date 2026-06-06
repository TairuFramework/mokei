# CLI Chat UX Fixes + e2e Suites — Completed

**Status:** complete
**Completed:** 2026-06-06
**Origin plan:** 2026-06-05-cli-chat-ux-fixes.md (ephemeral, removed; no separate spec)
**Branch:** feat/cli-refactoring

## Goal

Close the parity gaps and Important issues found in the code review of the Ink
chat refactor, and lock the behaviour in with PTY-driven e2e suites split by
concern.

## Key design decisions / fixes

- **Concurrent-turn guard:** input is disabled during an active turn and
  `useAgentTurn.submit` rejects a second submit, so a turn's abort controller is
  never orphaned (cancel stays reliable).
- **Clean disposal on all providers:** await session/daemon teardown instead of
  `void dispose(); process.exit(0)` (the old anthropic path exited early).
- **Safe context removal:** `/context remove` shows a y/n `ConfirmCard` and
  reports based on the actual `removeContext` result (now returns `boolean`
  through `@mokei/session` and `useSession`); no more false-success on a missing
  key.
- **Restored tool-enable granularity:** `/context add` auto-enables all tools and
  then immediately opens the existing `ToolSelectCard` so the user can deselect
  (reusing the component, not reinventing it).
- **Orphan-pending cleanup:** a lingering `useToolApproval.pending` resolver is
  cleared if a turn aborts mid-approval.
- **SIGINT→Esc redesign left intact** — intentional, not reverted.
- **e2e split by concern:** `cli-chat.test.ts` (core/cancel/model),
  `cli-chat-context.test.ts` (context lifecycle), `cli-chat-tools.test.ts`
  (approval/deny/tools card), all sharing the `ChatDriver` PTY harness which
  gained helpers and post-add card handling.

## What was built

`@mokei/session` `removeContext: boolean`; CLI `useAgentTurn` in-flight guard,
`useSession` boolean return, `ChatApp` wiring (input disable, post-add
tool-select, remove-confirm, orphan cleanup), awaited disposal in the provider
command; new `ConfirmCard` component + unit test; three concern-split e2e suites
replacing the monolithic `cli.test.ts`.
