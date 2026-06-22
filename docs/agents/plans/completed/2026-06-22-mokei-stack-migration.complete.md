# Mokei stack migration — complete

**Status:** complete (2026-06-22)
**Branch:** `feat/kigu-stack` → PR #35 (https://github.com/TairuFramework/mokei/pull/35)

## Goal

Migrate Mokei onto the post-split upstream stack: adopt `@kigu/dev` shared
tooling, rewrite `@enkaku/*` imports to the split scopes (`@sozai/*` for the
former utility packages + renamed `@enkaku@0.18` transports), and refactor the
hand-rolled daemon/server/CLI plumbing onto the published `@tejika/*` packages.

## What was built

Two sequenced phases, 7 tasks, all on `feat/kigu-stack`:

**Phase A — split + tooling (Tasks 1–3):**
- `@kigu/dev` supplies the shared `biome.json` / `tsconfig.json` / `swc.json`;
  root devDependency toolchain bundle removed (pulled transitively), local
  `swc.json` files deleted, per-package `build:js` repointed at the shared swc
  config.
- `@mokei/cli` output aligned `dist/` → `lib/` to match the other 16 packages
  (bin load paths, scripts, tsconfig, files).
- Mechanical enkaku-split rename codemod: `@enkaku/{async,event,generator,log,
  otel,schema,stream}` → `@sozai/*@0.1`; transports renamed (`node-streams-transport`
  →`node-streams`, `socket-transport`→`socket`, `http-server-transport`→`http-serve`)
  at `@enkaku@0.18`; RPC core (`transport`/`protocol`/`client`/`server`) unchanged.
  Catalog + `minimumReleaseAgeExclude` rewritten accordingly.

**Phase B — tejika refactor (Tasks 4–7):**
- `@mokei/host`: daemon lifecycle (controller/process/socket) → `@tejika/process`
  + `@tejika/env` path/port resolvers (`app: "mokei"`); ContextHost / local-tools
  / proxy kept local.
- `@mokei/host-monitor`: hand-rolled local server + auth (`auth.ts`, `html.ts`) →
  `@tejika/server` (`createLocalServer` + `serveStaticSPA` + loopback/token/Host
  defenses); `pipes.ts` host-protocol stream wiring kept.
- `@mokei/cli`: program/ink/options plumbing → `@tejika/cli`; generic chat
  components → `@tejika/ui` (`ConfirmCard`/`Footer`/`IconLine`/`StatusLine`/
  `SystemNotice`/`SelectCard`); chat-domain components kept local.
- Full-repo build/test/lint + real-binary PTY QA.

## Key design decisions (rationale preserved)

- **Keep the default isolated (symlinked) pnpm linker — do NOT add
  `nodeLinker: hoisted`.** This is the single most important non-obvious
  decision and reverses the kigu/tejika template default. enkaku 0.18's
  `Transport`/`Server` extend a nominal `Disposer` (`#private` brand, from
  `@sozai/async`); the hoisted flat layout splits that brand identity so
  `NodeStreamsTransport` is no longer assignable to `ServerTransport` (TS2322).
  Isolated shares one symlinked copy → the brand stays identical and the type
  build is clean. `@kigu/dev`'s toolchain bins still resolve via
  `node_modules/.bin` under isolated, so nothing is lost.
- **Phase A green before Phase B.** `@tejika/*` consume `@enkaku@0.18`, so split
  adoption is a hard precondition for the CLI refactor.
- **No `@kokuin` / `@kumiai` adoption** — Mokei consumes neither (zero
  `@enkaku/token` deps pre-split).
- **No upstream tejika edits.** Owner keeps `../tejika` hands-off; gaps were
  resolved Mokei-side rather than by patching upstream. Two surfaced in Task 5:
  `serveStaticSPA` injects `window.__APP_TOKEN__` (not configurable) → renamed
  the Mokei frontend global `__MOKEI_TOKEN__` → `__APP_TOKEN__`; `createLocalServer`
  binds loopback `127.0.0.1` only → the monitor `--host` flag was dropped.
- **Cross-repo links use published `^` catalog ranges**, no `link:`/`file:`.
- **Dependency trimming is count-driven** — deps dropped only when a working-tree
  grep showed zero references in the post-edit source, never by assumption.

## User-facing changes

- CLI socket flag renamed `-s, --path` → `-s, --socket-path`.
- Daemon socket default moved `~/.mokei-daemon.sock` →
  `getSocketPath('mokei')` = `<dataDir>/mokei.sock` (XDG-style, matches the host
  daemon's own default).
- Monitor `--host` flag dropped (loopback-only).
- Monitor frontend token global `__MOKEI_TOKEN__` → `__APP_TOKEN__`.

## Verification

Final gates: build 19/19, 570 unit tests + PTY 10/10 green, lint exit 0.
Whole-branch review + `/superpowers:requesting-code-review` both APPROVED; the
two Minor findings fixed (orphan `vite-bundle-analyzer` dropped; the test-only
legacy `startServer` retired → `@enkaku/socket` dropped from `@mokei/host`,
`DEFAULT_SOCKET_PATH` removed).

## Follow-ups (not blocking; see backlog)

- node-pty `spawn-helper` prebuild loses its `+x` bit on every `pnpm install` —
  needs a postinstall to persist it (PTY suites fail `posix_spawnp failed`
  otherwise).
- `session.test.ts > OpenAI provider > executes a tool call` is an unkeyed live
  API test that flakes on network/key absence — should be gated on a key.
