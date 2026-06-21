# Mokei Stack Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Mokei onto the post-split upstream stack — adopt `@kigu/dev` tooling, rewrite `@enkaku/*` imports to the new split scopes (`@sozai/*` + renamed `@enkaku@0.18` transports), and refactor CLI-related code onto the five published `@tejika/*` packages.

**Architecture:** Two sequenced phases. Phase A (Tasks 1–3) adopts kigu tooling and runs the enkaku-split rename codemod — all upstream deps move to published `^` ranges, no behavior change, existing tests are the gate. Phase A must be fully green before Phase B. Phase B (Tasks 4–7) replaces Mokei's hand-rolled daemon/server/CLI plumbing with `@tejika/*` API calls, deleting the now-duplicated local code; existing per-package tests are the gate. Phase A lands as PR 1, Phase B as PR 2.

**Tech Stack:** pnpm workspaces + catalog, turbo, swc, tsc, biome, vitest, Ink/React (CLI TUI), Enkaku RPC, Hono (server). Published upstream: `@kigu/dev@0.1.0`, `@sozai/*@0.1.0`, `@enkaku/*@0.18.0`, `@tejika/*@0.1.0`.

## Global Constraints

- Package manager is **pnpm** (`pnpm@11.8.0`) — never `npm`/`npx`. Lint runs via `rtk proxy pnpm run lint` (not `pnpm lint` directly; eslint-not-found otherwise).
- Cross-repo links use **published `^` semver ranges via the workspace catalog** — no `link:`/`file:`/`workspace:` to siblings.
- Mokei consumes **no** `@kokuin` and **no** `@kumiai` packages.
- TypeScript conventions (enforced by review): `type` not `interface`; `Array<T>` not `T[]`; no `any` (use `unknown`/specific); capitalized abbreviations (`ID`, `HTTP`, `JWT`); never edit generated files (`*.gen.ts`, `__generated__/`, `lib/`).
- The CLI binary loads **built output**, not `src` — rebuild before exercising `bin/dev.js`; the real binary must be driven over a PTY to catch TUI render-state regressions.
- Cross-package vitest resolves the **built `lib/`** of sibling `@mokei/*` packages — build dependency order (turbo) before running a dependent package's tests.

---

### Task 1: Adopt `@kigu/dev` tooling (repo-wide config)

Adopt the npm-config face of the kigu hub. No dependency-version changes to `@enkaku/*` yet (that is Task 3) — this task must stay green on the existing `0.17` enkaku deps. The Claude plugin-marketplace face is out of scope.

**Files:**
- Modify: `package.json` (root devDependencies)
- Modify: `pnpm-workspace.yaml` (add `nodeLinker`)
- Modify: `biome.json` (extend `@kigu/dev`)
- Modify: `tsconfig.build.json` (extend `@kigu/dev`)
- Modify: `tsconfig.json` (fix stale `paths` alias)
- Modify: `packages/{anthropic-provider,context-client,context-protocol,context-rpc,context-server,host,host-monitor,host-protocol,http-client,http-server,llama-provider,logger,model-provider,ollama-provider,openai-provider,session}/package.json` (16 packages — swc `--config-file` repoint)
- Delete: `swc.json` (root)

**Interfaces:**
- Produces: `@kigu/dev` configs available at `node_modules/@kigu/dev/{biome,swc,tsconfig}.json`; per-package `build:js` resolves swc config from there. Later tasks assume this layout.

- [ ] **Step 1: Root `package.json` — swap toolchain bundle for `@kigu/dev`**

Remove these devDependencies (now pulled transitively by `@kigu/dev`): `@biomejs/biome`, `@swc/cli`, `@swc/core`, `@types/node`, `@vitest/ui`, `del-cli`, `tsx`, `turbo`, `typescript`, `vitest`. Keep `@anthropic-ai/mcpb`, `typedoc`, `typedoc-plugin-markdown`. Add `"@kigu/dev": "^0.1.0"`. Resulting `devDependencies`:

```json
"devDependencies": {
  "@anthropic-ai/mcpb": "^2.1.2",
  "@kigu/dev": "^0.1.0",
  "typedoc": "catalog:",
  "typedoc-plugin-markdown": "catalog:"
}
```

- [x] **Step 2: ~~`pnpm-workspace.yaml` — add `nodeLinker: hoisted`~~ — DO NOT ADD (reversed in Task 3)**

Keep the default isolated (symlinked) linker — do **not** add `nodeLinker: hoisted`. It breaks enkaku 0.18's nominal `Disposer` (`#private`, from `@sozai/async`) under the flat layout (`NodeStreamsTransport` not assignable to `ServerTransport`, TS2322). Isolated shares one symlinked copy and builds clean; `@kigu/dev`'s toolchain bins (tsc/swc/biome) still resolve via `node_modules/.bin`. (Task 1 originally added this line; Task 3 removed it.)

- [ ] **Step 3: `biome.json` — extend the shared config**

Replace the file with the extend form, preserving Mokei's include excludes and adding the `vcs` block (mirrors tejika):

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "extends": ["@kigu/dev/biome.json"],
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": ["**", "!**/lib", "!**/dist", "!**/routeTree.gen.ts", "!website/.docusaurus", "!website/build"]
  }
}
```

- [ ] **Step 4: `tsconfig.build.json` — extend the shared config**

Replace its hand-rolled compilerOptions with the extend form (the shared config supplies `target/module/moduleResolution/lib/strict/declaration`):

```json
{
  "extends": "@kigu/dev/tsconfig.json",
  "compilerOptions": {
    "allowSyntheticDefaultImports": true,
    "declarationMap": true,
    "esModuleInterop": true
  }
}
```

- [ ] **Step 5: `tsconfig.json` — fix the stale path alias**

The root config aliases `@enkaku/*` to local packages — a leftover from the enkaku monorepo. Mokei's internal packages are `@mokei/*`. Change it:

```json
{
  "extends": "./tsconfig.build.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@mokei/*": ["packages/*"]
    },
    "noEmit": true
  }
}
```

- [ ] **Step 6: Repoint swc config in all 16 library packages**

Each library package's `build:js` references the root `../../swc.json`. Point them at the shared config. Run:

```bash
cd /Users/paul/dev/yulsi/mokei
perl -pi -e 's{--config-file \.\./\.\./swc\.json}{--config-file ../../node_modules/\@kigu/dev/swc.json}g' \
  packages/{anthropic-provider,context-client,context-protocol,context-rpc,context-server,host,host-monitor,host-protocol,http-client,http-server,llama-provider,logger,model-provider,ollama-provider,openai-provider,session}/package.json
```

(`@mokei/cli` is handled in Task 2 — leave it untouched here.)

- [ ] **Step 7: Delete the root `swc.json`**

```bash
rm /Users/paul/dev/yulsi/mokei/swc.json
```

- [ ] **Step 8: Reinstall and verify the build + lint are green**

```bash
cd /Users/paul/dev/yulsi/mokei
pnpm install
pnpm run build
rtk proxy pnpm run lint
```

Expected: `pnpm install` resolves `@kigu/dev@0.1.0`; build completes for all packages (cli still on `dist/`, fine); lint passes. If `pnpm install` blocks on `minimumReleaseAge` for `@kigu/dev`, add `'@kigu/dev@0.1.0'` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` and re-run.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "build: adopt @kigu/dev shared toolchain config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Align `@mokei/cli` output to `lib/`

The 16 library packages already emit `lib/`. `@mokei/cli` is the lone outlier on `dist/` with its own tsx `swc.json`. Bring it onto the shared `lib/` + `@kigu/dev/swc.json` convention. `@kigu/dev/swc.json` sets `react.runtime: automatic`, and swc auto-enables JSX for `.tsx` files, so the custom swc config is no longer needed.

**Files:**
- Modify: `packages/cli/package.json` (scripts, `main`, `files`)
- Modify: `packages/cli/bin/run.js` (load path)
- Modify: `packages/cli/bin/dev.js` (load path)
- Modify: `packages/cli/tsconfig.json` (outDir + jsx)
- Delete: `packages/cli/swc.json`

**Interfaces:**
- Consumes: `@kigu/dev/swc.json` (from Task 1).
- Produces: `mokei` binary loads from `lib/index.js`; CLI builds via the shared `build:clean`/`build:js`/`build:types` script triad like the library packages.

- [ ] **Step 1: Rewrite `packages/cli/package.json` build scripts + output paths**

Change `main` from `dist/index.js` to `lib/index.js`; `files` `"/dist"` → `"/lib"`; replace the `build:clean`/`build:dist`/`build` scripts with the shared triad. Resulting scripts block:

```json
"scripts": {
  "mokei": "./bin/dev.js",
  "build:clean": "del lib",
  "build:js": "swc src -d ./lib --config-file ../../node_modules/@kigu/dev/swc.json --strip-leading-paths",
  "build:types": "tsc --emitDeclarationOnly --skipLibCheck",
  "build:types:ci": "tsc --emitDeclarationOnly --skipLibCheck --declarationMap false",
  "build": "pnpm run build:clean && pnpm run build:js && pnpm run build:types",
  "test:types": "tsc --noEmit --skipLibCheck",
  "test:unit": "vitest run",
  "test": "pnpm run test:types && pnpm run test:unit"
}
```

Set `"main": "lib/index.js"` and `"files": ["/bin", "/lib"]`.

- [ ] **Step 2: Repoint both bin scripts to `lib/`**

```bash
cd /Users/paul/dev/yulsi/mokei
perl -pi -e "s{\.\./dist/index\.js}{../lib/index.js}g" packages/cli/bin/run.js packages/cli/bin/dev.js
```

- [ ] **Step 3: Update `packages/cli/tsconfig.json` for `lib/` output + JSX**

Replace with the tejika-`ui` shape (JSX enabled, emits to `lib`):

```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["es2025", "dom"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./lib",
    "rootDir": "./src",
    "types": ["node", "react"]
  },
  "include": ["./src/**/*"]
}
```

- [ ] **Step 4: Delete the custom swc config**

```bash
rm /Users/paul/dev/yulsi/mokei/packages/cli/swc.json
```

- [ ] **Step 5: Build the CLI and verify `lib/` output + binary runs**

```bash
cd /Users/paul/dev/yulsi/mokei
pnpm --filter mokei run build
ls packages/cli/lib/index.js
node packages/cli/bin/run.js --help
```

Expected: `lib/index.js` exists; `--help` prints the command list with no `Cannot find module '../dist/index.js'` error. Confirm no stale `dist/` is referenced: `! grep -rq "dist/index.js" packages/cli/bin`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build(cli): emit to lib/ on shared swc config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Enkaku-split rename codemod (catalog + imports + deps)

One mechanical rename map drives import statements and `package.json` dependency edits across every tracked file. Pure rename — no behavior change. Existing tests are the gate.

**Rename map (exact tokens):**

| old | new |
|-----|-----|
| `@enkaku/async` | `@sozai/async` |
| `@enkaku/event` | `@sozai/event` |
| `@enkaku/generator` | `@sozai/generator` |
| `@enkaku/log` | `@sozai/log` |
| `@enkaku/otel` | `@sozai/otel` |
| `@enkaku/schema` | `@sozai/schema` |
| `@enkaku/stream` | `@sozai/stream` |
| `@enkaku/node-streams-transport` | `@enkaku/node-streams` |
| `@enkaku/socket-transport` | `@enkaku/socket` |
| `@enkaku/http-server-transport` | `@enkaku/http-serve` |
| `@enkaku/http-client-transport` | `@enkaku/http-fetch` |
| `@enkaku/transport` | `@enkaku/transport` (unchanged) |
| `@enkaku/protocol` | `@enkaku/protocol` (unchanged) |
| `@enkaku/client` | `@enkaku/client` (unchanged) |
| `@enkaku/server` | `@enkaku/server` (unchanged) |

**Files:**
- Modify: `pnpm-workspace.yaml` (catalog + `minimumReleaseAgeExclude`)
- Modify: all tracked `*.ts`/`*.tsx`/`package.json` files importing or depending on a renamed `@enkaku/*` package (52 import sites + 13 package.json dep blocks)

**Interfaces:**
- Consumes: nothing new.
- Produces: every `@sozai/*` and renamed `@enkaku/*` name resolves to a published `0.1.0`/`0.18.0` version via the catalog. Per-package dep blocks match the spec's dependency table.

- [ ] **Step 1: Rewrite the catalog in `pnpm-workspace.yaml`**

Replace the seven moved `@enkaku/*` catalog entries with `@sozai/*` at `^0.1.0`, and bump the kept/renamed enkaku entries to `^0.18.0`. The `@enkaku/*` block becomes exactly:

```yaml
  '@enkaku/client': ^0.18.0
  '@enkaku/http-serve': ^0.18.0
  '@enkaku/node-streams': ^0.18.0
  '@enkaku/protocol': ^0.18.0
  '@enkaku/server': ^0.18.0
  '@enkaku/socket': ^0.18.0
  '@enkaku/transport': ^0.18.0
  '@sozai/async': ^0.1.0
  '@sozai/event': ^0.1.0
  '@sozai/generator': ^0.1.0
  '@sozai/log': ^0.1.0
  '@sozai/otel': ^0.1.0
  '@sozai/schema': ^0.1.0
  '@sozai/stream': ^0.1.0
```

(Remove the old `@enkaku/async|event|generator|http-client-transport|http-server-transport|log|node-streams-transport|otel|schema|socket-transport|stream` lines. `http-fetch` is not added — no Mokei package consumes it.)

- [ ] **Step 2: Update `minimumReleaseAgeExclude`**

Replace the single `@enkaku/*` entry with the fresh-publish pins so pnpm does not block just-published versions:

```yaml
minimumReleaseAgeExclude:
  - '@enkaku/*'
  - '@kigu/dev@0.1.0'
  - '@sozai/async@0.1.0'
  - '@sozai/event@0.1.0'
  - '@sozai/generator@0.1.0'
  - '@sozai/log@0.1.0'
  - '@sozai/otel@0.1.0'
  - '@sozai/schema@0.1.0'
  - '@sozai/stream@0.1.0'
```

- [ ] **Step 3: Run the rename codemod over all tracked files**

Replaces the leaf-renamed and scope-moved tokens everywhere (imports + `package.json` dep keys). The unchanged four (`transport`/`protocol`/`client`/`server`) are not touched. Order matters: the `-transport` variants are replaced before any generic match could collide — handled here by replacing full tokens only.

```bash
cd /Users/paul/dev/yulsi/mokei
FILES=$(git ls-files '*.ts' '*.tsx' '*.json' | grep -v -E '(^|/)(lib|dist|node_modules)/')
for f in $FILES; do
  perl -pi -e '
    s{\@enkaku/node-streams-transport}{\@enkaku/node-streams}g;
    s{\@enkaku/socket-transport}{\@enkaku/socket}g;
    s{\@enkaku/http-server-transport}{\@enkaku/http-serve}g;
    s{\@enkaku/http-client-transport}{\@enkaku/http-fetch}g;
    s{\@enkaku/async}{\@sozai/async}g;
    s{\@enkaku/event}{\@sozai/event}g;
    s{\@enkaku/generator}{\@sozai/generator}g;
    s{\@enkaku/log}{\@sozai/log}g;
    s{\@enkaku/otel}{\@sozai/otel}g;
    s{\@enkaku/schema}{\@sozai/schema}g;
    s{\@enkaku/stream}{\@sozai/stream}g;
  ' "$f"
done
```

- [ ] **Step 4: Verify no stale renamed tokens remain**

```bash
cd /Users/paul/dev/yulsi/mokei
git grep -nE '@enkaku/(async|event|generator|log|otel|schema|stream|node-streams-transport|socket-transport|http-server-transport|http-client-transport)' -- '*.ts' '*.tsx' '*.json' ':!lib' ':!dist'
```

Expected: **no output** (exit 1). Any hit is a missed edit — fix it. Then sanity-check the survivors are only the four unchanged names:

```bash
git grep -ohE "@enkaku/[a-z-]+" -- '*.ts' '*.tsx' | sort -u
```

Expected: only `@enkaku/client`, `@enkaku/node-streams`, `@enkaku/protocol`, `@enkaku/server`, `@enkaku/socket`, `@enkaku/transport`, `@enkaku/http-serve`.

- [ ] **Step 5: Reinstall, build, test, lint**

```bash
cd /Users/paul/dev/yulsi/mokei
pnpm install
pnpm run build
pnpm run test
rtk proxy pnpm run lint
```

Expected: install resolves all `@sozai/*@0.1.0` and `@enkaku/*@0.18.0`; build, full test suite, and lint all green. If install blocks on `minimumReleaseAge` for a sibling version, add the exact `name@version` to `minimumReleaseAgeExclude` and re-run.

- [ ] **Step 6: Commit (closes Phase A → PR 1)**

```bash
git add -A
git commit -m "refactor: adopt enkaku split scopes (@sozai/* + @enkaku@0.18)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Phase A is complete. Open PR 1 from `feat/kigu-stack` if reviewing per-phase, or continue to Phase B on the same branch.

---

### Task 4: `@mokei/host` → `@tejika/process` + `@tejika/env`

Replace Mokei's hand-rolled daemon lifecycle with `@tejika/process` and its path/port resolution with `@tejika/env`. Delete the now-duplicated local code. Keep `host.ts` (ContextHost orchestration), `local-tools.ts`, `proxy.ts` — Mokei-specific.

`@tejika/process` API: `runDaemon`, `spawnDaemon`, `createDaemonClient` (reconnect backoff 250ms–5s), `ensureDaemon`, `getDaemonStatus`, `stopDaemon` — generic over the Enkaku `Protocol`; `app: string` replaces baked-in paths.
`@tejika/env` API: `getDataDir(app)`, `getStateDir(app)`, `getSocketPath(app, name?)`, `getPidPath(app)`, `getPort(app, opts?)`, `appEnvVar(app, key)` — each honours an `<APP>_<KEY>` env override.

**Files:**
- Modify: `packages/host/package.json` (add `@tejika/process`, `@tejika/env`; drop deps used only by deleted code)
- Delete: `packages/host/src/daemon/controller.ts`
- Delete: `packages/host/src/daemon/process.ts`
- Delete: `packages/host/src/daemon/socket.ts`
- Modify: `packages/host/src/server.ts` (socket-server block → `@tejika/process`)
- Modify: `packages/host/src/spawn.ts` (daemon bits → `@tejika/process` + `@tejika/env`)
- Modify: `packages/host/src/index.ts` (re-exports — drop deleted symbols, surface tejika-backed equivalents the CLI imports)
- Reference (read, do not assume): `../tejika/packages/process/src/*` for exact signatures; tejika migration plan §"Donor → tejika mapping" for what moved.

**Interfaces:**
- Consumes: `@tejika/process`, `@tejika/env` published APIs above.
- Produces: `@mokei/host` re-exports daemon control (`ensureDaemon`/`getDaemonStatus`/`stopDaemon` or Mokei-named wrappers) that `@mokei/cli` (Task 6) consumes. Preserve the existing exported names the CLI's `commands/` already import — verify with `git grep -n "from '@mokei/host'" packages/cli/src` before renaming anything.

- [ ] **Step 1: Add the tejika deps to `packages/host/package.json`**

Add to `dependencies`: `"@tejika/process": "catalog:"`, `"@tejika/env": "catalog:"`. Add the catalog entries to `pnpm-workspace.yaml`:

```yaml
  '@tejika/env': ^0.1.0
  '@tejika/process': ^0.1.0
```

and to `minimumReleaseAgeExclude`: `'@tejika/env@0.1.0'`, `'@tejika/process@0.1.0'`. Run `pnpm install`.

- [ ] **Step 2: Read the donor + tejika source side by side**

```bash
cd /Users/paul/dev/yulsi
sed -n '1,80p' mokei/packages/host/src/daemon/controller.ts
sed -n '1,80p' mokei/packages/host/src/daemon/process.ts
sed -n '1,80p' mokei/packages/host/src/daemon/socket.ts
ls tejika/packages/process/src && sed -n '1,120p' tejika/packages/process/src/index.ts
```

Map each local daemon function to its `@tejika/process` replacement and note the `app` string Mokei uses (`"mokei"`) and any socket/pid path currently derived by hand (→ `@tejika/env`).

- [ ] **Step 3: Rewrite `server.ts` + `spawn.ts` against the tejika API; delete the daemon trio**

Replace the socket-server construction in `server.ts` and the daemon-spawn logic in `spawn.ts` with `runDaemon`/`spawnDaemon`/`createDaemonClient`/`ensureDaemon`/`getDaemonStatus`/`stopDaemon` calls (passing `app: "mokei"`) and `@tejika/env` resolvers for socket/pid/data paths. Update `index.ts` re-exports. Then delete the replaced files:

```bash
rm mokei/packages/host/src/daemon/controller.ts \
   mokei/packages/host/src/daemon/process.ts \
   mokei/packages/host/src/daemon/socket.ts
```

- [ ] **Step 4: Re-verify and trim `@mokei/host` enkaku deps**

`host.ts` still needs `@enkaku/client` + `@enkaku/node-streams` for ContextHost stdio. Confirm which enkaku deps remain referenced after the deletions, and drop only the unreferenced ones from `package.json`:

```bash
cd /Users/paul/dev/yulsi/mokei
for p in client node-streams socket server transport; do
  echo -n "@enkaku/$p: "; git grep -l "@enkaku/$p" packages/host/src | wc -l
done
for p in async event stream; do
  echo -n "@sozai/$p: "; git grep -l "@sozai/$p" packages/host/src | wc -l
done
```

Remove from `packages/host/package.json` `dependencies` any name whose count is `0`. (Expected to drop: `@enkaku/socket`, `@enkaku/server` — the daemon's socket transport/server — but trust the counts, not this note.)

- [ ] **Step 5: Build deps + run the host test suite**

```bash
cd /Users/paul/dev/yulsi/mokei
pnpm run build:types && pnpm --filter @mokei/host run build
pnpm --filter @mokei/host test
```

Expected: green. Cross-package tests resolve sibling `lib/` — the `build` above refreshes them. If a test references a deleted symbol, the test was asserting on now-external behavior; update it to call the `@mokei/host` re-export (do not re-add the deleted file).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(host): consume @tejika/process + @tejika/env

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `@mokei/host-monitor` → `@tejika/server`

Replace the monitor's hand-rolled local HTTP server + auth with `@tejika/server`, preserving the loopback/Host/Origin/timing-safe-token/`chmod 0o600` defenses (now provided by the package). Keep the monitor's host-protocol stream wiring.

`@tejika/server` API: `createLocalServer(opts)` (loopback default + opt-in network mode), `buildAllowedHosts`, `verifyLoopbackRequest`, `attachEnkakuTransport`, `serveStaticSPA`.

**Files:**
- Modify: `packages/host-monitor/package.json` (add `@tejika/server`; drop `@enkaku/http-serve`, `@enkaku/socket`, `@sozai/async` if unreferenced after)
- Modify: `packages/host-monitor/src/index.ts` (server construction → `createLocalServer` + `serveStaticSPA` + `attachEnkakuTransport`)
- Modify/Delete: `packages/host-monitor/src/auth.ts` (auth logic now in `@tejika/server` — delete if fully superseded)
- Modify: `packages/host-monitor/src/html.ts` (static SPA serving → `serveStaticSPA`; keep Mokei's HTML shell if it carries monitor-specific markup)
- Modify: `packages/host-monitor/src/pipes.ts` (keep host-protocol stream wiring; route transport via `attachEnkakuTransport`)
- Reference: `../tejika/packages/server/src/*` for exact signatures.

**Interfaces:**
- Consumes: `@tejika/server` API above.
- Produces: monitor still exports its existing server entrypoint with the same signature the CLI's `monitor` command invokes — verify with `git grep -n "from '@mokei/host-monitor'" packages/cli/src` before changing exported names.

- [ ] **Step 1: Add the dep**

Add `"@tejika/server": "catalog:"` to `packages/host-monitor/package.json` dependencies; add `'@tejika/server': ^0.1.0` to the catalog and `'@tejika/server@0.1.0'` to `minimumReleaseAgeExclude`. `pnpm install`.

- [ ] **Step 2: Read donor + tejika source**

```bash
cd /Users/paul/dev/yulsi
for f in index auth html pipes; do echo "=== $f ==="; cat mokei/packages/host-monitor/src/$f.ts; done
sed -n '1,140p' tejika/packages/server/src/index.ts
```

Map `auth.ts` → `verifyLoopbackRequest`/`buildAllowedHosts`, the server bootstrap → `createLocalServer`, static serving → `serveStaticSPA`, the Enkaku socket/HTTP wiring → `attachEnkakuTransport`.

- [ ] **Step 3: Rewrite `index.ts` server construction**

Replace the hand-rolled Hono/auth/transport bootstrap with `createLocalServer(...)` + `attachEnkakuTransport(...)` + `serveStaticSPA(...)`. Keep the host-protocol pipe wiring in `pipes.ts`. Delete `auth.ts` if its logic is fully superseded:

```bash
# only after confirming index.ts no longer imports from it:
git grep -q "from './auth'" mokei/packages/host-monitor/src || rm mokei/packages/host-monitor/src/auth.ts
```

- [ ] **Step 4: Trim now-unused enkaku/sozai deps**

```bash
cd /Users/paul/dev/yulsi/mokei
for p in "@enkaku/http-serve" "@enkaku/socket" "@sozai/async"; do
  echo -n "$p: "; git grep -l "$p" packages/host-monitor/src | wc -l
done
```

Drop any `0`-count name from `packages/host-monitor/package.json`.

- [ ] **Step 5: Build deps + run the monitor test suite**

```bash
cd /Users/paul/dev/yulsi/mokei
pnpm run build:types && pnpm --filter @mokei/host-monitor run build
pnpm --filter @mokei/host-monitor test
```

Expected: green, including any auth/loopback-rejection tests (now asserting `@tejika/server` behavior). If a test imported `./auth` internals, repoint it to the `@tejika/server` export or the monitor's public entrypoint.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(host-monitor): consume @tejika/server

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `@mokei/cli` → `@tejika/cli` + `@tejika/ui`

Replace the CLI's program/ink/options plumbing with `@tejika/cli`, and swap the generic chat components for `@tejika/ui`. Keep all chat-domain components local.

`@tejika/cli` API: `buildProgram`, `runInk`, `renderStatic`, `withSocketPath`, `withPort`, `withLogLevel`. **A program using `withPort` MUST run via `program.parseAsync()`** (lazy default uses an async preAction hook).
`@tejika/ui` exports: `StatusLine`, `Footer`, `KeyHints`, `ConfirmCard`, `SelectCard`, `Spinner`, `IconLine`, `SystemNotice` (generic, props-only).

**Files:**
- Modify: `packages/cli/package.json` (add `@tejika/cli`, `@tejika/ui`; drop deps now provided transitively — re-verify counts before removing)
- Modify: `packages/cli/src/program.ts` → use `buildProgram` + option helpers
- Modify: `packages/cli/src/ink.ts` → use `runInk`/`renderStatic`
- Modify: `packages/cli/src/options.ts` → use `withSocketPath`/`withPort`/`withLogLevel`
- Modify: `packages/cli/src/index.ts` → ensure entrypoint calls `program.parseAsync(...)`
- Modify: `packages/cli/src/chat/components/{ConfirmCard,Footer,IconLine,StatusLine,SystemNotice}.tsx` → re-export / replace with `@tejika/ui`
- Keep local (domain): `AssistantMessage`, `UserMessage`, `ToolApprovalCard`, `ToolCallStatus`, `ToolResultCard`, `PendingTurn`, `ReasoningView`, `WaitingStatus`, `SlashSuggestions`, `HelpCard`, `LlamaPathCard`, `ModelSelectCard`, `ProviderSelectCard`, `ToolSelectCard`
- Reference: `../tejika/packages/{cli,ui}/src/*` for exact signatures and prop shapes.

**Interfaces:**
- Consumes: `@tejika/cli`, `@tejika/ui` APIs above; `@mokei/host` + `@mokei/host-monitor` re-exports from Tasks 4–5.
- Produces: the `mokei` binary entrypoint, unchanged user-facing CLI surface.

- [ ] **Step 1: Add the deps**

Add `"@tejika/cli": "catalog:"`, `"@tejika/ui": "catalog:"` to `packages/cli/package.json`; add `'@tejika/cli': ^0.1.0` and `'@tejika/ui': ^0.1.0` to the catalog, and the `@0.1.0` pins to `minimumReleaseAgeExclude`. `pnpm install`.

- [ ] **Step 2: Read donor + tejika source**

```bash
cd /Users/paul/dev/yulsi
for f in program ink options index; do echo "=== $f ==="; cat mokei/packages/cli/src/$f.ts; done
sed -n '1,160p' tejika/packages/cli/src/index.ts
sed -n '1,200p' tejika/packages/ui/src/index.ts
```

Confirm the prop shapes of `StatusLine`/`Footer`/`IconLine`/`ConfirmCard`/`SystemNotice`/`SelectCard`/`KeyHints` in `@tejika/ui` versus Mokei's local versions before swapping.

- [ ] **Step 3: Replace program/ink/options plumbing**

Rewrite `program.ts`/`ink.ts`/`options.ts` to delegate to `buildProgram`/`runInk`/`renderStatic`/`withSocketPath`/`withPort`/`withLogLevel`. **Ensure `index.ts` invokes `program.parseAsync(process.argv)`** (not `program.parse`) — `withPort`'s async preAction hook requires it; using `parse` silently skips port resolution.

- [ ] **Step 4: Swap the five generic chat components for `@tejika/ui`**

For each of `ConfirmCard`, `Footer`, `IconLine`, `StatusLine`, `SystemNotice`: replace the local implementation body with a re-export (or thin prop-adapter wrapper if Mokei passes extra props) from `@tejika/ui`. Keep the file path stable so existing local imports keep working. For `ModelSelectCard`/`ProviderSelectCard`/`ToolSelectCard`, rebuild them on `@tejika/ui`'s `SelectCard`; for `HelpCard`, use `KeyHints` where it backs the key list.

- [ ] **Step 5: Trim deps now provided by tejika, then build + test**

```bash
cd /Users/paul/dev/yulsi/mokei
for p in "@sozai/async" "@sozai/stream" "@enkaku/node-streams" "@inkjs/ui" "commander" "ink"; do
  echo -n "$p: "; git grep -l "$p" packages/cli/src | wc -l
done
```

Drop only `0`-count names from `packages/cli/package.json` (commander/ink may now be transitive via `@tejika/cli`/`@tejika/ui` — verify before removing; keep if still imported directly). Then:

```bash
pnpm run build:types && pnpm --filter mokei run build
pnpm --filter mokei test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(cli): consume @tejika/cli + @tejika/ui

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Full verification + real-binary QA

Phase B is behavior-affecting; confirm the whole repo builds, tests, and lints, then drive the real binary to catch TUI render-state regressions unit tests miss.

**Files:** none (verification only; fixes land in the relevant Task 4–6 file if something fails).

- [ ] **Step 1: Clean full build + test + lint**

```bash
cd /Users/paul/dev/yulsi/mokei
pnpm run build
pnpm run test
rtk proxy pnpm run lint
```

Expected: all green across every package.

- [ ] **Step 2: Drive the real `mokei` binary over a PTY**

Exercise the daemon + chat + monitor paths against the rebuilt `lib/` (not `src`). At minimum:

```bash
cd /Users/paul/dev/yulsi/mokei
node packages/cli/bin/run.js --help
node packages/cli/bin/run.js --version
```

Then run an interactive chat session and a `monitor` invocation over a PTY (per the CLI real-stdio QA practice), confirming: the TUI renders, the daemon spawns and reconnects, tool-approval cards stream (the pending event must yield before awaiting approval), and the monitor server binds loopback-only. Capture any render-state or daemon-lifecycle regression and fix in the owning task before proceeding.

- [ ] **Step 3: Final commit (closes Phase B → PR 2)**

```bash
git add -A
git commit -m "test: verify mokei stack migration end-to-end

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" --allow-empty
```

Open PR 2 from `feat/kigu-stack`.

---

## Notes for the implementer

- **Tejika API uncertainty:** Tasks 4–6 give the published API surface but not Mokei's exact call sites — every such task includes a "read donor + tejika source side by side" step. Do that step before editing; do not guess signatures.
- **Dependency trimming is count-driven:** never remove a dependency by assumption. Each task's trim step greps the post-edit source and drops only `0`-count names. A wrongly-dropped dep surfaces as a build failure in the same task.
- **Min-release-age blocks:** every newly-referenced upstream version (`@kigu/dev`, `@sozai/*`, `@tejika/*`, `@enkaku@0.18`) must appear in `minimumReleaseAgeExclude` or `pnpm install` may refuse it. Add `name@version` and re-run.
- **The CLI loads built output:** after any `packages/cli/src` edit, rebuild before exercising `bin/run.js`/`bin/dev.js`.
