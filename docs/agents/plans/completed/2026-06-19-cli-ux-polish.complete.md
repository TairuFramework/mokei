# CLI UX polish

**Status:** complete
**Origin:** 2026-06-12 full audit (security, stability, usability, MCP-spec).
Shipped 2026-06-19 (commit `1654f8e`).

## Gap

First-run failure modes were abrupt or opaque: no upfront API-key check, server stderr
discarded by the debugging command, empty model-list state unexplained.

## Resolution

1. **API-key fail-fast** — `buildChat` (`packages/cli/src/chat/providers.ts`) now fails
   fast for openai/anthropic when no key resolves, *before* spawning the daemon proxy,
   with a message pointing at the env var and warning that `-k` leaks via `ps`/shell
   history. `options.ts` `--api-key` help mentions the env-var fallback + caveat.
2. **inspect stderr** — `inspect` passes `stderr: 'inherit'` to `spawnHostedContext`,
   surfacing the server's own diagnostics instead of swallowing them behind "did not
   respond to initialize".
3. **Empty model-list state** — `ModelSelectCard` takes a `provider` prop and renders an
   empty-state ("no models available from <provider> — check the provider is reachable…")
   instead of a blank `Select`.
4. **Flag consistency** (`-p` = provider in chat / port in monitor) — left as a no-op
   note per the audit; acceptable, revisit only if the flag surface is reworked.

## Status

Done. 105 cli unit tests pass (+3 new), typecheck + lint clean, fail-fast verified on the
real binary (exit 1).
