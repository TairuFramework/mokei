# CLI Commander Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace oclif with commander as the CLI arg router, flatten all commands to top-level, and unify the three chat commands into a single `mokei chat` with a `--provider` flag and interactive fallback.

**Architecture:** A single commander `Command` program wired in `program.ts`, with four flat leaf commands (chat, inspect, monitor, proxy). Each command file exports a `createXCommand(): Command` factory. Ink `render()` is called per-command where UI is wanted; `proxy` never touches Ink. The three chat commands collapse into `ChatLauncher.tsx`, which renders a provider-select card when `--provider` is omitted.

**Tech Stack:** commander (^15.0.0), ink (^7.0.1), @inkjs/ui (^2.0.0), react (^19.2.6), vitest, node-pty (integration tests), swc (build)

**Spec:** `docs/superpowers/specs/2026-06-05-cli-commander-migration-design.md`

**Important conventions (from AGENTS.md and docs/agents/conventions.md):**
- Use `type` not `interface`
- Use `Array<T>` not `T[]`
- Use `#privateField` for private members
- Use `test` not `it` for test cases
- Never use `any` — use `unknown` or specific types
- Always use `pnpm`/`pnpx`, never `npm`/`npx`
- Run `pnpm run lint` (via `rtk proxy pnpm run lint`) before committing
- The CLI `dist/` must be rebuilt after src changes: `pnpm --filter mokei build`
- `bin/dev.js` runs from `dist/`, not `src/`

---

### Task 1: Add commander to catalog and cli deps, remove oclif + dead deps

This task swaps the dependency declarations. No code changes yet — just `pnpm-workspace.yaml` and `packages/cli/package.json`. The build will be broken after this until Task 2 rewires `index.ts`.

**Files:**
- Modify: `pnpm-workspace.yaml:29-31,49,60-61` (remove oclif/enquirer/ora catalog entries, add commander)
- Modify: `packages/cli/package.json` (remove oclif deps/devDeps/config/scripts, add commander, clean files array)

- [ ] **Step 1: Update pnpm-workspace.yaml catalog**

Remove these catalog lines:
```
  '@oclif/core': ^4.11.4
  '@oclif/plugin-help': ^6.2.49
  '@oclif/plugin-plugins': ^5.4.69
  '@oclif/test': ^4.1.18
  enquirer: ^2.4.1
  oclif: ^4.23.8
  ora: ^9.4.0
```

Add this catalog line (alphabetical, between `ink-testing-library` and `jotai`):
```
  commander: ^15.0.0
```

- [ ] **Step 2: Update packages/cli/package.json**

Replace the entire file with:
```json
{
  "name": "mokei",
  "version": "0.7.0",
  "license": "MIT",
  "homepage": "https://mokei.dev",
  "description": "Mokei CLI",
  "keywords": [
    "model",
    "context",
    "protocol",
    "mcp",
    "llm",
    "ai",
    "cli"
  ],
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "main": "dist/index.js",
  "files": [
    "/bin",
    "/dist"
  ],
  "bin": {
    "mokei": "./bin/run.js"
  },
  "scripts": {
    "mokei": "./bin/dev.js",
    "build:clean": "del dist",
    "build:dist": "swc src -d ./dist --config-file ./swc.json --strip-leading-paths",
    "build": "pnpm run build:clean && pnpm run test:types && pnpm run build:dist",
    "test:types": "tsc --noEmit --skipLibCheck",
    "test:unit": "vitest run",
    "test": "pnpm run test:types && pnpm run test:unit"
  },
  "dependencies": {
    "@enkaku/async": "catalog:",
    "@enkaku/node-streams-transport": "catalog:",
    "@enkaku/stream": "catalog:",
    "@inkjs/ui": "catalog:",
    "@mokei/anthropic-provider": "workspace:^",
    "@mokei/context-client": "workspace:^",
    "@mokei/context-protocol": "workspace:^",
    "@mokei/host": "workspace:^",
    "@mokei/host-monitor": "workspace:^",
    "@mokei/host-protocol": "workspace:^",
    "@mokei/model-provider": "workspace:^",
    "@mokei/ollama-provider": "workspace:^",
    "@mokei/openai-provider": "workspace:^",
    "@mokei/session": "workspace:^",
    "commander": "catalog:",
    "eventsource-parser": "catalog:",
    "ink": "catalog:",
    "ky": "catalog:",
    "nano-spawn": "catalog:",
    "react": "catalog:"
  },
  "devDependencies": {
    "@types/react": "catalog:",
    "ink-testing-library": "catalog:",
    "react-dom": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Key changes vs current:
- Removed deps: `@oclif/core`, `@oclif/plugin-help`, `@oclif/plugin-plugins`
- Removed devDeps: `@oclif/test`, `oclif`
- Removed `oclif` config block entirely
- Removed scripts: `prepack`, `version`
- Removed `/oclif.manifest.json` from `files`
- Added dep: `commander: "catalog:"`

- [ ] **Step 3: Install dependencies**

Run: `pnpm install`
Expected: lockfile updates, no errors. Commander resolves to ^15.0.0.

- [ ] **Step 4: Delete oclif.manifest.json**

Run: `rm packages/cli/oclif.manifest.json` (if it exists — it may only be generated during prepack)

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml packages/cli/package.json pnpm-lock.yaml
git rm packages/cli/oclif.manifest.json 2>/dev/null || true
git commit -m "refactor(cli): swap oclif for commander, remove dead enquirer/ora catalog entries"
```

---

### Task 2: Create core program wiring (index.ts, program.ts, options.ts, ink.ts)

This task builds the commander program skeleton and the shared utilities. After this, the CLI will be structurally runnable but missing the actual command implementations (which come in Tasks 3–6).

**Files:**
- Rewrite: `packages/cli/src/index.ts`
- Create: `packages/cli/src/program.ts`
- Rewrite: `packages/cli/src/flags.ts` → rename to `packages/cli/src/options.ts`
- Create: `packages/cli/src/ink.ts`
- Modify: `packages/cli/bin/run.js`
- Modify: `packages/cli/bin/dev.js`
- Modify: `packages/cli/bin/run.cmd`
- Modify: `packages/cli/bin/dev.cmd`

- [ ] **Step 1: Create `packages/cli/src/ink.ts`**

`runInk(Component, props, options?)` builds the element internally so command
files never call `createElement`. It defaults `exitOnCtrlC: false` (chat owns its
own Ctrl+C handling) but lets callers override (monitor wants ink's default
Ctrl+C exit). `renderStatic` renders a one-shot frame and unmounts immediately —
for commands like `inspect` that print and exit rather than staying mounted.

```tsx
import { type RenderOptions, render } from 'ink'
import { type ComponentType, createElement } from 'react'

export async function runInk<P extends object>(
  Component: ComponentType<P>,
  props: P = {} as P,
  options: RenderOptions = {},
): Promise<void> {
  const app = render(createElement(Component, props), { exitOnCtrlC: false, ...options })
  await app.waitUntilExit()
}

export function renderStatic<P extends object>(
  Component: ComponentType<P>,
  props: P = {} as P,
): void {
  const { unmount } = render(createElement(Component, props))
  unmount()
}
```

- [ ] **Step 2: Delete `packages/cli/src/flags.ts` and create `packages/cli/src/options.ts`**

Delete: `packages/cli/src/flags.ts`

Create `packages/cli/src/options.ts`:
```ts
import type { Command } from 'commander'

import { DEFAULT_SOCKET_PATH } from '@mokei/host-protocol'

export function withChatOptions(cmd: Command): Command {
  return cmd
    .option('-p, --provider <name>', 'model provider (ollama, openai, anthropic)')
    .option('-k, --api-key <key>', 'provider API key')
    .option('-u, --api-url <url>', 'provider API URL')
    .option('-m, --model <name>', 'name of the model to use')
    .option('-t, --timeout <seconds>', 'agent turn timeout in seconds', '300')
}

export function withSocketPath(cmd: Command): Command {
  return cmd.option('-s, --path <path>', 'socket path', DEFAULT_SOCKET_PATH)
}
```

- [ ] **Step 3: Create `packages/cli/src/program.ts`**

This is a stub that will be filled as commands are implemented in Tasks 3–6. For now, create it with just the program setup and a placeholder comment so the build doesn't fail.

```ts
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; description: string }

export function buildProgram(): Command {
  const program = new Command()
    .name('mokei')
    .description(pkg.description)
    .version(pkg.version, '-v, --version')

  return program
}
```

- [ ] **Step 4: Rewrite `packages/cli/src/index.ts`**

```ts
import { buildProgram } from './program.js'

export { buildProgram }

export async function run(argv: Array<string>): Promise<void> {
  const program = buildProgram()
  await program.parseAsync(argv)
}
```

- [ ] **Step 5: Rewrite `packages/cli/bin/run.js`**

```js
#!/usr/bin/env node

import { run } from '../dist/index.js'

await run(process.argv)
```

- [ ] **Step 6: Rewrite `packages/cli/bin/dev.js`**

```js
#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { run } from '../dist/index.js'

await run(process.argv)
```

- [ ] **Step 7: Rewrite `packages/cli/bin/run.cmd`**

```cmd
@echo off

node "%~dp0\run.js" %*
```

- [ ] **Step 8: Rewrite `packages/cli/bin/dev.cmd`**

```cmd
@echo off

node --disable-warning=ExperimentalWarning "%~dp0\dev.js" %*
```

- [ ] **Step 9: Build and verify**

Run: `pnpm --filter mokei build`
Expected: build succeeds. The old oclif imports in `commands/` will cause failures — that's expected since those files still import from `@oclif/core`. We'll delete/replace them in the next tasks.

If the build fails on the command files, temporarily delete the `src/commands/` directory contents (the old oclif commands) to confirm the skeleton compiles:
```bash
rm -rf packages/cli/src/commands/chat packages/cli/src/commands/context
```
Then rebuild. The command directories will be recreated in Tasks 3–6.

- [ ] **Step 10: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/program.ts packages/cli/src/options.ts packages/cli/src/ink.ts packages/cli/bin/
git rm packages/cli/src/flags.ts
git rm -rf packages/cli/src/commands/chat packages/cli/src/commands/context
git commit -m "refactor(cli): add commander program skeleton, replace oclif flags with options.ts"
```

---

### Task 3: Implement the unified chat command + ChatLauncher + ProviderSelectCard

This task replaces the three oclif chat commands with a single commander chat command that uses a ChatLauncher component to handle provider selection.

**Files:**
- Create: `packages/cli/src/commands/chat.tsx`
- Create: `packages/cli/src/chat/ChatLauncher.tsx`
- Create: `packages/cli/src/chat/providers.ts`
- Create: `packages/cli/src/chat/components/ProviderSelectCard.tsx`
- Modify: `packages/cli/src/program.ts` (add chat command)

- [ ] **Step 1: Create `packages/cli/src/chat/components/ProviderSelectCard.tsx`**

```tsx
import { Select } from '@inkjs/ui'
import { Box, Text, useApp, useInput } from 'ink'

const PROVIDERS = [
  { label: 'ollama', value: 'ollama' },
  { label: 'openai', value: 'openai' },
  { label: 'anthropic', value: 'anthropic' },
] as const

export type ProviderSelectCardProps = {
  onSelect: (provider: string) => void
  onCancel: () => void
}

export function ProviderSelectCard({ onSelect, onCancel }: ProviderSelectCardProps) {
  const { exit } = useApp()
  useInput((_, key) => {
    if (key.escape) {
      onCancel()
      exit()
    }
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Text color="cyan">select a provider</Text>
      <Select options={[...PROVIDERS]} onChange={(value) => onSelect(value)} />
      <Text dimColor>[esc] quit</Text>
    </Box>
  )
}
```

- [ ] **Step 2: Create `packages/cli/src/chat/providers.ts`**

```tsx
import { type ReactNode, createElement } from 'react'

import { AnthropicProvider, type AnthropicTypes } from '@mokei/anthropic-provider'
import { ProxyHost } from '@mokei/host'
import type { ModelProvider, ProviderTypes } from '@mokei/model-provider'
import { OllamaProvider, type OllamaTypes } from '@mokei/ollama-provider'
import { OpenAIProvider, type OpenAITypes } from '@mokei/openai-provider'
import { Session } from '@mokei/session'

import { ChatApp, type ChatAppProps } from './ChatApp.js'

const API_KEY_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

export type ChatOptions = {
  apiKey?: string
  apiUrl?: string
  model?: string
  timeoutMs?: number
}

export type BuiltChat = {
  element: ReactNode
  dispose: () => Promise<void>
}

export async function buildChat(provider: string, opts: ChatOptions): Promise<BuiltChat> {
  const host = await ProxyHost.forDaemon()
  const apiKey = opts.apiKey ?? process.env[API_KEY_ENV[provider] ?? '']
  const timeoutMs = opts.timeoutMs

  function build<T extends ProviderTypes>(
    session: Session<T>,
    providerInstance: ModelProvider<T>,
    providerKey: string,
  ): BuiltChat {
    return {
      element: createElement<ChatAppProps<T>>(ChatApp, {
        session,
        provider: providerInstance,
        providerKey,
        initialModel: opts.model,
        timeout: timeoutMs,
      }),
      dispose: () => session.dispose(),
    }
  }

  switch (provider) {
    case 'ollama': {
      const p = new OllamaProvider({ client: { baseURL: opts.apiUrl, timeout: false } })
      const session = new Session<OllamaTypes>({ contextHost: host, providers: { ollama: p } })
      return build(session, p, 'ollama')
    }
    case 'openai': {
      const p = new OpenAIProvider({
        client: { apiKey, baseURL: opts.apiUrl, timeout: false },
      })
      const session = new Session<OpenAITypes>({ contextHost: host, providers: { openai: p } })
      return build(session, p, 'openai')
    }
    case 'anthropic': {
      const p = new AnthropicProvider({
        client: { apiKey, baseURL: opts.apiUrl, timeout: false },
      })
      const session = new Session<AnthropicTypes>({
        contextHost: host,
        providers: { anthropic: p },
      })
      return build(session, p, 'anthropic')
    }
    default:
      throw new Error(`unknown provider: ${provider}`)
  }
}
```

Note: the `build<T>` helper uses `createElement<ChatAppProps<T>>(ChatApp, …)`
rather than JSX because `<ChatApp<T> …>` is not valid JSX value syntax for a
generic component. Each `switch` branch is monomorphic, so the provider instance
(`OllamaProvider`, etc.) satisfies `ModelProvider<T>` with no cast.

- [ ] **Step 3: Create `packages/cli/src/chat/ChatLauncher.tsx`**

```tsx
import { Spinner } from '@inkjs/ui'
import { Box, Text, useApp } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { ProviderSelectCard } from './components/ProviderSelectCard.js'
import { type BuiltChat, type ChatOptions, buildChat } from './providers.js'

export type ChatLauncherProps = {
  initialProvider?: string
  chatOptions: ChatOptions
}

export function ChatLauncher({ initialProvider, chatOptions }: ChatLauncherProps) {
  const { exit } = useApp()
  const [provider, setProvider] = useState<string | undefined>(initialProvider)
  const [chat, setChat] = useState<BuiltChat | null>(null)
  const [error, setError] = useState<string | null>(null)
  const disposeRef = useRef<(() => Promise<void>) | null>(null)

  const handleCancel = useCallback(() => {
    exit()
  }, [exit])

  useEffect(() => {
    if (provider == null) return

    let cancelled = false
    buildChat(provider, chatOptions).then(
      (built) => {
        if (cancelled) {
          void built.dispose()
          return
        }
        disposeRef.current = built.dispose
        setChat(built)
      },
      (err) => {
        if (!cancelled) setError((err as Error).message)
      },
    )

    return () => {
      cancelled = true
      void disposeRef.current?.()
    }
  }, [provider, chatOptions])

  if (error != null) {
    return (
      <Box paddingX={1}>
        <Text color="red">error: {error}</Text>
      </Box>
    )
  }

  if (provider == null) {
    return <ProviderSelectCard onSelect={setProvider} onCancel={handleCancel} />
  }

  if (chat == null) {
    return (
      <Box paddingX={1}>
        <Spinner label={`connecting to ${provider}…`} />
      </Box>
    )
  }

  return chat.element as ReactNode
}
```

- [ ] **Step 4: Create `packages/cli/src/commands/chat.tsx`**

```tsx
import { Command } from 'commander'

import { ChatLauncher } from '../chat/ChatLauncher.js'
import { runInk } from '../ink.js'
import { withChatOptions } from '../options.js'

export function createChatCommand(): Command {
  const cmd = new Command('chat').description('Interactive chat with a model provider')

  withChatOptions(cmd)

  cmd.action(async (opts: Record<string, string | undefined>) => {
    const timeoutSec = Number.parseInt(opts.timeout ?? '300', 10)
    await runInk(ChatLauncher, {
      initialProvider: opts.provider,
      chatOptions: {
        apiKey: opts.apiKey,
        apiUrl: opts.apiUrl,
        model: opts.model,
        timeoutMs: timeoutSec * 1000,
      },
    })
  })

  return cmd
}
```

- [ ] **Step 5: Wire chat into program.ts**

Update `packages/cli/src/program.ts` — add the import and registration:

```ts
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'

import { createChatCommand } from './commands/chat.js'

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; description: string }

export function buildProgram(): Command {
  const program = new Command()
    .name('mokei')
    .description(pkg.description)
    .version(pkg.version, '-v, --version')

  program.addCommand(createChatCommand())

  return program
}
```

- [ ] **Step 6: Build and smoke test**

Run: `pnpm --filter mokei build`
Expected: build succeeds.

Run: `packages/cli/bin/dev.js --help`
Expected: shows `mokei` with `chat` command listed.

Run: `packages/cli/bin/dev.js chat --help`
Expected: shows `--provider`, `--api-key`, `--api-url`, `--model`, `--timeout` options.

Run: `packages/cli/bin/dev.js chat --provider ollama --model lfm2.5:latest`
Expected: chat TUI starts (requires running ollama). Ctrl+C twice to quit.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/chat.tsx packages/cli/src/chat/ChatLauncher.tsx packages/cli/src/chat/providers.ts packages/cli/src/chat/components/ProviderSelectCard.tsx packages/cli/src/program.ts
git commit -m "feat(cli): unified chat command with provider flag and interactive select"
```

---

### Task 4: Implement the inspect command (Ink-based)

**Files:**
- Create: `packages/cli/src/commands/inspect.tsx`
- Modify: `packages/cli/src/program.ts` (add inspect command)

- [ ] **Step 1: Create `packages/cli/src/commands/inspect.tsx`**

Note: `inspect` renders static output (JSON or error) then exits, so it uses
`renderStatic` (render + immediate unmount) rather than `runInk`, which would
hang on `waitUntilExit()` since nothing calls `exit()`.

```tsx
import { type HostedContext, spawnHostedContext } from '@mokei/host'
import { StatusMessage } from '@inkjs/ui'
import { Command } from 'commander'
import { Box, Text } from 'ink'

import { renderStatic } from '../ink.js'

function InspectResult({ data }: { data: string }) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="green">initialized</Text>
      <Text>{data}</Text>
    </Box>
  )
}

function InspectError({ message }: { message: string }) {
  return <StatusMessage variant="error">{message}</StatusMessage>
}

export function createInspectCommand(): Command {
  const cmd = new Command('inspect')
    .description('Inspect an MCP context server')
    .argument('<command>', 'command to run the MCP server')
    .argument('[args...]', 'arguments for the server command')
    .passThroughOptions()

  cmd.action(async (command: string, args: Array<string>) => {
    let hosted: HostedContext | undefined
    try {
      hosted = await spawnHostedContext({ command, args })
      const initialized = await hosted.client.initialize()
      renderStatic(InspectResult, { data: JSON.stringify(initialized, null, 2) })
    } catch (err) {
      renderStatic(InspectError, { message: (err as Error).message })
      process.exitCode = 1
    } finally {
      await hosted?.disposer.dispose()
    }
  })

  return cmd
}
```

- [ ] **Step 2: Wire inspect into program.ts**

Add to imports at top of `packages/cli/src/program.ts`:
```ts
import { createInspectCommand } from './commands/inspect.js'
```

Add after the `addCommand(createChatCommand())` line:
```ts
  program.addCommand(createInspectCommand())
```

- [ ] **Step 3: Build and smoke test**

Run: `pnpm --filter mokei build`
Expected: succeeds.

Run: `packages/cli/bin/dev.js inspect --help`
Expected: shows `inspect <command> [args...]`.

Run: `packages/cli/bin/dev.js inspect node mcp-servers/fetch/lib/serve.js`
Expected: prints `initialized` + JSON with server capabilities. (Requires the fetch MCP server to be built: `pnpm --filter @mokei/mcp-fetch build`)

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/inspect.tsx packages/cli/src/program.ts
git commit -m "feat(cli): add inspect command with Ink output"
```

---

### Task 5: Implement the monitor command (Ink-based)

**Files:**
- Create: `packages/cli/src/commands/monitor.tsx`
- Modify: `packages/cli/src/program.ts` (add monitor command)

- [ ] **Step 1: Create `packages/cli/src/commands/monitor.tsx`**

Note: `MonitorStatus` is a pure presentational component. It stays mounted (ink
keeps the process alive on `waitUntilExit`) until the user presses Ctrl+C. We
pass `{ exitOnCtrlC: true }` so ink's own lifecycle handles the exit — no manual
`process.on('SIGINT')` inside React. Once `runInk` resolves, the handler disposes
the monitor server. (Trade-off: this catches an interactive Ctrl+C, matching the
common case; a raw `kill -INT` signal without a TTY would skip the dispose, same
as relying on process teardown.)

```tsx
import { runDaemon } from '@mokei/host'
import { startMonitor } from '@mokei/host-monitor'
import { Command } from 'commander'
import { Box, Text } from 'ink'

import { runInk } from '../ink.js'
import { withSocketPath } from '../options.js'

function MonitorStatus({ url }: { url: string }) {
  return (
    <Box paddingX={1}>
      <Text color="green">monitor running on {url}</Text>
    </Box>
  )
}

export function createMonitorCommand(): Command {
  const cmd = new Command('monitor').description('Start a context host monitor')

  withSocketPath(cmd)
  cmd.option('-p, --port <number>', 'port for the monitor UI server')

  cmd.action(async (opts: Record<string, string | undefined>) => {
    const socketPath = opts.path
    const port = opts.port != null ? Number.parseInt(opts.port, 10) : undefined
    await runDaemon({ socketPath })
    const monitor = await startMonitor({ port, socketPath })
    const url = `http://localhost:${monitor.port}/`
    await runInk(MonitorStatus, { url }, { exitOnCtrlC: true })
    await monitor.disposer.dispose()
  })

  return cmd
}
```

- [ ] **Step 2: Wire monitor into program.ts**

Add to imports at top of `packages/cli/src/program.ts`:
```ts
import { createMonitorCommand } from './commands/monitor.js'
```

Add after the inspect `addCommand` line:
```ts
  program.addCommand(createMonitorCommand())
```

- [ ] **Step 3: Build and verify help**

Run: `pnpm --filter mokei build`
Expected: succeeds.

Run: `packages/cli/bin/dev.js monitor --help`
Expected: shows `--path -s` and `--port -p` options.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/monitor.tsx packages/cli/src/program.ts
git commit -m "feat(cli): add monitor command with Ink status"
```

---

### Task 6: Implement the proxy command (no Ink, pure stdio)

**Files:**
- Create: `packages/cli/src/commands/proxy.ts`
- Modify: `packages/cli/src/program.ts` (add proxy command)

- [ ] **Step 1: Create `packages/cli/src/commands/proxy.ts`**

```ts
import { createTransportStream } from '@enkaku/node-streams-transport'
import { runDaemon } from '@mokei/host'
import { Command } from 'commander'

import { withSocketPath } from '../options.js'

export function createProxyCommand(): Command {
  const cmd = new Command('proxy')
    .description('Proxy an MCP context server on a host')
    .argument('<command>', 'command to run the MCP server')
    .argument('[args...]', 'arguments for the server command')
    .passThroughOptions()

  withSocketPath(cmd)

  cmd.action(async (command: string, args: Array<string>, opts: Record<string, string | undefined>) => {
    const client = await runDaemon({ socketPath: opts.path })
    const channel = client.createChannel('spawn', {
      param: { command, args },
    })
    const stdio = await createTransportStream({
      readable: process.stdin,
      writable: process.stdout,
    })
    await Promise.all([
      channel.readable.pipeTo(stdio.writable),
      stdio.readable.pipeTo(channel.writable),
    ])
  })

  return cmd
}
```

- [ ] **Step 2: Wire proxy into program.ts**

Add to imports at top of `packages/cli/src/program.ts`:
```ts
import { createProxyCommand } from './commands/proxy.js'
```

Add after the monitor `addCommand` line:
```ts
  program.addCommand(createProxyCommand())
```

The final `program.ts` should now have all 4 commands registered:
```ts
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'

import { createChatCommand } from './commands/chat.js'
import { createInspectCommand } from './commands/inspect.js'
import { createMonitorCommand } from './commands/monitor.js'
import { createProxyCommand } from './commands/proxy.js'

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; description: string }

export function buildProgram(): Command {
  const program = new Command()
    .name('mokei')
    .description(pkg.description)
    .version(pkg.version, '-v, --version')

  program.addCommand(createChatCommand())
  program.addCommand(createInspectCommand())
  program.addCommand(createMonitorCommand())
  program.addCommand(createProxyCommand())

  return program
}
```

- [ ] **Step 3: Build and verify help**

Run: `pnpm --filter mokei build`
Expected: succeeds.

Run: `packages/cli/bin/dev.js --help`
Expected: shows all 4 commands: `chat`, `inspect`, `monitor`, `proxy`.

Run: `packages/cli/bin/dev.js proxy --help`
Expected: shows `proxy <command> [args...]` with `--path -s`.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/proxy.ts packages/cli/src/program.ts
git commit -m "feat(cli): add proxy command (pure stdio, no Ink)"
```

---

### Task 7: Delete stale files and update README

**Files:**
- Delete: `packages/cli/src/commands/chat/` directory (ollama.tsx, openai.tsx, anthropic.tsx)
- Delete: `packages/cli/src/commands/context/` directory (inspect.ts, monitor.ts, proxy.ts)
- Delete: `packages/cli/src/flags.ts` (if not already deleted in Task 2)
- Modify: `packages/cli/README.md`

- [ ] **Step 1: Verify old command directories are already deleted**

Run: `ls packages/cli/src/commands/chat/ packages/cli/src/commands/context/ packages/cli/src/flags.ts 2>&1`
Expected: all should be "No such file or directory" (deleted in Task 2). If any still exist, delete them now:
```bash
rm -rf packages/cli/src/commands/chat packages/cli/src/commands/context
rm -f packages/cli/src/flags.ts
```

- [ ] **Step 2: Rewrite `packages/cli/README.md`**

```markdown
# Mokei CLI

## Usage

```sh-session
$ pnpm install -g mokei
$ mokei COMMAND
$ mokei --help
$ mokei --version
```

## Commands

### `mokei chat`

Interactive chat with a model provider.

```
Usage: mokei chat [options]

Options:
  -p, --provider <name>    model provider (ollama, openai, anthropic)
  -k, --api-key <key>      provider API key
  -u, --api-url <url>      provider API URL
  -m, --model <name>       name of the model to use
  -t, --timeout <seconds>  agent turn timeout in seconds (default: "300")
  -h, --help               display help for command
```

If `--provider` is omitted, an interactive provider selection prompt appears.

### `mokei inspect`

Inspect an MCP context server.

```
Usage: mokei inspect [options] <command> [args...]

Arguments:
  command   command to run the MCP server
  args      arguments for the server command
```

### `mokei monitor`

Start a context host monitor.

```
Usage: mokei monitor [options]

Options:
  -s, --path <path>    socket path (default: ~/.mokei-daemon.sock)
  -p, --port <number>  port for the monitor UI server
```

### `mokei proxy`

Proxy an MCP context server on a host.

```
Usage: mokei proxy [options] <command> [args...]

Arguments:
  command   command to run the MCP server
  args      arguments for the server command

Options:
  -s, --path <path>  socket path (default: ~/.mokei-daemon.sock)
```
```

- [ ] **Step 3: Build to confirm nothing references deleted files**

Run: `pnpm --filter mokei build`
Expected: succeeds with no import errors.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/README.md
git rm -rf packages/cli/src/commands/chat packages/cli/src/commands/context packages/cli/src/flags.ts 2>/dev/null || true
git commit -m "refactor(cli): remove old oclif commands and update README"
```

---

### Task 8: Unit tests — program introspection

**Files:**
- Create: `packages/cli/test/program.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/cli/test/program.test.ts`:

```ts
import { describe, expect, test } from 'vitest'

import { buildProgram } from '../src/program.js'

describe('buildProgram', () => {
  const program = buildProgram()
  const commandNames = program.commands.map((c) => c.name())

  test('exposes exactly 4 commands', () => {
    expect(commandNames).toEqual(['chat', 'inspect', 'monitor', 'proxy'])
  })

  test('chat has --provider with short -p', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')!
    const opt = chat.options.find((o) => o.long === '--provider')
    expect(opt).toBeDefined()
    expect(opt!.short).toBe('-p')
  })

  test('chat has --api-key with short -k', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')!
    const opt = chat.options.find((o) => o.long === '--api-key')
    expect(opt).toBeDefined()
    expect(opt!.short).toBe('-k')
  })

  test('chat has --api-url with short -u', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')!
    const opt = chat.options.find((o) => o.long === '--api-url')
    expect(opt).toBeDefined()
    expect(opt!.short).toBe('-u')
  })

  test('chat has --model with short -m', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')!
    const opt = chat.options.find((o) => o.long === '--model')
    expect(opt).toBeDefined()
    expect(opt!.short).toBe('-m')
  })

  test('chat has --timeout with short -t', () => {
    const chat = program.commands.find((c) => c.name() === 'chat')!
    const opt = chat.options.find((o) => o.long === '--timeout')
    expect(opt).toBeDefined()
    expect(opt!.short).toBe('-t')
  })

  test('inspect accepts a required command argument and variadic args', () => {
    const inspect = program.commands.find((c) => c.name() === 'inspect')!
    const args = inspect.registeredArguments
    expect(args.length).toBe(2)
    expect(args[0]!.required).toBe(true)
    expect(args[1]!.variadic).toBe(true)
  })

  test('proxy accepts a required command argument and variadic args', () => {
    const proxy = program.commands.find((c) => c.name() === 'proxy')!
    const args = proxy.registeredArguments
    expect(args.length).toBe(2)
    expect(args[0]!.required).toBe(true)
    expect(args[1]!.variadic).toBe(true)
  })

  test('monitor has --path with short -s and --port with short -p', () => {
    const monitor = program.commands.find((c) => c.name() === 'monitor')!
    const pathOpt = monitor.options.find((o) => o.long === '--path')
    expect(pathOpt).toBeDefined()
    expect(pathOpt!.short).toBe('-s')
    const portOpt = monitor.options.find((o) => o.long === '--port')
    expect(portOpt).toBeDefined()
    expect(portOpt!.short).toBe('-p')
  })

  test('proxy has --path with short -s', () => {
    const proxy = program.commands.find((c) => c.name() === 'proxy')!
    const pathOpt = proxy.options.find((o) => o.long === '--path')
    expect(pathOpt).toBeDefined()
    expect(pathOpt!.short).toBe('-s')
  })

  test('program has --version flag', () => {
    const versionOpt = program.options.find(
      (o) => o.long === '--version' || o.short === '-v',
    )
    expect(versionOpt).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter mokei test:unit`
Expected: all tests pass (both existing 12 + new program tests).

Note: if any existing test imports from `../src/flags.js` (unlikely — none do based on analysis), update those imports to `../src/options.js`.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/test/program.test.ts
git commit -m "test(cli): add program introspection tests for commander wiring"
```

---

### Task 9: Unit tests — ProviderSelectCard

**Files:**
- Create: `packages/cli/test/chat/ProviderSelectCard.test.tsx`

- [ ] **Step 1: Write the test**

Create `packages/cli/test/chat/ProviderSelectCard.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, test, vi } from 'vitest'

import { ProviderSelectCard } from '../../src/chat/components/ProviderSelectCard.js'

describe('ProviderSelectCard', () => {
  test('renders three provider options', () => {
    const { lastFrame } = render(
      <ProviderSelectCard onSelect={() => {}} onCancel={() => {}} />,
    )
    const frame = lastFrame()!
    expect(frame).toContain('ollama')
    expect(frame).toContain('openai')
    expect(frame).toContain('anthropic')
    expect(frame).toContain('select a provider')
  })

  test('selecting a provider calls onSelect', async () => {
    const onSelect = vi.fn()
    const { stdin } = render(
      <ProviderSelectCard onSelect={onSelect} onCancel={() => {}} />,
    )
    // Press enter to select the first item (ollama)
    stdin.write('\r')
    expect(onSelect).toHaveBeenCalledWith('ollama')
  })

  test('esc calls onCancel', async () => {
    const onCancel = vi.fn()
    // Use fake timers to handle ink's escape key buffer (ink waits ~20ms to
    // distinguish ESC from an ANSI sequence prefix)
    vi.useFakeTimers()
    const { stdin } = render(
      <ProviderSelectCard onSelect={() => {}} onCancel={onCancel} />,
    )
    stdin.write('\x1B')
    await vi.advanceTimersByTimeAsync(100)
    expect(onCancel).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter mokei test:unit`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/test/chat/ProviderSelectCard.test.tsx
git commit -m "test(cli): add ProviderSelectCard unit tests"
```

---

### Task 10: Update ChatDriver and verify existing e2e tests

The `ChatDriver` spawns `chat ollama --model` which must change to `chat --provider ollama --model`.

**Files:**
- Modify: `integration-tests/support/chat-driver.ts:55` (spawn args)
- Modify: `integration-tests/support/chat-driver.ts:1-8` (update doc comment)

- [ ] **Step 1: Update the ChatDriver constructor spawn args**

In `integration-tests/support/chat-driver.ts`, change line 55 from:
```ts
    this.#pty = spawn('node', [CLI_BINARY, 'chat', 'ollama', '--model', model], {
```
to:
```ts
    this.#pty = spawn('node', [CLI_BINARY, 'chat', '--provider', 'ollama', '--model', model], {
```

Also update the doc comment at the top (lines 2-3) from:
```
 * Drives the real `mokei chat ollama` binary over a PTY (node-pty) so the CLI
```
to:
```
 * Drives the real `mokei chat --provider ollama` binary over a PTY (node-pty) so the CLI
```

- [ ] **Step 2: Rebuild the CLI dist**

Run: `pnpm --filter mokei build`
Expected: succeeds.

- [ ] **Step 3: Run existing e2e tests**

Run: `pnpm --filter mokei-integration-tests test -- --testPathPattern cli-chat`
Expected: all 8 tests across cli-chat, cli-chat-context, cli-chat-tools pass.

If tests fail, check that ollama is running and lfm2.5:latest is pulled, and that the fetch MCP server is built.

- [ ] **Step 4: Commit**

```bash
git add integration-tests/support/chat-driver.ts
git commit -m "test(integration): update ChatDriver to use --provider flag"
```

---

### Task 11: E2E test — interactive provider select

**Files:**
- Modify: `integration-tests/suites/cli-chat.test.ts` (add test)
- Modify: `integration-tests/support/chat-driver.ts` (add `providerSelect` UI string + `ChatDriverOptions.provider`)

- [ ] **Step 1: Add provider-select UI string and make provider configurable**

In `integration-tests/support/chat-driver.ts`, add to the `UI` object:
```ts
  providerSelect: 'select a provider',
```

Add `provider` to `ChatDriverOptions`:
```ts
export type ChatDriverOptions = {
  provider?: string
  model?: string
  cols?: number
  rows?: number
}
```

Update the constructor to accept an optional provider (with `undefined` meaning "no `--provider` flag"):
```ts
  constructor({ provider = 'ollama', model = 'lfm2.5:latest', cols = 100, rows = 30 }: ChatDriverOptions = {}) {
    const args = [CLI_BINARY, 'chat']
    if (provider != null) {
      args.push('--provider', provider)
    }
    if (model != null) {
      args.push('--model', model)
    }
    this.#pty = spawn('node', args, {
      name: 'xterm-color',
      cols,
      rows,
      cwd: CLI_CWD,
      env: process.env as Record<string, string>,
    })
    this.#pty.onData((d) => {
      this.#buf += d
    })
  }
```

Wait — this changes the default behavior. The existing `ChatDriver()` calls must still work exactly as before. Let me adjust: keep the default `provider = 'ollama'` and `model = 'lfm2.5:latest'`. To spawn without `--provider`, the test will pass `provider: undefined` explicitly via the option type. Actually, let me just use `null` as the sentinel for "no provider flag":

Update `ChatDriverOptions`:
```ts
export type ChatDriverOptions = {
  provider?: string | null
  model?: string | null
  cols?: number
  rows?: number
}
```

And the constructor:
```ts
  constructor({ provider = 'ollama', model = 'lfm2.5:latest', cols = 100, rows = 30 }: ChatDriverOptions = {}) {
    const args = [CLI_BINARY, 'chat']
    if (provider != null) {
      args.push('--provider', provider)
    }
    if (model != null) {
      args.push('--model', model)
    }
    this.#pty = spawn('node', args, {
      name: 'xterm-color',
      cols,
      rows,
      cwd: CLI_CWD,
      env: process.env as Record<string, string>,
    })
    this.#pty.onData((d) => {
      this.#buf += d
    })
  }
```

This way: `new ChatDriver()` → `chat --provider ollama --model lfm2.5:latest` (same behavior as Task 10). `new ChatDriver({ provider: null, model: null })` → `chat` (no flags, triggers interactive select).

- [ ] **Step 2: Add the e2e test**

Add to `integration-tests/suites/cli-chat.test.ts`, inside the `describe` block, after the existing tests:

```ts
  test('interactive provider select starts chat after selection', async () => {
    const selectDriver = new ChatDriver({ provider: null, model: null })
    try {
      expect(await selectDriver.waitFor(UI.providerSelect, 15_000)).toBe(true)
      // Press enter to select the first option (ollama)
      selectDriver.write('\r')
      // After selection, the chat should start (shows "type a message" after connecting)
      expect(await selectDriver.waitFor(UI.ready, 30_000)).toBe(true)
    } finally {
      selectDriver.kill()
    }
  }, 60_000)
```

Note: this test creates its own `selectDriver` with `provider: null` (no `--provider` flag) rather than using the `driver` from `beforeEach`, because the `beforeEach` already starts chat with `--provider ollama` and adds a fetch context.

- [ ] **Step 3: Rebuild and run**

Run: `pnpm --filter mokei build`
Run: `pnpm --filter mokei-integration-tests test -- --testPathPattern cli-chat.test`
Expected: all 3 tests pass (2 existing + 1 new).

- [ ] **Step 4: Commit**

```bash
git add integration-tests/support/chat-driver.ts integration-tests/suites/cli-chat.test.ts
git commit -m "test(integration): add interactive provider-select e2e test"
```

---

### Task 12: E2E test — help/version

**Files:**
- Create: `integration-tests/suites/cli-help.test.ts`

- [ ] **Step 1: Write the test**

Create `integration-tests/suites/cli-help.test.ts`:

```ts
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI_CWD = resolve(ROOT, 'packages/cli')
const CLI_BINARY = resolve(CLI_CWD, 'bin/dev.js')

function runCLI(args: Array<string>): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_BINARY, ...args], { cwd: CLI_CWD })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('close', (code) => resolve({ stdout, stderr, code }))
  })
}

describe('CLI help and version', () => {
  test('--help lists all 4 commands', async () => {
    const { stdout } = await runCLI(['--help'])
    expect(stdout).toContain('chat')
    expect(stdout).toContain('inspect')
    expect(stdout).toContain('monitor')
    expect(stdout).toContain('proxy')
  })

  test('--version outputs a semver string', async () => {
    const { stdout } = await runCLI(['--version'])
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('chat --help shows provider and model options', async () => {
    const { stdout } = await runCLI(['chat', '--help'])
    expect(stdout).toContain('--provider')
    expect(stdout).toContain('--model')
    expect(stdout).toContain('--api-key')
    expect(stdout).toContain('--api-url')
    expect(stdout).toContain('--timeout')
  })
})
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter mokei-integration-tests test -- --testPathPattern cli-help`
Expected: all 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add integration-tests/suites/cli-help.test.ts
git commit -m "test(integration): add CLI help/version e2e tests"
```

---

### Task 13: E2E test — proxy stdio round-trip

**Files:**
- Create: `integration-tests/suites/cli-proxy.test.ts`

- [ ] **Step 1: Write the test**

Create `integration-tests/suites/cli-proxy.test.ts`:

```ts
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI_CWD = resolve(ROOT, 'packages/cli')
const CLI_BINARY = resolve(CLI_CWD, 'bin/dev.js')
const FETCH_SERVER = resolve(ROOT, 'mcp-servers/fetch/lib/serve.js')

function proxyRoundTrip(request: Record<string, unknown>): Promise<{ stdout: Buffer; hasAnsi: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_BINARY, 'proxy', 'node', FETCH_SERVER], {
      cwd: CLI_CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const chunks: Array<Buffer> = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d))

    const payload = JSON.stringify(request)
    const header = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n`
    child.stdin.write(header + payload)

    setTimeout(() => {
      child.kill()
      const stdout = Buffer.concat(chunks)
      // Check for ANSI escape sequences (ESC [ or ESC ])
      const hasAnsi = stdout.includes(0x1b)
      resolve({ stdout, hasAnsi })
    }, 5_000)

    child.on('error', reject)
  })
}

describe('CLI proxy — stdio round-trip', () => {
  test('MCP initialize returns a JSON-RPC response with zero ANSI bytes', async () => {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.1' },
      },
    }

    const { stdout, hasAnsi } = await proxyRoundTrip(request)
    expect(hasAnsi).toBe(false)

    // Parse the JSON-RPC response from the Content-Length framed body
    const text = stdout.toString('utf8')
    const bodyStart = text.indexOf('\r\n\r\n')
    expect(bodyStart).toBeGreaterThan(0)
    const body = text.slice(bodyStart + 4)
    const response = JSON.parse(body) as Record<string, unknown>
    expect(response.jsonrpc).toBe('2.0')
    expect(response.id).toBe(1)
    expect(response.result).toBeDefined()
  }, 15_000)
})
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter mokei-integration-tests test -- --testPathPattern cli-proxy`
Expected: test passes. Requires: the mokei daemon running, and the fetch MCP server built.

Note: if the daemon is not running, this test may hang or fail. That's an infrastructure prereq, same as the chat e2e tests. The test has a 5s timeout on the child process and a 15s vitest timeout.

- [ ] **Step 3: Commit**

```bash
git add integration-tests/suites/cli-proxy.test.ts
git commit -m "test(integration): add proxy stdio round-trip e2e test"
```

---

### Task 14: E2E test — inspect

**Files:**
- Create: `integration-tests/suites/cli-inspect.test.ts`

- [ ] **Step 1: Write the test**

Create `integration-tests/suites/cli-inspect.test.ts`:

```ts
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI_CWD = resolve(ROOT, 'packages/cli')
const CLI_BINARY = resolve(CLI_CWD, 'bin/dev.js')
const FETCH_SERVER = resolve(ROOT, 'mcp-servers/fetch/lib/serve.js')

function runInspect(args: Array<string>): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_BINARY, 'inspect', ...args], { cwd: CLI_CWD })
    let stdout = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.on('close', (code) => resolve({ stdout, code }))
  })
}

describe('CLI inspect', () => {
  test('inspect shows server capabilities', async () => {
    const { stdout, code } = await runInspect(['node', FETCH_SERVER])
    expect(code).toBe(0)
    // The Ink output includes "initialized" and the JSON-RPC capabilities
    expect(stdout).toContain('initialized')
    // MCP servers report their capabilities — at minimum, a tools capability
    expect(stdout).toContain('capabilities')
  }, 30_000)

  test('inspect exits non-zero for an invalid command', async () => {
    const { code } = await runInspect(['nonexistent-binary-that-does-not-exist'])
    expect(code).not.toBe(0)
  }, 15_000)
})
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter mokei-integration-tests test -- --testPathPattern cli-inspect`
Expected: both tests pass. The fetch MCP server must be built.

- [ ] **Step 3: Commit**

```bash
git add integration-tests/suites/cli-inspect.test.ts
git commit -m "test(integration): add inspect command e2e test"
```

---

### Task 15: Lint, type-check, and final verification

**Files:**
- Possibly modify: any files with lint/type errors

- [ ] **Step 1: Run type checking**

Run: `pnpm --filter mokei test:types`
Expected: no errors.

- [ ] **Step 2: Run lint**

Run: `rtk proxy pnpm run lint`
Expected: clean (or auto-fixed).

- [ ] **Step 3: Run all unit tests**

Run: `pnpm --filter mokei test:unit`
Expected: all pass (existing 12 + new program + ProviderSelectCard tests).

- [ ] **Step 4: Rebuild dist and run all e2e tests**

Run: `pnpm --filter mokei build`
Run: `pnpm --filter mokei-integration-tests test`
Expected: all integration tests pass.

- [ ] **Step 5: Fix any issues found**

If lint or types fail, fix the issues and re-run. Common issues:
- Import ordering (biome auto-fixes)
- Unused imports from old oclif references
- Type narrowing issues in commander action callbacks

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix(cli): address lint and type issues from commander migration"
```

(Skip this commit if Step 5 found nothing.)

---

### Task 16: Update memory note

**Files:**
- Modify: `/Users/paul/.claude/projects/-Users-paul-dev-yulsi-mokei/memory/cli-real-stdio-qa.md`

- [ ] **Step 1: Update the memory note**

Update the `cli-real-stdio-qa.md` memory file to reflect the new CLI surface. Change references from `mokei chat ollama` to `mokei chat --provider ollama`, and note that commands are now flat (no `context` group).

Key changes to the content:
- `mokei chat ollama` → `mokei chat --provider ollama`
- `chat ollama --model` → `chat --provider ollama --model`
- Note that oclif is replaced by commander
- Note that `bin/dev.js` still loads from `dist/` (unchanged)

- [ ] **Step 2: Commit**

This is a memory file, not a code file — no git commit needed.
