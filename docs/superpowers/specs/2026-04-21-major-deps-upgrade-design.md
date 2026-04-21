# Major Dependency Upgrade: TypeScript 6, Vite 8, Mantine 9

**Date:** 2026-04-21
**Status:** Design approved, pending implementation plan

## Goal

Upgrade three major-version dependencies in a single unified branch, folding in the existing in-progress minor/patch bumps:

- **TypeScript**: `^5.9.3` → `^6.x` (lifted into workspace catalog)
- **Vite**: `^7.3.1` → `^8.x`
- **Mantine** (`@mantine/core`, `@mantine/hooks`, `postcss-preset-mantine`): `^8.3.16` → `^9.x`

The enkaku sibling repository (`../enkaku`) has already adopted TypeScript 6 and Vite 8 — its catalog and `tsconfig.build.json` are the reference for mokei's conventions.

## Non-goals

- **Website TypeScript bump.** `website/` is constrained by `@docusaurus/tsconfig` and stays on `~5.9.3`.
- **Feature work.** This is a dependency/configuration change only.
- **Stray test artifact.** `packages/cli/my_new_database.db` is an unrelated test output — flag separately, do not clean up as part of this work.

## Decisions

| Question | Decision |
|----------|----------|
| Handle WIP minor bumps separately or fold in? | Fold in (one unified branch) |
| TypeScript upgrade scope? | Lift `typescript` into catalog; bump all non-website consumers to v6 |
| tsconfig target/module/lib? | Match enkaku exactly: `target: es2025`, `module: nodenext`, `moduleResolution: nodenext`, `lib: [es2025]` |
| Monitor Vite React plugin? | Switch from `@vitejs/plugin-react-swc` to `@vitejs/plugin-react` (match enkaku) |
| Commit sequencing? | Layered commits, verify between each (fallback to single squashed commit on blocker) |

## Current state reference

TypeScript usages (pre-change):

- `package.json` (root devDeps): `"typescript": "^5.9.3"`
- `packages/cli/package.json` (devDeps): `"typescript": "^5.9.3"`
- `monitor/package.json` (devDeps): `"typescript": "~5.9.3"`
- `website/package.json` (devDeps): `"typescript": "~5.9.3"` *(out of scope)*

Root `tsconfig.build.json` (pre-change):

```json
{
  "compilerOptions": {
    "allowSyntheticDefaultImports": true,
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "lib": ["dom", "es2022"],
    "module": "es2022",
    "moduleResolution": "nodenext",
    "strict": true,
    "target": "es2022"
  }
}
```

Catalog versions being bumped (from `pnpm-workspace.yaml`):

- `vite: ^7.3.1` → `^8.x`
- `@mantine/core: ^8.3.16` → `^9.x`
- `@mantine/hooks: ^8.3.16` → `^9.x`
- `postcss-preset-mantine: ^1.18.0` → latest v9-compatible
- `@tabler/icons-react: ^3.41.1` → latest v9-compatible (bump with Mantine as a set)
- `@vitejs/plugin-react-swc: ^4.3.0` → **removed**
- `@vitejs/plugin-react` → **added**, track enkaku's `^6.0.1` or latest

The existing uncommitted WIP diff (minor/patch bumps of biome, enkaku, hono-node-server v1→v2, oclif, swc, tanstack-router, turbo, vitest, etc.) is carried into Layer 1 of the implementation.

## Implementation layers

### Layer 1 — WIP minor/patch bumps

Already staged in working tree: `package.json` + `pnpm-workspace.yaml`.

Actions:
- `@hono/node-server` v1 → v2 is a real major — audit `packages/http-server/` for breaking API surface; fix inline before committing.
- Refresh `pnpm-lock.yaml` via `pnpm install`.

Commit: `chore(deps): bump minor/patch catalog versions and @hono/node-server v2`

Verification: `pnpm install && pnpm build && pnpm test && pnpm lint`

### Layer 2 — TypeScript 6

Actions:

1. Add `typescript: ^6.x` (latest patch at implementation time) to catalog in `pnpm-workspace.yaml`.
2. Replace `"typescript": "^5.9.3"` / `"~5.9.3"` with `"typescript": "catalog:"` in:
   - `package.json` (root devDeps)
   - `packages/cli/package.json` (devDeps)
   - `monitor/package.json` (devDeps)
3. Leave `website/package.json` untouched.
4. Update `tsconfig.build.json` to:
   ```json
   {
     "compilerOptions": {
       "allowSyntheticDefaultImports": true,
       "declaration": true,
       "declarationMap": true,
       "esModuleInterop": true,
       "lib": ["es2025"],
       "module": "nodenext",
       "moduleResolution": "nodenext",
       "strict": true,
       "target": "es2025"
     }
   }
   ```
   (Drops `dom` from the base — monitor's `tsconfig.app.json` already declares `lib: [ES2025, DOM, DOM.Iterable]`; server packages do not need DOM.)
5. Review monitor `tsconfig.app.json` + `tsconfig.node.json` and align targets/libs to `es2025` where it does not conflict with Vite's expected runtime.
6. Fix any type errors surfaced by TS 6 inline. If errors are bounded to specific packages, split fixes into sub-commits within Layer 2.

Commit: `chore(deps): upgrade typescript to 6, align tsconfigs to es2025/nodenext`

Verification: `pnpm build && pnpm test:types && pnpm test`

### Layer 3 — Vite 8 + plugin swap

Actions:

1. Catalog: `vite: ^8.x`.
2. Catalog: remove `@vitejs/plugin-react-swc`, add `@vitejs/plugin-react` (track enkaku's version).
3. `monitor/package.json`: update devDep — replace `@vitejs/plugin-react-swc` with `@vitejs/plugin-react`.
4. `monitor/vite.config.ts`: swap the import.
5. Audit Vite-8 peer compatibility for:
   - `vite-bundle-analyzer` — bump if needed.
   - `@tanstack/router-plugin/vite` — bump if needed.
   If either lacks Vite-8 support at implementation time, halt Layer 3 (see fallback).

Commit: `chore(deps): upgrade vite to 8, switch monitor to @vitejs/plugin-react`

Verification: `pnpm --filter monitor build` + smoke-test `pnpm --filter monitor dev` (load in browser, confirm routes render, confirm HMR works).

### Layer 4 — Mantine 9

Actions:

1. Catalog: bump `@mantine/core`, `@mantine/hooks`, `postcss-preset-mantine`, `@tabler/icons-react` to their latest v9-compatible versions as a set.
2. Apply the Mantine v9 migration guide to `monitor/src/`. The exact source changes are not enumerated here — they are bounded by whatever the migration guide lists and are discovered during implementation.

Commit: `chore(deps): upgrade mantine to 9`

Verification: `pnpm --filter monitor build` + browser smoke test of the monitor UI (render every page, confirm no styling regressions or runtime errors in the console).

## Risks and fallback

| Layer | Risk | Handling |
|-------|------|----------|
| 1 | `@hono/node-server` v2 breaks `packages/http-server` | Read v2 changelog, fix API usage before committing Layer 1 |
| 2 | TS 6 type errors spread across many packages (likely culprits: stricter `erasableSyntaxOnly`, `verbatimModuleSyntax`, changes to enum handling) | Fix inline; if bounded, split per-package sub-commits; if unbounded, abort Layer 2 |
| 2 | `nodenext` module resolution requires `.js` extensions in import specifiers | Audit source; SWC output already uses `.js` extensions — source style should already be compatible |
| 3 | `@vitejs/plugin-react` differs from `plugin-react-swc` in HMR / Babel transform behavior | Smoke test monitor dev server; config diff is minimal (just the import) |
| 3 | `vite-bundle-analyzer` or `@tanstack/router-plugin` missing Vite 8 peer support | Halt Layer 3; defer to future PR; ship Layers 1 + 2 only |
| 4 | Mantine v9 API breaks in monitor UI exceed budget | Halt Layer 4; defer to future PR |

**Squash fallback.** If one layer blocks bisect usefulness (e.g., type errors fixed in Layer 2 depend on Layer 4 changes), squash completed layers into a single commit and document the reason in the commit body.

**Abort conditions.** If a layer cannot be completed cleanly:
- Vite 8 ecosystem peers missing → defer Layers 3 and 4, ship Layers 1 and 2 only.
- TS 6 type errors unbounded → defer Layer 2 (and therefore 3 and 4), ship Layer 1 only.

## Deliverables

- Updated `pnpm-workspace.yaml` (catalog) and `pnpm-lock.yaml`.
- Updated `package.json`, `packages/cli/package.json`, `monitor/package.json`.
- Updated `tsconfig.build.json` and monitor tsconfigs where aligned.
- Updated `monitor/vite.config.ts`.
- Source fixes in packages where TS 6 surfaces type errors.
- Source fixes in `monitor/src/` where Mantine 9 migration requires them.
- One commit per layer (fallback: single squashed commit with rationale).
