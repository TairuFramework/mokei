# CLI `chat --provider llama`

**Status:** backlog
**Origin:** extracted from `completed/2026-06-06-cli-refactoring.complete.md` non-goals.

## Gap

`@mokei/llama-provider` (local GGUF via node-llama-cpp) ships as a library, but
the CLI `mokei chat` only exposes `ollama` / `openai` / `anthropic`. The Ink +
commander refactor explicitly listed `chat llama` wiring as a non-goal, so the
local-model path is unreachable from the CLI.

## Scope

- Add `llama` to the `--provider` flag options and `ProviderSelectCard`.
- Build the llama `Session` in `ChatLauncher` (model/GGUF path resolution —
  llama needs a model file, unlike the URL-based providers).
- Decide how the model path / params are supplied (flag vs interactive vs
  config).
- e2e: extend `ChatDriver` coverage if feasible without bundling a GGUF.

## Notes

- Pairs naturally with the existing backlog item
  `2026-02-03-llama-provider-follow-ups.md` (integration tests) — both exercise
  the real llama path end-to-end.
