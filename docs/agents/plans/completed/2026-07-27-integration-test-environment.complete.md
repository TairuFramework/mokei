# Integration-test environment + OpenAI-compatible reasoning — complete

**Status:** complete
**Date:** 2026-07-27
**Branch / PR:** `fix/stack-migration-follow-ups` → [PR #39](https://github.com/TairuFramework/mokei/pull/39)
**Relates to:** `completed/2026-06-22-mokei-stack-migration.complete.md` (the migration these were deferred from, PR #35) · `backlog/2026-07-27-cli-reasoning-coverage.md` (follow-on)

## Goal

Make `integration-tests` a trustworthy signal. It was returning 17 failures on a normal dev
machine — none of them regressions — which meant the suite had to be eyeballed rather than
read. Clearing that exposed a real provider bug, fixed here too.

## What was built

- **node-pty `spawn-helper` permissions.** `scripts/fix-node-pty-permissions.mjs`, wired as
  the root `postinstall`, adds the executable bit the prebuild ships without and every
  `pnpm install` resets. Without it the PTY suites die with `posix_spawnp failed`.
- **Backend gating.** `integration-tests/support/requirements.ts` resolves a chat backend at
  module scope and exposes `hasChatBackend`; `session`, `agent`, `host` and `cli-chat*` skip
  instead of failing when nothing is running.
- **llama.cpp as the default backend, ollama as the alternative.** Resolution order is
  `LLAMA_SERVER_URL` → `OLLAMA_HOST` → a llama-server on `127.0.0.1:8080` → ollama. Suites
  reach llama.cpp via `OpenAIProvider` / `AnthropicProvider` and the CLI via
  `--provider openai --api-url`. Model comes from `/v1/models`, preferring an LFM2.5 entry
  when several are served (`llama serve` routes to many), then the first listed, then
  `LiquidAI/LFM2.5-1.2B-Thinking-GGUF`.
- **`@mokei/openai-provider` reasoning support.** `delta.reasoning_content` (DeepSeek, vLLM,
  llama.cpp) and `delta.reasoning` (OpenRouter) now stream as `reasoning-delta`, and
  `aggregateMessage` accumulates it — previously dropped entirely, so the CLI's reasoning
  view was dead on every OpenAI-compatible backend.
- **`integration-tests/README.md`** — requirements per suite, backend setup, env vars, and
  the two gotchas found the hard way (below).

## Key design decisions

- **Skip, don't fail, on a missing backend.** A partial environment should still give a
  meaningful result. The probe runs at module scope because `describe.skipIf` needs its
  value at collection time.
- **Env vars stay vendor-native.** `OLLAMA_HOST` is ollama's own variable and
  `LLAMA_SERVER_URL` matches it in shape, so an already-configured machine needs no
  mokei-specific setup. `MOKEI_*` is reserved for what only mokei defines — which is why
  `MOKEI_LLAMA_GGUF` (a local GGUF path for the in-process node-llama-cpp provider, an
  entirely different thing from the llama.cpp HTTP server) keeps its prefix.
- **One backend descriptor, not scattered probes.** `chatBackend` carries the URLs, model,
  CLI provider and CLI API URL, so a suite never re-derives them and `ChatDriver` can apply
  them as defaults. An explicitly-passed `provider` opts out, so the GGUF suite does not
  inherit an API URL and key that do not belong to it.
- **Both backends serve both compatibility endpoints.** llama.cpp implements a real
  Anthropic Messages API at `/v1/messages`, not just `/v1/chat/completions`, so the
  `session` matrix runs `OpenAIProvider` and `AnthropicProvider` against either backend;
  ollama adds a third entry for its native API, which llama-server has no equivalent of.
- **`--jinja` is required for llama.cpp.** Without it llama.cpp parses no tool calls, so
  every suite asserting one fails while the rest pass — a failure easily misread as a mokei
  bug. Documented prominently rather than detected, since probing for it means issuing a
  tool-carrying completion at startup.
- **Tool-choice flakiness is handled with retries, not weaker assertions.** The prompt now
  names the tool outright (these suites test the tool-call plumbing, not the model's
  judgement), and the assertions that still depend on the model choosing to call it retry
  twice. A 1.2B model answers from memory now and then; dropping the assertion would stop
  testing the tool path. Applied per-test rather than in the vitest config so a
  deterministic suite cannot quietly become flaky.
- **`thinking…` is a backend artifact, so the ESC test no longer asserts it.** The CLI shows
  that state only when reasoning arrives as a *separate channel*. llama.cpp streams `<think>`
  tags inline in `content` for the LFM2.5 template no matter what `--reasoning-format`,
  `--jinja` or `--reasoning on` say — verified directly on the wire — so the state is
  unreachable there. The test was renamed to `esc cancels a turn in flight` and waits on
  `thinking…` **or** `· streaming` via `ChatDriver.waitForActive()`. Cancel behaviour itself
  is asserted exactly as before. This is deliberately a weaker precondition on ollama; the
  alternative was a suite that cannot run on llama.cpp at all.

## Findings worth keeping

- **`localhost` vs `127.0.0.1` matters.** Anything holding `*:8080` (VLC, in this case) wins
  the IPv6 lookup ahead of a `llama-server` bound to `127.0.0.1:8080`. The probe then hits
  the wrong server, `available` is false, and every suite silently skips — a run that looks
  clean while testing nothing.
- **The original backlog item was wrong about the cause.** It described a test hitting the
  live OpenAI API and wanted an `OPENAI_API_KEY` guard. No test hits a hosted API: the
  "OpenAI" and "Anthropic" entries in `session.test.ts` both point at ollama's compatibility
  endpoints. The real gap was every model-backed suite hard-failing with no local server.

## Status / verification

Full integration suite against a real `llama-server` (`--jinja`): 27 passed, 5 skipped (the
two GGUF-gated suites), including the tool-call approval path and both compatibility
providers. Three of the last four consecutive full runs were clean, the fourth losing a
single tool-choice assertion that passed on re-run — the retries above absorb that. With no
backend running: 0 failed, 21 skipped — down from 17 failures. Workspace `pnpm test` clean,
`tsc` clean, lint clean. The reasoning mapping has five unit tests, checked non-vacuous by
disabling the mapping (2 fail). Backend resolution, the LFM2.5-preferring model selection,
the first-listed and hardcoded fallbacks, and the skip/run gate were each verified against
fake servers.

The reasoning change is **unverified against ollama** (none available here) but that
provider's own mapping was not touched.

No ephemeral spec/plan existed for this work. It was scoped from the two items in the
stack-migration follow-ups backlog entry — persist the node-pty `spawn-helper` executable
bit, and gate the model-backed suites — both of which shipped here, so that entry was
removed and this summary is the record.
