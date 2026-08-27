# Website quick-start — obsolete chat walkthrough

**Status:** backlog
**Origin:** found during the 2026-08-01 documentation sweep, recorded in the former
`backlog/2026-06-20-mcp-draft-remaining.md` §3.4 until 2026-08-04. Unrelated to protocol
revisions, so it is tracked on its own.

## Problem

The website quick-start documents a CLI that no longer exists. It shows an inquirer-style
`? Select an action …` menu (`Add a context` / `Send a message` / `Select tools to enable`) and a
`mokei chat ollama` invocation. The CLI is an Ink TUI driven by slash commands, and the command
is `mokei chat --provider ollama`.

## Why it is still open

Rewriting it needs a real PTY run to capture accurate output. Hand-written terminal transcripts
drift again within a release, which is how this one rotted. `integration-tests/` already drives
the CLI over a PTY (`support/chat-driver.ts`), so the capture path exists.

## Scope

- Rewrite the walkthrough against a real session: correct invocation, current slash commands,
  real rendered output.
- Check the surrounding quick-start prose for the same class of drift.
