# CLI Chat UX on Ink — Completed

**Status:** complete
**Completed:** 2026-06-06
**Origin spec:** 2026-04-22-cli-chat-ink-design.md (ephemeral, removed)
**Branch:** feat/cli-refactoring

## Goal

Replace the imperative `enquirer` + `ora` + raw-stdout chat loop in the CLI with
an Ink (React) application that reuses `@mokei/session` orchestration. Deliver a
persistent transcript, always-on input, inline tool approval, Esc-to-abort, and
removal of ~300 lines of duplicated orchestration in the CLI package.

## Key design decisions

- **Ink renderer behind the existing (then oclif) commands** — "Option A" from
  the research doc; not a Pastel rewrite.
- **One `Session` per CLI invocation**, held in `<ChatApp>` and disposed on
  unmount.
- **`@mokei/session` made multi-turn:** `AgentSession.stream/run` accept an
  optional `{ messages, signal }`, and `AgentResult.messages` returns the full
  post-turn history. Existing one-shot callers unaffected.
- **`<Static>` holds only committed, immutable transcript items;** streaming
  delta and the tool-approval card live in a re-rendering `<PendingTurn>` that
  flushes into `<Static>` on completion.
- **Tool approval via a deferred-promise bridge** (`useToolApproval`): the agent
  awaits a promise; the UI renders `<ToolApprovalCard>`; the keypress resolves
  it.
- **Event-driven reducer** maps `AgentEvent` types to UI state
  (`idle | streaming | awaiting-approval | calling-tool`).
- **Slash commands** parsed by a pure `slash.ts` parser (`/context`, `/model`,
  `/tools`, `/help`, `/quit`).
- **Contextual Esc:** aborts streaming at root; during an approval card the card
  owns Esc (denies the call without aborting the turn).

## What was built

Full `packages/cli/src/chat/` Ink app (components + hooks + slash parser),
provider command files mounting `<ChatApp>` for Anthropic, Ollama, OpenAI; the
`@mokei/session` multi-turn extension with tests; dead deps (`ora`, `enquirer`,
`ansi-colors`) removed; package-local swc/tsconfig JSX config. Deleted the old
`chat-session.ts` / `prompt.ts`.

## Non-goals (unchanged)

Pastel migration; `chat llama` wiring; cross-invocation history persistence;
slash autocomplete; multi-line input. This was the foundation later refined by
the tool-call-monitoring, cli-chat-ux-fixes, and cli-commander-migration plans.
