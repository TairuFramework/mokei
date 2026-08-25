# Verify RN Metro bundle and cut the major release for the host `-node` split

**Status:** next
**Follows:** `docs/agents/plans/completed/2026-08-25-host-rn-bundler-safe-entry.complete.md`
**Priority:** unblocks the Sakui mobile app and publishes the breaking split.

The host / context-server RN-safe split is implemented, tested, and merged-ready (see the
completed summary). Two things remain, both outside the code change itself.

## 1. Real Metro/Hermes acceptance gate (authoritative)

The in-repo `packages/host/test/rn-bundle.test.ts` guard is a static import-graph tripwire — it
does not exercise Metro resolution, third-party dependency graphs, or every dynamic
import/require form. The design's true acceptance criterion is a real bundle.

- From the Sakui repo `apps/mobile`, use the built (or locally linked) `@mokei/host` /
  `@mokei/context-server`, ensuring `@sakui/runtime`'s `contexts-manager.ts` imports resolve to
  the trimmed `@mokei/host`.
- Run `pnpm exec expo export --platform ios --output-dir dist`. It must complete with **no**
  `node:url` / `@tejika/process` / `@enkaku/node-streams` resolution error.
- If it still fails, capture the exact unresolved specifier + file. A leak reached through a
  third-party dep (`@enkaku/*`, `@sozai/*`) that the static guard cannot see needs an upstream
  fix — file it as an Enkaku ask in the `../enkaku` checkout per repo convention. Do **not**
  re-add a Node dep to the RN barrels to paper over it.

## 2. Cut the major release

This is a breaking change. Two new packages (`@mokei/host-node`, `@mokei/context-server-node`)
join the fixed release group in `pnpm-workspace.yaml`.

- Record a **major** release intent per the `kigu:releasing` skill (`pnpm change`), then preview
  with `pnpm change status` — the whole fixed group, including the two new packages at their
  initial version, should move to the next major together.
- Changelog / breaking-change note to include: consumers importing `addLocalContext` (now a
  method on `NodeContextHost`), `spawnHostedContext`, `createClient`, `runDaemon`, or `ProxyHost`
  from `@mokei/host` must switch to `@mokei/host-node`; and `serveProcess` from
  `@mokei/context-server` moves to `@mokei/context-server-node`.
- Apply and publish (`pnpm version -r`, then the release flow) once the Metro gate above passes.
