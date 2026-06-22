# Stack migration follow-ups

Low-priority items surfaced during the `feat/kigu-stack` migration (PR #35).
Neither blocks the migration; both are pre-existing tooling/test gaps.

## 1. Persist node-pty `spawn-helper` executable bit

The integration PTY suites fail with `posix_spawnp failed` whenever
`node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`
lacks `+x`. The prebuild ships without the executable bit and every
`pnpm install` resets it, so a manual `chmod +x` is ephemeral.

**Fix:** add a postinstall step (root or a small script) that `chmod +x`es the
prebuilt `spawn-helper` after install, so the PTY-based real-stdio QA runs
without manual intervention.

## 2. Gate the live OpenAI integration test

`packages/session/.../session.test.ts > OpenAI provider > executes a tool call`
hits the live OpenAI API and times out (20s) when no key / no network is
present — it is not a migration regression (session unit suite 59/59 pass).

**Fix:** skip/gate the test on an `OPENAI_API_KEY` guard (or move it behind an
explicit live-integration flag) so the default `pnpm test` stays deterministic.
