# Mokei stack migration — design

Status: approved design (brainstorm complete, 2026-06-21)
Scope: migrate Mokei onto the post-split upstream stack — adopt `@kigu/dev` tooling,
rewrite `@enkaku/*` imports to the new split scopes (`@sozai/*` + renamed `@enkaku`
transports at v0.18), and refactor CLI-related code to consume the five published
`@tejika/*` packages.

Sources:
- `../kigu/docs/repo-split-design.md` (enkaku monorepo split, rename map, kigu hub)
- `../tejika/docs/agents/plans/next/2026-06-20-mokei-tejika-migration.md` (tejika consumption)

Preconditions (all met per user): every upstream package is published —
`@kigu/dev@0.1.0`, `@sozai/*@0.1.0`, `@enkaku/*@0.18.0`, `@tejika/*@0.1.0`. Cross-repo
links use published `^` semver ranges via the workspace catalog (no `link:`/`file:`).

## Structure

One spec, two sequenced phases. **Phase A must be green before Phase B starts** —
`@tejika/*` consume `@enkaku@0.18`, so the split adoption is a precondition for the
CLI refactor. Each phase lands as its own PR.

Mokei consumes **no** `@kokuin` or `@kumiai` packages (no token/capability/keystore or
MLS usage — verified: zero `@enkaku/token` deps pre-split).

---

## Phase A — Enkaku split + `@kigu/dev` adoption

### A1. Kigu tooling (`@kigu/dev` config only)

Adopt the npm-config face of the kigu hub. The Claude plugin marketplace face is **out
of scope** — keep Mokei's existing local `.claude/skills` as-is.

- **Root `package.json` devDependencies:** remove the toolchain bundle now pulled
  transitively by `@kigu/dev` (`@biomejs/biome`, `@swc/cli`, `@swc/core`, `@types/node`,
  `@vitest/ui`, `del-cli`, `tsx`, `turbo`, `typescript`, `vitest`). Add
  `"@kigu/dev": "^0.1.0"`. Keep Mokei-only devDeps (`@anthropic-ai/mcpb`, `typedoc*`).
- **`pnpm-workspace.yaml`:** ~~add `nodeLinker: hoisted`~~ **REVERSED during execution — keep the default isolated (symlinked) linker.** enkaku 0.18's `Transport`/`Server` extend a nominal `Disposer` (`#private`) from `@sozai/async`; the hoisted flat layout breaks that brand identity (`NodeStreamsTransport` no longer assignable to `ServerTransport`), failing the type build. Isolated shares one symlinked copy → clean. `@kigu/dev`'s toolchain bins (tsc/swc/biome) remain resolvable via `node_modules/.bin` under isolated, so no functionality is lost. Do not add `nodeLinker: hoisted`.
- **`biome.json`:** `"extends": ["@kigu/dev/biome.json"]`; keep Mokei-specific
  `files.includes` excludes (`!**/dist`→`!**/lib`, `!**/routeTree.gen.ts`,
  `!website/.docusaurus`, `!website/build`) and `vcs` block (mirror tejika's shape).
- **`tsconfig.build.json`:** `"extends": "@kigu/dev/tsconfig.json"` plus the local
  overrides tejika carries (`allowSyntheticDefaultImports`, `declarationMap`,
  `esModuleInterop`).
- **Per-package `build:js`:** point swc at the shared config —
  `--config-file ../../node_modules/@kigu/dev/swc.json`. Delete the local `swc.json`
  files (root + per-package).

### A2. Output dir `dist/` → `lib/` (all 17 packages)

Align with the `@kigu/dev` + tejika convention.

- Per-package `build:js`: swc `-d ./lib` (was `-d ./dist`).
- Per-package `package.json`: `main`/`types`/`exports`/`files` → `lib` (was `dist`).
- Per-package `tsconfig.json`: adopt the tejika shape — `extends:
  "../../tsconfig.build.json"`, `module`/`moduleResolution: "NodeNext"`,
  `outDir: "./lib"`, `rootDir: "./src"`, `include: ["./src/**/*"]`.
- **CLI `@mokei/cli`:** edit `bin/run.js` and `bin/dev.js` load paths (`dist` → `lib`);
  `build:clean`/`build:dist` scripts (`del dist` → `del lib`, `-d ./dist` → `-d ./lib`).
- `turbo.json`: `outputs` → `lib/**`.
- `.gitignore`: already ignores `lib` — drop any `dist` entry.

Memory note: `bin/dev.js` loads built output, not `src` — rebuild after edits; the real
binary must be exercised (PTY smoke test) to catch a missed path.

### A3. Rename codemod (catalog + 52 import sites + package.json deps)

One mechanical rename map drives import statements and `package.json` dependency edits.

| old | new |
|-----|-----|
| `@enkaku/async` | `@sozai/async` |
| `@enkaku/schema` | `@sozai/schema` |
| `@enkaku/stream` | `@sozai/stream` |
| `@enkaku/event` | `@sozai/event` |
| `@enkaku/otel` | `@sozai/otel` |
| `@enkaku/generator` | `@sozai/generator` |
| `@enkaku/log` | `@sozai/log` |
| `@enkaku/transport` | `@enkaku/transport` (unchanged) |
| `@enkaku/protocol` | `@enkaku/protocol` (unchanged) |
| `@enkaku/client` | `@enkaku/client` (unchanged) |
| `@enkaku/server` | `@enkaku/server` (unchanged) |
| `@enkaku/node-streams-transport` | `@enkaku/node-streams` |
| `@enkaku/socket-transport` | `@enkaku/socket` |
| `@enkaku/http-server-transport` | `@enkaku/http-serve` |
| `@enkaku/http-client-transport` | `@enkaku/http-fetch` |

Per-package dependency edits (pre-Phase-B state):

| package | sozai | enkaku (renamed/kept) |
|---------|-------|-----------------------|
| anthropic-provider | schema | — |
| cli | async, stream | node-streams |
| context-client | async, otel, schema, stream | transport, node-streams |
| context-protocol | schema | — |
| context-rpc | async, event, schema | transport |
| context-server | otel, schema | transport, node-streams |
| host-monitor | async | http-serve, socket |
| host-protocol | schema | protocol |
| host | async, event, stream | client, server, transport, node-streams, socket |
| http-client | stream | transport |
| http-server | — | transport |
| llama-provider | async, schema | — |
| logger | log | — |
| model-provider | schema | — |
| ollama-provider | schema, stream | — |
| openai-provider | schema | — |
| session | async, event, generator | transport |

**Catalog (`pnpm-workspace.yaml`):**
- Replace the seven moved entries with `@sozai/*: ^0.1.0`
  (async, event, generator, log, otel, schema, stream).
- Rename + bump the enkaku transports/core to `^0.18.0`:
  `@enkaku/client`, `@enkaku/protocol`, `@enkaku/server`, `@enkaku/transport`,
  `@enkaku/node-streams`, `@enkaku/socket`, `@enkaku/http-serve` (add `http-fetch` only
  if a consumer needs it).
- `minimumReleaseAgeExclude`: replace `@enkaku/*` with explicit fresh-publish pins for
  `@enkaku/*`, `@kigu/dev@0.1.0`, `@sozai/*@0.1.0` (mirror tejika's list) to avoid
  pnpm's min-release-age block on just-published versions.

### A4. Verify Phase A

`pnpm install` (resolve the new catalog), then `pnpm build && pnpm test && pnpm lint`
all green. Workspace tests resolve built `lib/` of sibling packages — build dependency
order holds via turbo. Commit as **PR 1**.

---

## Phase B — Tejika CLI refactor

Add to catalog: `@tejika/env`, `@tejika/process`, `@tejika/server`, `@tejika/cli`,
`@tejika/ui` — all `^0.1.0` (add the same to `minimumReleaseAgeExclude` pins).

### B1. `@mokei/host` → `@tejika/process` + `@tejika/env`

`@tejika/process` API: `runDaemon`, `spawnDaemon`, `createDaemonClient` (reconnect
backoff 250ms–5s), `ensureDaemon`, `getDaemonStatus`, `stopDaemon` — generic over the
Enkaku `Protocol`, `app: string` replaces baked-in paths.
`@tejika/env` API: `getDataDir`, `getStateDir`, `getSocketPath`, `getPidPath`,
`getPort`, `appEnvVar` — each honours an `<APP>_<KEY>` env override.

- Delete `daemon/controller.ts`, `daemon/process.ts`, `daemon/socket.ts`.
- Replace the socket-server block in `server.ts` and the daemon bits of `spawn.ts` with
  `@tejika/process` calls + `@tejika/env` path/port resolvers (`app = "mokei"`).
- **Keep** `host.ts` (ContextHost orchestration — Mokei-specific), `local-tools.ts`,
  `proxy.ts`, `index.ts`, `utils.ts`.
- **Keep** the `@enkaku/client` + `@enkaku/node-streams` deps `host.ts` needs for
  ContextHost stdio after the daemon code leaves; drop deps only the deleted daemon code
  used (re-verify against the trimmed source, don't drop blind).
- Gate: `pnpm --filter @mokei/host test` green.

### B2. `@mokei/host-monitor` → `@tejika/server`

`@tejika/server` API: `createLocalServer(opts)` (loopback default + opt-in network
mode), `buildAllowedHosts`, `verifyLoopbackRequest`, `attachEnkakuTransport`,
`serveStaticSPA` — preserves Host/Origin / timing-safe-token / `chmod 0o600` defenses.

- Replace server construction in `auth.ts`, `index.ts`, `html.ts`, `pipes.ts` with
  `createLocalServer(...)` + `serveStaticSPA(...)` + `attachEnkakuTransport(...)`.
- Keep the monitor's host-protocol stream wiring.
- Drops direct `@enkaku/http-serve`, `@enkaku/socket`, `@sozai/async` deps (absorbed by
  `@tejika/server`); add `@tejika/server`.
- Gate: `pnpm --filter @mokei/host-monitor test` green.

### B3. `@mokei/cli` → `@tejika/cli` + `@tejika/ui`

`@tejika/cli` API: `buildProgram`, `runInk`, `renderStatic`, `withSocketPath`,
`withPort`, `withLogLevel`. **A program using `withPort` MUST run via
`program.parseAsync()`** (the lazy default uses an async preAction hook).
`@tejika/ui` exports: `StatusLine`, `Footer`, `KeyHints`, `ConfirmCard`, `SelectCard`,
`Spinner`, `IconLine`, `SystemNotice` (generic, props-only).

- Replace `program.ts`, `ink.ts`, `options.ts` with `@tejika/cli` plumbing; ensure the
  entrypoint calls `program.parseAsync()`.
- Swap generic chat components for `@tejika/ui` equivalents: `ConfirmCard`, `Footer`,
  `IconLine`, `StatusLine`, `SystemNotice`; use `SelectCard`/`KeyHints`/`Spinner` where
  they back Mokei's domain wrappers.
- **Keep domain components local:** `AssistantMessage`, `UserMessage`,
  `ToolApprovalCard`, `ToolCallStatus`, `ToolResultCard`, `PendingTurn`,
  `ReasoningView`, `WaitingStatus`, `SlashSuggestions`, `HelpCard`, `LlamaPathCard`,
  `ModelSelectCard`, `ProviderSelectCard`, `ToolSelectCard` (domain `SelectCard`
  wrappers).
- Gate: `pnpm --filter @mokei/cli test` green.

### B4. Verify Phase B

After each step's per-filter gate, full `pnpm build && pnpm test && pnpm lint` green,
then drive the real `mokei` binary over a PTY (real-stdio QA) to catch TUI render-state
regressions the unit tests miss. Commit as **PR 2**.

---

## Risks

- **`dist`→`lib` touches bin scripts.** A missed path silently breaks the runtime, not
  the build. The PTY smoke test (A4 + B4) is the catch.
- **Phase B is API-shaped, not a pure rename.** Tejika's donor→tejika mapping (its
  migration plan, §"Donor → tejika mapping") guides diffing the replaced code against
  the originals; the per-filter tests are the gate.
- **`host.ts` ContextHost deps.** It still needs `@enkaku/client` + `@enkaku/node-streams`
  for stdio after daemon code leaves — re-verify the trimmed source before dropping any
  enkaku dep from `@mokei/host`.
- **Min-release-age block.** Just-published upstream versions trip pnpm's
  `minimumReleaseAge`; the explicit exclude pins (A3) must list every fresh version.

## Out of scope

- Kigu plugin-marketplace face (`.claude-plugin/marketplace.json`, local domain plugin,
  AGENTS/SHARED derivation) — config face only.
- Any `@kokuin` / `@kumiai` adoption (Mokei consumes neither).
- Refactoring Mokei-specific logic (ContextHost, providers, session/agent layers) beyond
  the dependency rewrites above.
