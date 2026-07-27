# Integration-test environment + OpenAI-compatible reasoning — complete

**Status:** complete
**Date:** 2026-07-27
**Branch / PR:** `fix/stack-migration-follow-ups` (uncommitted at time of writing)
**Relates to:** `backlog/2026-06-22-stack-migration-follow-ups.md` (both items, now marked done) · `backlog/2026-07-27-cli-reasoning-coverage.md` (follow-on)

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
- **llama.cpp as a second backend.** `LLAMA_SERVER_URL` points the suites at a running
  `llama-server`, taking precedence over ollama. It serves an OpenAI-compatible API only, so
  the suites reach it via `OpenAIProvider` and the CLI via `--provider openai --api-url`.
  Model comes from `/v1/models`, defaulting to `LiquidAI/LFM2.5-1.2B-Thinking-GGUF`.
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
- **Under llama-server the `session` provider matrix collapses to one entry.** Against
  ollama the suite exercises three providers against a single server (native + OpenAI- and
  Anthropic-compatible endpoints); llama-server offers only the OpenAI-compatible one.
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

Full integration suite against a real `llama-server`: 26 passed, 5 skipped (the two
GGUF-gated suites), including the tool-call approval path. With no backend running: 0
failed, 22 skipped — down from 17 failures. Workspace `pnpm test` clean, `tsc` clean, lint
clean. The reasoning mapping has five unit tests, checked non-vacuous by disabling the
mapping (2 fail). Backend resolution, model discovery, the default fallback and the
skip/run gate were each verified against fake servers.

The reasoning change is **unverified against ollama** (none available here) but that
provider's own mapping was not touched.

No ephemeral spec/plan existed for this work — it was scoped from the two items in
`backlog/2026-06-22-stack-migration-follow-ups.md`, both rewritten in place as done.
