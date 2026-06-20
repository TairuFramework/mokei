# CLI `chat --provider llama` wiring + llama integration tests

**Status:** complete
**Date:** 2026-06-20
**Branch:** feat/llama-cpp-support (commits 492408e..55aaeee)

## Goal

Make `mokei chat --provider llama` work end-to-end (local GGUF inference via
`@mokei/llama-provider` / node-llama-cpp), and add real-GGUF integration tests at
the provider and CLI-e2e levels. Closes the two paired backlog items
(`2026-06-08-cli-chat-llama-wiring`, `2026-02-03-llama-provider-follow-ups`).

## What was built

- **Provider wiring** (`packages/cli/src/chat/providers.ts`): `llama` added to the
  `buildChat` switch. The `-m` flag carries the GGUF filesystem path; a fail-fast
  guard (before the daemon connect) rejects a missing/whitespace-only path. The
  path is trimmed for parity with the interactive card.
- **Model identity** (`llamaModelName` helper): the registry name is the path
  basename with `.gguf` stripped. `ChatApp`'s `initialModel` is that derived name,
  not the raw path — so `listModels()` / the model picker / `/model` work unchanged.
- **UI**: `llama` added to `ProviderSelectCard`; new `LlamaPathCard` (TextInput)
  prompts for the GGUF path. `ChatLauncher` gained an intermediate state step —
  when `provider === 'llama'` and no path is known, it renders the path card,
  then proceeds to `buildChat` with the path injected as the `model` field.
- **Integration tests** (`integration-tests/`, gated on `MOKEI_LLAMA_GGUF`,
  excluded from CI): `llama-provider.test.ts` (listModels, streaming, tool-call
  plumbing) and `cli-chat-llama.test.ts` (PTY-driven CLI e2e — flag-path flow and
  interactive path-card flow). `ChatDriver` extended with `UI.llamaPath` +
  `enterLlamaPath`.

## Key design decisions (from spec)

- **`-m` as the GGUF path with an interactive fallback** — no new flag and no
  config-file mechanism (the CLI has none); the path card covers the omitted case.
- **Path-only MVP** — `gpu`/`contextSize` use node-llama-cpp defaults; no flags for
  them yet.
- **Real-model tests live in `integration-tests/`, gated and out of CI** — keeps CI
  fast/deterministic; no GGUF binary in git, no auto-download.
- **Tool-call assertions are conditional** — small local models don't reliably emit
  tool calls, so the suites assert clean stream termination and validate a tool
  call's name only if one appears.

## Verification

- Final gate: lint clean (changed files), full build green, `pnpm test` green
  (cli 116/116, all packages).
- Final whole-branch review (opus): READY TO MERGE, no Critical/Important.
- Integration suites run live against Qwen2.5-0.5B-Instruct GGUF: provider-level
  3/3, CLI e2e 2/2. The live run surfaced and fixed a test-only race in the CLI
  e2e (waited on the `idle` transition, which can't distinguish pre-turn idle from
  post-turn idle given llama's first-prompt model-load latency; now waits on the
  `●` assistant marker directly). Product code was correct throughout.

## Notes / possible follow-ups (non-blocking)

- Tool-calling is never *positively* asserted (deliberate, to avoid small-model
  flakiness) — a deterministic prompt + soft warning could harden this later.
- `gpu`/`contextSize` flags if local-inference users want tuning.
