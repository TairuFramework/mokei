# Stack migration follow-ups — **done 2026-07-27**

Low-priority items surfaced during the `feat/kigu-stack` migration (PR #35).
Neither blocked the migration; both were pre-existing tooling/test gaps.
Shipped on `fix/stack-migration-follow-ups`; see
`completed/2026-07-27-integration-test-environment.complete.md`.

## 1. Persist node-pty `spawn-helper` executable bit — done

The integration PTY suites fail with `posix_spawnp failed` whenever
`node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`
lacks `+x`. The prebuild ships without the executable bit and every
`pnpm install` resets it, so a manual `chmod +x` is ephemeral.

**Fixed by** a root `postinstall` running `scripts/fix-node-pty-permissions.mjs`, which
scans the pnpm store for node-pty prebuilds and adds the bit. Idempotent, silent when
node-pty is absent or already executable.

## 2. Gate the model-backed integration suites — done

*The original description was wrong on one point:* the failing test does not hit the live
OpenAI API. It lives in `integration-tests/suites/session.test.ts`, and its "OpenAI"
provider entry points at **ollama's** OpenAI-compatibility endpoint
(`localhost:11434/v1`) — as does the "Anthropic" entry. So the real gap was that every
model-backed suite (`session`, `agent`, `host`, `cli-chat*`) hard-failed when no local
inference server was running, not an API-key guard.

**Fixed by** `integration-tests/support/requirements.ts`, which resolves a chat backend at
module scope and exposes `hasChatBackend` for `describe.skipIf`. It also added a second
supported backend: set `LLAMA_SERVER_URL` to a running llama.cpp `llama-server` and
the suites use it instead of ollama (OpenAI-compatible API, model discovered from
`/v1/models`, default `LiquidAI/LFM2.5-1.2B-Thinking-GGUF`). Documented in
`integration-tests/README.md`.

Running the suites against llama.cpp then surfaced a real defect: `@mokei/openai-provider`
dropped reasoning entirely, so the CLI's thinking view was dead on every OpenAI-compatible
backend. Fixed in the same branch; remaining coverage gaps are in
`2026-07-27-cli-reasoning-coverage.md`.
