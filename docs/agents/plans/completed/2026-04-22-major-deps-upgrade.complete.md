# Major Dependency Upgrade: TypeScript 6, Vite 8, Mantine 9

**Status:** complete
**Date completed:** 2026-04-22
**Branch:** `chore/dependencies-update`

## Goal

Upgrade three major-version dependencies in a single unified branch, folding in the existing in-progress minor/patch bumps:

- TypeScript `^5.9.3` → `^6.0.3` (lifted into workspace catalog)
- Vite `^7.3.1` → `^8.0.9`
- Mantine (`@mantine/core`, `@mantine/hooks`) `^8.3.16` → `^9.1.0`

## Key design decisions

- **Layered commits over one squash.** Four commits on `chore/dependencies-update`, each independently verifiable via `pnpm build && pnpm test && pnpm lint`, so `git bisect` stays useful. Squash fallback reserved for blocker conditions only (never triggered).
- **Fold WIP bumps in.** Minor/patch catalog bumps (biome, enkaku, oclif, swc, tanstack, turbo, vitest) and `@hono/node-server` v1→v2 landed as Layer 1 of the same branch rather than a separate PR.
- **TypeScript lifted into the workspace catalog.** Single source of truth for all non-website packages. `website/` stays pinned at `~5.9.3` because `@docusaurus/tsconfig` constrains it.
- **tsconfigs aligned to enkaku convention.** Root `tsconfig.build.json`: `target: es2025`, `module: nodenext`, `moduleResolution: nodenext`, `lib: [es2025]`. Per-package tsconfigs extend this, adding `lib: [es2025, dom]` or `types: [node]` only where source references those globals. TS 6 also made `rootDir` required (TS5011) — added `rootDir: ./src` to every workspace package tsconfig.
- **Monitor React plugin swap.** `@vitejs/plugin-react-swc` → `@vitejs/plugin-react` to match enkaku and guarantee timely Vite-8 peer support.
- **Mantine 9 required no monitor source changes.** Monitor's usage (AppShell, MantineProvider, createTheme, Group, Image, Title, Badge) is forward-compatible.

## What was built

Four commits on `chore/dependencies-update` (newest first):

- `61a32c5` chore(deps): bump Mantine to v9 — catalog-only
- `ec106ae` chore(deps): bump Vite to v8 and swap to @vitejs/plugin-react
- `48bfa9b` chore(deps): bump TypeScript to v6 in catalog and align tsconfigs (31 files — tsconfigs across all 22 workspace packages + `@types/node` added where node builtins are referenced)
- `a93f451` chore(deps): bump minor/patch catalog versions and @hono/node-server v2

## Verification

- `pnpm install --frozen-lockfile` clean
- `pnpm build` green (18 tasks)
- `pnpm test` green (41 tests in session, type checks in cli/session)
- `pnpm lint` clean
- `pnpm --filter monitor exec tsc -b` green
- `pnpm --filter monitor exec vite build` green (Vite 8.0.9, 575 kB main chunk, built in 1.16s)

Branch not yet pushed. Push + PR when user requests.
