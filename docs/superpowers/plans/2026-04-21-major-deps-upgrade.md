# Major Dependency Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade TypeScript to 6, Vite to 8, and Mantine to 9 in a single branch, folding in the in-progress minor/patch bumps and `@hono/node-server` v1→v2.

**Architecture:** Four layered commits on branch `chore/dependencies-update`, each independently verifiable via `pnpm build && pnpm test && pnpm lint`. Layer 1 finishes the existing WIP bumps. Layer 2 lifts `typescript` into the workspace catalog and aligns tsconfigs to enkaku's conventions (`es2025` / `nodenext`). Layer 3 bumps Vite and swaps the monitor React plugin (`@vitejs/plugin-react-swc` → `@vitejs/plugin-react`). Layer 4 bumps Mantine. If any layer blocks on unbounded breakage, abort that layer and ship the earlier ones.

**Tech Stack:** pnpm workspaces with catalog, TypeScript, Vite, Mantine, React, enkaku, hono.

**Spec:** `docs/superpowers/specs/2026-04-21-major-deps-upgrade-design.md`

---

## File Structure

Files modified across the plan:

- `pnpm-workspace.yaml` — catalog entries (all three layers)
- `pnpm-lock.yaml` — regenerated after each catalog change via `pnpm install`
- `package.json` (root) — drop per-package TypeScript, use catalog reference
- `packages/cli/package.json` — same
- `monitor/package.json` — TypeScript catalog ref, swap Vite React plugin dep
- `tsconfig.build.json` (root) — target/module/lib changes for TS 6
- `monitor/tsconfig.app.json`, `monitor/tsconfig.node.json` — align with root where safe
- `monitor/vite.config.ts` — import swap to `@vitejs/plugin-react`
- Source files in `packages/http-server/` — only if `@hono/node-server` v2 forces API changes
- Source files across packages — only if TS 6 surfaces type errors
- Source files in `monitor/src/` — only if Mantine 9 migration requires

No new files are created by this plan.

---

## Task 1: Baseline check

**Files:** none (environment verification)

- [ ] **Step 1: Confirm branch and working tree state**

Run: `git status && git branch --show-current`

Expected: On branch `chore/dependencies-update`. Working tree contains the pre-existing WIP changes (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`) plus possibly the untracked `packages/cli/my_new_database.db`.

If not on `chore/dependencies-update`, switch: `git switch chore/dependencies-update`.

- [ ] **Step 2: Record baseline package versions**

Run: `pnpm list --depth 0 -r 2>/dev/null | head -100`

Save the output somewhere (scratchpad or tmp file). This is the rollback reference if a layer fails.

- [ ] **Step 3: Verify tests pass at baseline**

Run: `pnpm install && pnpm build && pnpm test && pnpm lint`

Expected: all green. If anything fails *before* we start, stop and surface the failure — it is not caused by this plan.

---

## Task 2: Layer 1 — WIP minor bumps and @hono/node-server v2

**Files:**
- Already modified in working tree: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- Possibly modify: source files in `packages/http-server/` if v2 forces API changes

- [ ] **Step 1: Review the currently staged WIP diff**

Run: `git diff package.json pnpm-workspace.yaml`

Read carefully. Confirm the diff matches the expected scope: minor/patch bumps across biome, enkaku, oclif, swc, tanstack, turbo, vitest, etc., plus `@hono/node-server` major `^1.19.11` → `^2.0.0`.

- [ ] **Step 2: Read `@hono/node-server` v2 changelog**

Fetch the v2 release notes:

Run: `gh api repos/honojs/node-server/releases 2>/dev/null | head -200` or `open https://github.com/honojs/node-server/releases`

Identify breaking changes. Note any API changes that affect mokei.

- [ ] **Step 3: Audit `packages/http-server` for v2 usage**

Run Grep: `@hono/node-server` in `packages/http-server/src/`.

For each match, compare against the v2 breaking changes from Step 2. If an API being used has changed, the source needs updating.

- [ ] **Step 4: Fix any `@hono/node-server` v2 breaks**

Edit the affected files. Keep fixes minimal: adapt to the new API surface, nothing else.

If no changes are needed, skip this step.

- [ ] **Step 5: Refresh the lockfile**

Run: `pnpm install`

Expected: updates `pnpm-lock.yaml` to reflect the catalog bumps. No errors.

- [ ] **Step 6: Run full verification**

Run: `pnpm build`
Expected: all packages build cleanly.

Run: `pnpm test`
Expected: all tests pass.

Run: `pnpm lint`
Expected: clean.

If any step fails, fix inline. Do not proceed to commit until all three are green.

- [ ] **Step 7: Commit Layer 1**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml
# Plus any http-server source fixes from Step 4
git commit -m "$(cat <<'EOF'
chore(deps): bump minor/patch catalog versions and @hono/node-server v2

Folds the in-progress workspace minor bumps (biome, enkaku, oclif,
swc, tanstack, turbo, vitest, etc.) into a single commit, including
the @hono/node-server v1 to v2 major bump.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Layer 2a — Lift TypeScript into catalog, bump to 6

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json` (root)
- Modify: `packages/cli/package.json`
- Modify: `monitor/package.json`

- [ ] **Step 1: Find the latest TypeScript 6.x version**

Run: `pnpm view typescript versions --json | tail -20`

Identify the latest stable `6.x.y` release. Record it (e.g. `6.0.2` or whatever is current).

- [ ] **Step 2: Add `typescript` to the catalog**

Edit `pnpm-workspace.yaml`. In the `catalog:` block, add an entry in alphabetical order (between `turndown-plugin-gfm` and `typedoc`):

```yaml
  typescript: ^6.x.y   # use actual version from Step 1
```

- [ ] **Step 3: Replace root TypeScript devDep with catalog reference**

In `package.json` (root), change the devDeps entry:

```json
"typescript": "^5.9.3"
```

to:

```json
"typescript": "catalog:"
```

- [ ] **Step 4: Replace cli TypeScript devDep with catalog reference**

In `packages/cli/package.json`, change:

```json
"typescript": "^5.9.3"
```

to:

```json
"typescript": "catalog:"
```

- [ ] **Step 5: Replace monitor TypeScript devDep with catalog reference**

In `monitor/package.json`, change:

```json
"typescript": "~5.9.3"
```

to:

```json
"typescript": "catalog:"
```

- [ ] **Step 6: Leave website untouched**

Confirm `website/package.json` still contains `"typescript": "~5.9.3"` and is not modified. Docusaurus pins TypeScript.

- [ ] **Step 7: Refresh the lockfile**

Run: `pnpm install`
Expected: lockfile updates to TS 6.x across root, cli, monitor.

- [ ] **Step 8: Verify TS 6 is resolved everywhere expected**

Run: `pnpm why typescript`
Expected: root, `packages/cli`, and `monitor` resolve to the new TS 6 version. `website` resolves to `~5.9.3`.

---

## Task 4: Layer 2b — Update root tsconfig.build.json

**Files:**
- Modify: `tsconfig.build.json`

- [ ] **Step 1: Apply the new tsconfig.build.json**

Overwrite `tsconfig.build.json` with:

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

Diff from previous: `target` `es2022` → `es2025`, `module` `es2022` → `nodenext`, `lib` `[dom, es2022]` → `[es2025]`.

- [ ] **Step 2: Run type check to surface breaks**

Run: `pnpm -r build:types`
Expected: likely fails in some packages. Capture the first ten or so error messages.

If the run is clean, skip Task 5 and proceed.

---

## Task 5: Layer 2c — Fix TypeScript 6 / es2025 / nodenext type errors

**Files:** only source files flagged by `pnpm -r build:types` output; the set is bounded by that command's error report.

This task is iterative. Do not try to plan every fix up front — the fixes are bounded by what `pnpm -r build:types` reports.

- [ ] **Step 1: Collect the full error list**

Run: `pnpm -r build:types 2>&1 | tee /tmp/ts6-errors.log`

Open the log. Group errors by package.

- [ ] **Step 2: Categorize the errors**

For each error, decide which bucket it falls in:

- **A — DOM globals missing:** package used `fetch`, `URL`, `Response`, `AbortController`, etc. from the old base `lib: [dom]`. Fix: add a package-local `tsconfig.json` override or rely on `@types/node` (Node 22 provides these globals typed via `@types/node`).
- **B — `nodenext` import extension required:** a `.ts` import without `.js` extension. Fix: update the import specifier.
- **C — ES2025 syntax change:** rare — new stricter parsing or a dropped lib type. Fix per TypeScript 6 migration guide.
- **D — Real type error unrelated to the bump:** treat as pre-existing bug to fix.

- [ ] **Step 3: Fix errors package by package**

For each affected package:

1. Edit source or tsconfig.
2. Re-run `pnpm --filter <pkg-name> build:types` until clean.
3. Move to next package.

If a single package has more than ~15 errors, surface it before continuing — it may signal the bump is unsafe and we should abort Layer 2.

- [ ] **Step 4: Re-run the full type check**

Run: `pnpm -r build:types`
Expected: all packages clean.

- [ ] **Step 5: Run the unit tests**

Run: `pnpm -r test:unit 2>/dev/null || pnpm test`
Expected: all tests pass.

---

## Task 6: Layer 2d — Align monitor tsconfigs

**Files:**
- Modify: `monitor/tsconfig.app.json`
- Modify: `monitor/tsconfig.node.json`

- [ ] **Step 1: Update monitor/tsconfig.app.json target and lib**

Edit `monitor/tsconfig.app.json`. Change:

```json
"target": "ES2020",
...
"lib": ["ES2020", "DOM", "DOM.Iterable"],
```

to:

```json
"target": "ES2025",
...
"lib": ["ES2025", "DOM", "DOM.Iterable"],
```

Leave everything else (moduleResolution `bundler`, `allowImportingTsExtensions`, `jsx`, `strict` flags) unchanged.

- [ ] **Step 2: Update monitor/tsconfig.node.json target and lib**

Edit `monitor/tsconfig.node.json`. Change:

```json
"target": "ES2022",
...
"lib": ["ES2023"],
```

to:

```json
"target": "ES2025",
...
"lib": ["ES2025"],
```

- [ ] **Step 3: Type check the monitor app**

Run: `pnpm --filter monitor build`
Expected: clean build.

If errors surface, they are bounded by the monitor source. Fix inline. If unbounded, revert Step 1/Step 2 (leave monitor on ES2022) and note in the commit body.

- [ ] **Step 4: Commit Layer 2**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml package.json packages/cli/package.json monitor/package.json tsconfig.build.json monitor/tsconfig.app.json monitor/tsconfig.node.json
# Plus any source fixes from Task 5
git commit -m "$(cat <<'EOF'
chore(deps): upgrade typescript to 6, align tsconfigs to es2025/nodenext

Lifts typescript into the workspace catalog (single source of truth
except website, which stays pinned by @docusaurus/tsconfig). Bumps
root tsconfig.build.json to es2025/nodenext to match enkaku. Aligns
monitor tsconfigs to es2025 where compatible.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Layer 3a — Vite 8 catalog bump and peer audit

**Files:**
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Find the latest Vite 8.x version**

Run: `pnpm view vite versions --json | tail -20`

Record the latest stable `8.x.y`.

- [ ] **Step 2: Find the latest @vitejs/plugin-react version**

Run: `pnpm view @vitejs/plugin-react versions --json | tail -20`

Record the latest major (expected `^6.x` or higher based on enkaku's `^6.0.1`).

- [ ] **Step 3: Check vite-bundle-analyzer Vite 8 compat**

Run: `pnpm view vite-bundle-analyzer peerDependencies`
Expected: peer `vite` range includes `^8`. If not, run `pnpm view vite-bundle-analyzer versions --json | tail -20` and find the first version whose peer accepts Vite 8.

If no version of `vite-bundle-analyzer` supports Vite 8 at implementation time: **abort Layer 3**. Ship only Layers 1 + 2. Open a follow-up issue noting the block.

- [ ] **Step 4: Check @tanstack/router-plugin Vite 8 compat**

Run: `pnpm view @tanstack/router-plugin peerDependencies`
Expected: peer `vite` range includes `^8`. If not, find the first Vite-8-compatible version.

Same abort rule as Step 3 if no version supports Vite 8.

- [ ] **Step 5: Update the catalog**

Edit `pnpm-workspace.yaml`. Apply these changes in the `catalog:` block:

1. Change `vite: ^7.3.1` → `vite: ^8.x.y` (from Step 1).
2. Remove `'@vitejs/plugin-react-swc': ^4.3.0`.
3. Add `'@vitejs/plugin-react': ^6.x.y` (from Step 2), in alphabetical order.
4. If Step 3 required a bump, update `vite-bundle-analyzer:` to the compatible version.
5. If Step 4 required a bump, update `'@tanstack/router-plugin':` to the compatible version.

---

## Task 8: Layer 3b — Swap monitor React plugin

**Files:**
- Modify: `monitor/package.json`
- Modify: `monitor/vite.config.ts`

- [ ] **Step 1: Swap the monitor devDep**

In `monitor/package.json`, remove:

```json
"@vitejs/plugin-react-swc": "catalog:",
```

and add:

```json
"@vitejs/plugin-react": "catalog:",
```

- [ ] **Step 2: Swap the vite.config.ts import**

Edit `monitor/vite.config.ts`. Change:

```ts
import react from '@vitejs/plugin-react-swc'
```

to:

```ts
import react from '@vitejs/plugin-react'
```

Leave the `plugins: [tanStackRouter(), react(), analyzer()]` usage unchanged — both plugins expose the same default-callable factory.

- [ ] **Step 3: Refresh the lockfile**

Run: `pnpm install`
Expected: new Vite 8 tree resolves cleanly. No peer warnings about Vite version.

If peer warnings appear for any monitor dep, check Task 7 Steps 3-4 covered them — bump any missed peers.

---

## Task 9: Layer 3c — Verify and commit

**Files:** none (verification only)

- [ ] **Step 1: Build monitor**

Run: `pnpm --filter monitor build`
Expected: clean build with Vite 8 output.

- [ ] **Step 2: Type check monitor**

Run: `pnpm --filter monitor exec tsc -b --noEmit` (if no separate type-check script exists, use the one that runs before `vite build`).

Expected: clean.

- [ ] **Step 3: Smoke test monitor dev server**

Run: `pnpm --filter monitor dev` (in a background shell or separate terminal).

Open the printed URL in a browser. Verify:
1. The app loads without console errors.
2. Routes render (navigate between at least two).
3. HMR works (edit a source file, confirm the browser reflects the change without a full reload).

Kill the dev server when done.

If HMR is broken or routes fail to render, investigate `@vitejs/plugin-react` config differences against `plugin-react-swc`. The default export is interchangeable, but if React fast-refresh setup differs, adjust `vite.config.ts`.

- [ ] **Step 4: Run full repo verification**

Run: `pnpm build && pnpm test && pnpm lint`
Expected: all green.

- [ ] **Step 5: Commit Layer 3**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml monitor/package.json monitor/vite.config.ts
git commit -m "$(cat <<'EOF'
chore(deps): upgrade vite to 8, switch monitor to @vitejs/plugin-react

Swaps monitor from @vitejs/plugin-react-swc to @vitejs/plugin-react
to align with enkaku and ensure timely Vite 8 peer support. Bumps
vite-bundle-analyzer and @tanstack/router-plugin where required for
Vite 8 compatibility.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Layer 4a — Mantine 9 catalog bump

**Files:**
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Find the latest Mantine 9.x versions**

Run these in parallel:

```bash
pnpm view @mantine/core versions --json | tail -10
pnpm view @mantine/hooks versions --json | tail -10
pnpm view postcss-preset-mantine versions --json | tail -10
pnpm view @tabler/icons-react versions --json | tail -10
```

Record the latest stable `9.x.y` for `@mantine/core` and `@mantine/hooks`. Pick the `postcss-preset-mantine` version whose peer range lists Mantine 9 (check `pnpm view postcss-preset-mantine peerDependencies`). Pick the latest `@tabler/icons-react` that supports the current React 19.

- [ ] **Step 2: Update the catalog**

Edit `pnpm-workspace.yaml`. In the `catalog:` block, change:

```yaml
  '@mantine/core': ^8.3.16
  '@mantine/hooks': ^8.3.16
  '@tabler/icons-react': ^3.41.1
  postcss-preset-mantine: ^1.18.0
```

to the new versions from Step 1.

- [ ] **Step 3: Refresh the lockfile**

Run: `pnpm install`
Expected: Mantine 9 resolved in `monitor/`. No peer warnings.

---

## Task 11: Layer 4b — Apply Mantine 9 migration

**Files:** source files in `monitor/src/` flagged by the migration guide and by build errors

- [ ] **Step 1: Read the Mantine 9 migration guide**

Open https://mantine.dev/changelog or the v9 migration doc. Skim the breaking changes list. Note which apply to the APIs used in `monitor/src/`.

To list Mantine APIs used: `rg "from '@mantine/core'" monitor/src/ -o | sort -u` and `rg "from '@mantine/hooks'" monitor/src/ -o | sort -u`, then grep for each imported symbol.

- [ ] **Step 2: Build monitor to surface breaks**

Run: `pnpm --filter monitor build 2>&1 | tee /tmp/mantine9-errors.log`

Expected: some failures. Capture the full list.

- [ ] **Step 3: Fix breaks surfaced by the build**

Edit source files in `monitor/src/`. For each error, cross-reference with the migration guide from Step 1.

Re-run `pnpm --filter monitor build` after each file fix (or after a small batch) until clean.

If breakage is unbounded (>1 day of work), **abort Layer 4**. Ship Layers 1+2+3, open a follow-up issue.

- [ ] **Step 4: Smoke test monitor dev server**

Run: `pnpm --filter monitor dev`.

Open each page of the monitor UI in a browser. Verify:
1. No runtime errors in the browser console.
2. No visual regressions in Mantine components (cards, tables, buttons, modals, forms — whatever monitor uses).
3. Theme / CSS variables render correctly.

If any visual regression is not documented in the migration guide, investigate before committing.

Kill the dev server when done.

---

## Task 12: Layer 4c — Verify and commit

**Files:** none (verification only)

- [ ] **Step 1: Run full repo verification**

Run: `pnpm build && pnpm test && pnpm lint`
Expected: all green.

- [ ] **Step 2: Commit Layer 4**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml monitor/src monitor/package.json
# Only add monitor source paths that were actually modified
git commit -m "$(cat <<'EOF'
chore(deps): upgrade mantine to 9

Bumps @mantine/core, @mantine/hooks, postcss-preset-mantine, and
@tabler/icons-react as a set. Applies v9 migration changes to the
monitor UI source where required.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Final clean-install verification

**Files:** none

- [ ] **Step 1: Clean install from lockfile**

Run: `rm -rf node_modules **/node_modules && pnpm install --frozen-lockfile`
Expected: lockfile is internally consistent, install completes without errors.

- [ ] **Step 2: Full build + test + lint**

Run: `pnpm build && pnpm test && pnpm lint`
Expected: all green.

- [ ] **Step 3: Review the final log of commits on the branch**

Run: `git log --oneline origin/main..HEAD`
Expected (approximately):

```
<hash> chore(deps): upgrade mantine to 9
<hash> chore(deps): upgrade vite to 8, switch monitor to @vitejs/plugin-react
<hash> chore(deps): upgrade typescript to 6, align tsconfigs to es2025/nodenext
<hash> chore(deps): bump minor/patch catalog versions and @hono/node-server v2
<hash> docs: add major dep upgrade design (TS 6, Vite 8, Mantine 9)
```

If an earlier layer was aborted, fewer commits will be present. That is expected per the spec's abort conditions.

- [ ] **Step 4: Push the branch**

Run: `git push -u origin chore/dependencies-update`

- [ ] **Step 5: Open PR (only if user requests)**

Do not open a PR automatically. Ask the user first.

---

## Fallback: squash layers

If `git bisect` across the four commits becomes useless (for example, Layer 2 type fixes depend on Layer 4 Mantine changes or vice versa), squash the completed layers into a single commit:

```bash
git reset --soft origin/main
git commit -m "$(cat <<'EOF'
chore(deps): major dependency upgrade (TS 6, Vite 8, Mantine 9)

Combines the layered upgrades because per-layer bisectability was
not achievable — cross-layer type dependencies required squashing.

Covers:
- workspace minor/patch bumps + @hono/node-server v2
- typescript 6 (lifted into catalog, tsconfigs aligned to es2025/nodenext)
- vite 8 + switch to @vitejs/plugin-react
- mantine 9

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

This fallback is only invoked if the layered approach produces commits that cannot be independently verified.
