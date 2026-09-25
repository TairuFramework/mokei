# Website quick-start — obsolete chat walkthrough

**Status:** next (promoted 2026-09-25)
**Origin:** found during the 2026-08-01 documentation sweep, recorded in the former
`backlog/2026-06-20-mcp-draft-remaining.md` §3.4 until 2026-08-04. Unrelated to protocol
revisions, so it is tracked on its own.

## Problem

The website quick-start documents a CLI that no longer exists. It shows an inquirer-style
`? Select an action …` menu (`Add a context` / `Send a message` / `Select tools to enable`) and a
`mokei chat ollama` invocation. The CLI is an Ink TUI driven by slash commands, and the command
is `mokei chat --provider ollama`.

## Approach

Capture output from a real PTY run, not a hand-written transcript -- hand-written transcripts
drift within a release, which is how this one rotted. `integration-tests/support/chat-driver.ts`
already drives the CLI over a PTY, so nothing blocks the rewrite.

## Scope

- Rewrite the walkthrough against a real session: correct invocation, current slash commands,
  real rendered output.
- Check the surrounding quick-start prose for the same class of drift.
