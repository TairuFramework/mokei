# CLI Refactor: Replace oclif with commander, flatten + unify commands

**Date:** 2026-06-05
**Status:** Approved design
**Package:** `packages/cli` (`mokei`)

## Goal

Remove the oclif command framework from the mokei CLI, replacing it with
[`commander`](https://github.com/tj/commander.js) as a thin arg router. Keep the
CLI fully Ink-based for its UI, flatten the command tree to top level, and fold
the three provider-specific chat commands into a single `mokei chat` command
with a provider flag plus an interactive fallback prompt. Drop dead dependencies
(`enquirer`, `ora`) along the way.

## Motivation

- oclif brings a plugin system, manifest/readme generation, and a class-based
  command model that this 6-command CLI does not need.
- `commander` is the same library oclif and pastel build on, minus the
  abstraction. It lets us call Ink `render()` exactly where a UI is wanted and
  skip it entirely where it is harmful (the `proxy` stdio passthrough).
- pastel was considered and rejected: it forces an Ink `render()` on **every**
  command (which corrupts `proxy`'s raw stdio transport) and forces a `zod`
  dependency, while its file-based discovery buys little for a handful of known
  commands.
- `enquirer` and `ora` are already dead — zero imports, only stale catalog
  entries.

## Non-goals

- No change to the chat TUI itself (`src/chat/ChatApp.tsx` and its components and
  hooks are untouched apart from the new launcher wrapper).
- No user-facing plugin system (oclif `@oclif/plugin-plugins` is dropped with no
  replacement).
- No auto-generated README command section (oclif `readme` is dropped; the
  commands block becomes hand-written).

## Architecture

A single `commander` program with **four flat leaf commands** — no command
groups. Each command's action handler does what its current oclif `run()` body
does. Ink is used per-command by choice: UI commands call a `runInk()` helper;
`proxy` never touches Ink so its stdin/stdout stay a pristine MCP transport.

`bin/run.js` and `bin/dev.js` both shrink to importing and calling `run` from the
built `dist/index.js`. swc keeps emitting `dist/` (commander needs no build step).
The existing PTY end-to-end harness keeps driving `bin/dev.js`.

### Command surface (flat, breaking)

| Command | Options |
|---------|---------|
| `mokei chat` | `--provider -p <ollama\|openai\|anthropic>` (optional), `--api-key -k`, `--api-url -u`, `--model -m`, `--timeout -t` |
| `mokei inspect <command> [args...]` | variadic passthrough |
| `mokei monitor` | `--path -s`, `--port -p` |
| `mokei proxy <command> [args...]` | `--path -s`, variadic passthrough |

Breaking changes from the current surface:

- `mokei chat ollama` / `chat openai` / `chat anthropic` → `mokei chat --provider <name>`.
- `mokei context inspect` → `mokei inspect`.
- `mokei context monitor` → `mokei monitor`.
- `mokei context proxy` → `mokei proxy` (matters most: MCP clients spawn this by
  name in their config).

### Short-flag remap

`--api-url` previously squatted on `-p` (inherited from the old `providerAPIFlag`),
which reads like "provider"/"port". Refactor fixes it:

| Flag | Old short | New short |
|------|-----------|-----------|
| `--provider` | n/a | `-p` |
| `--api-url` | `-p` | `-u` |
| `--api-key` | `-k` | `-k` |
| `--model` | `-m` | `-m` |
| `--timeout` | `-t` | `-t` |
| `--path` | `-s` | `-s` |
| `--port` (monitor) | `-p` | `-p` |

`-p` = provider on `chat`, and `-p` = port on `monitor`. commander shorts are
per-command, so reuse across commands is fine.

## File structure

```
packages/cli/src/
  index.ts                 run(argv): build program + parseAsync (replaces `export { run } from @oclif/core`)
  program.ts               buildProgram(): attaches chat, inspect, monitor, proxy to the root program
  options.ts               (renamed from flags.ts) commander option-adders: withProviderOptions(cmd), pathOption(cmd), portOption(cmd)
  ink.ts                   runInk(element): render(element, { exitOnCtrlC: false }) + waitUntilExit()
  commands/
    chat.tsx               createChatCommand()
    inspect.tsx            createInspectCommand()   -> renders <InspectResult>
    monitor.tsx            createMonitorCommand()   -> renders <MonitorStatus>
    proxy.ts               createProxyCommand()     -> pure stdio pipe, NO Ink
  chat/
    ChatLauncher.tsx       picks provider (flag or <ProviderSelectCard>), builds session, renders <ChatApp>
    providers.ts           buildChatApp(provider, opts): Promise<ReactNode>
    components/ProviderSelectCard.tsx   @inkjs/ui Select over the 3 providers
    ChatApp.tsx + components/ + hooks/  (existing UI, untouched)
```

The `commands/chat/` and `commands/context/` subdirectories are removed. The
three deleted `commands/chat/*.tsx` files have their per-provider construction
logic moved into `buildChatApp`'s switch. Each command file exports one
`createXCommand(): Command` factory; `program.ts` composes them, which makes the
whole command tree testable by introspection without spawning.

## Per-command behavior

### chat

`createChatCommand()` defines the options above and, in its action handler, calls
`runInk(<ChatLauncher provider={opts.provider} apiKey={...} apiUrl={...} model={...} timeoutMs={...} />)`.

`ChatLauncher` (Ink component):

- State `provider: string | undefined`, initialized from the `--provider` flag.
- `provider == null` → render `<ProviderSelectCard onSelect={setProvider} />`.
- `provider` set → an effect calls `buildChatApp(provider, opts)`; while
  `ProxyHost.forDaemon()` resolves, render a "connecting…" spinner; on resolve,
  render the returned `<ChatApp>` element. The effect's cleanup disposes the
  built session.

`buildChatApp(provider, opts): Promise<ReactNode>`:

- `const host = await ProxyHost.forDaemon()`.
- `switch (provider)` with one monomorphic branch per provider, each constructing
  the matching `Session<T>` + provider instance and returning a typed
  `<ChatApp session={...} provider={...} providerKey={...} initialModel={opts.model} timeout={opts.timeoutMs} />`.
  Returning a `ReactNode` keeps each branch type-sound with no `any`.
- API-key env resolution per provider (commander cannot bind one `--api-key` to
  two env vars): `const apiKey = opts.apiKey ?? process.env[ENV[provider]]`, where
  `ENV = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }`. ollama
  ignores the key.

`ProviderSelectCard`: an `@inkjs/ui` `Select` over `['ollama', 'openai', 'anthropic']`,
matching the existing `ModelSelectCard` style; esc cancels (exits).

### inspect

`createInspectCommand()` with a required `<command>` argument and variadic
`[args...]` (commander `.argument('<command>')` + `.argument('[args...]')`).
Handler runs the existing async work — `spawnHostedContext`, `client.initialize()`,
dispose — then renders a static `<InspectResult>` Ink frame (pretty-printed JSON,
or an error via `@inkjs/ui` `StatusMessage`), unmounts, and exits. Replaces the
current `console.log`/`logJson`. Exit code is non-zero on failure.

### monitor

`createMonitorCommand()` with `--path -s` and `--port -p`. Handler starts the
daemon (`runDaemon`) and the monitor HTTP server (`startMonitor`), then renders
`<MonitorStatus url={...} />`, which stays mounted (Ink keeps the process alive).
SIGINT disposes the monitor and exits.

### proxy

`createProxyCommand()` with `--path -s`, a required `<command>` argument, and
variadic `[args...]`. **No Ink.** Handler runs the existing transport pipe
(`runDaemon` → `createChannel('spawn', ...)` → `createTransportStream({ readable: process.stdin, writable: process.stdout })` →
`Promise.all([channel.readable.pipeTo(stdio.writable), stdio.readable.pipeTo(channel.writable)])`).
commander `.passThroughOptions()` + the variadic argument replace oclif
`strict = false`, so flags after `<command>` flow to the spawned server.

## Dependency & build changes

**Remove (cli `package.json`):**

- deps: `@oclif/core`, `@oclif/plugin-help`, `@oclif/plugin-plugins`
- devDeps: `oclif`, `@oclif/test`
- the `oclif` config block
- scripts `prepack` (`oclif manifest && oclif readme`) and `version` (`oclif readme`)
- `oclif.manifest.json` from the `files` array

**Remove (catalog in `pnpm-workspace.yaml`):** `oclif`, `@oclif/core`,
`@oclif/plugin-help`, `@oclif/plugin-plugins`, `@oclif/test`, and the dead
`enquirer` + `ora` entries.

**Add:** `commander` (catalog + cli dep). No `zod` (that was pastel-only).

**Keep:** swc build, `nano-spawn` (host uses it too), `ink`, `@inkjs/ui`, `react`,
`ink-testing-library`.

**bin entries:**

```js
// bin/run.js
#!/usr/bin/env node
import { run } from '../dist/index.js'
await run(process.argv)
```

```js
// bin/dev.js
#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { run } from '../dist/index.js'
await run(process.argv)
```

Both run the built `dist` (JSX/`.tsx` cannot be stripped at runtime, so a build is
required — consistent with the current dev-runs-from-dist behavior).

**README:** replace the oclif-generated `<!-- commands -->…<!-- commandsstop -->`
block with a hand-written commands section reflecting the flat surface.

## Testing

### Unit tests (packages/cli/test/)

- **program introspection** (`test/program.test.ts`): `buildProgram()` exposes
  exactly `chat`, `inspect`, `monitor`, `proxy`; assert each command's options,
  short chars, choices (`--provider`), env bindings, and that `inspect` and `proxy`
  accept a variadic passthrough argument. No spawning.
- **ChatLauncher** (`test/chat/ChatLauncher.test.tsx`): with no `--provider`,
  renders `<ProviderSelectCard>`; selecting a provider transitions to the
  connecting state. Uses `ink-testing-library`.
- **ProviderSelectCard** (`test/chat/ProviderSelectCard.test.tsx`): renders 3
  options; selecting one fires onSelect with the key; esc fires onCancel.
- **Existing 12 unit tests:** untouched (router-agnostic; none import oclif).

### E2E integration tests (integration-tests/)

**ChatDriver update:** all 3 existing CLI suites (`cli-chat`, `cli-chat-context`,
`cli-chat-tools`) spawn `chat ollama --model …` today via `ChatDriver`. The
constructor must change to `chat --provider ollama --model …`. One-line change in
`integration-tests/support/chat-driver.ts`; all 8 existing tests stay green.

- **E2E (existing) — cli-chat.test.ts** (2 tests): approve tool call → answer;
  esc cancels while thinking.
- **E2E (existing) — cli-chat-context.test.ts** (3 tests): add opens tool-select;
  remove confirms on y; remove cancelled on esc.
- **E2E (existing) — cli-chat-tools.test.ts** (3 tests): approval card shows
  namespaced tool; deny returns idle; /tools lists tools.
- **E2E (new) — interactive provider select** (added to `cli-chat.test.ts`): spawn
  `chat` with no `--provider`, assert the provider-select prompt renders, select
  "ollama", assert chat starts (ready prompt appears).
- **E2E (new) — proxy stdio round-trip** (`integration-tests/suites/cli-proxy.test.ts`):
  spawn `bin/dev.js proxy <fetch-server>` via `child_process.spawn` (NOT node-pty —
  proxy needs raw pipes, not a TTY), write an MCP `initialize` JSON-RPC request to
  stdin, assert a well-formed JSON-RPC response on stdout with **zero Ink/ANSI
  escape bytes**. This is the regression that proves the framework swap did not
  corrupt the passthrough.
- **E2E (new) — help/version** (`integration-tests/suites/cli-help.test.ts`):
  spawn `bin/dev.js --help`, assert all 4 command names appear; spawn
  `bin/dev.js --version`, assert output matches a semver pattern. Low-cost wiring
  sanity check.
- **E2E (new) — inspect** (`integration-tests/suites/cli-inspect.test.ts`): spawn
  `bin/dev.js inspect node <fetch-server>`, assert output contains the server's
  JSON-RPC capabilities (proves the new Ink `<InspectResult>` renders correctly).
  Uses `child_process.spawn` (no TTY needed — inspect renders a static frame and
  exits).

## Error handling / edge cases

- commander parse errors → its standard stderr output + non-zero exit (replacing
  oclif's error reporting).
- `inspect` failure renders the error frame and exits non-zero.
- `--help` / `--version` handled by commander; version read from `package.json`.
- Ctrl+C: chat keeps `exitOnCtrlC: false` (the app owns quit handling); `monitor`
  and `proxy` handle SIGINT in their handlers.
- Selecting `openai`/`anthropic` interactively with no key/env: the provider errors
  on first model call, matching today's behavior.
- Dropping the `context` namespace loses the hint that inspect/proxy/monitor act on
  MCP context servers; clear command `description` strings compensate.

## Memory follow-ups

- Update the `cli-real-stdio-qa` memory note: `ChatDriver` now spawns
  `chat --provider <name>`, not `chat <name>`.
