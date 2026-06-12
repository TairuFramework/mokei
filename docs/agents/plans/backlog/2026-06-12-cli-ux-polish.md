# CLI UX polish

**Status:** backlog
**Origin:** 2026-06-12 full audit (security, stability, usability, MCP-spec).

## Gap

First-run failure modes are abrupt or opaque: no upfront API-key check, server stderr
discarded by the debugging command, empty states unexplained. (The crash-class CLI
items — model-list crash, launcher exit code, top-level handler — are in
`next/2026-06-12-hang-crash-core.md`.)

## Scope

1. **API-key fail-fast + env-var help** — `packages/cli/src/chat/providers.ts:34-44`:
   `mokei chat -p openai` with no key starts fine and fails at the first request (HTTP
   401). Fail fast in `buildChat` when `resolveApiKey` returns undefined for
   openai/anthropic ("set OPENAI_API_KEY or pass --api-key"). `options.ts:7`: mention
   the `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` fallbacks in the flag help, and note that
   argv keys leak via `ps`/shell history (prefer env vars; consider a warning when `-k`
   is used).
2. **inspect: inherit server stderr** — `packages/host/src/spawn.ts:35`
   (`stderr: 'ignore'`) + `packages/cli/src/commands/inspect.tsx`: when a server fails
   to initialize, its own diagnostics are lost; inspect shows only "Server did not
   respond to initialize request". Pass `stderr: 'inherit'` for inspect (it's the
   debugging tool).
3. **Empty model-list state** — `packages/cli/src/chat/components/ModelSelectCard.tsx:19-22`:
   zero models renders a blank `Select`. Add an empty-state message including the
   provider endpoint.
4. **Flag consistency note** — `-p` is `--provider` in chat but `--port` in monitor
   (`options.ts` vs `commands/monitor.tsx:21`). Acceptable; revisit only if the flag
   surface is reworked.

## Notes

- Verified good (keep): in-turn error UX (`/details`, timeout names `--timeout`,
  two-stage Ctrl+C, Esc semantics), `docs/guides/cli.md` accuracy, help output defaults.
