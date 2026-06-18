# Host + Session Lifecycle Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 11 medium-severity lifecycle gaps (child reaping, abort races, unbounded notification buffering, listener/stream leaks, inherited-prop lookup) across the host, session, and protocol packages.

**Architecture:** Each task fixes one independent defect with a failing test first, then the minimal fix. No shared scaffolding between tasks; order is arbitrary except where noted. Most fixes are localized; two introduce a small new exported seam (`wireMonitorStreams` for the monitor, an optional `killTimeout` for `spawnHostedContext`) to make races deterministically testable.

**Tech Stack:** TypeScript (ESM, `type` not `interface`, `Array<T>`, no `any`), pnpm workspaces, Vitest, `@enkaku/*` transports/client, Node `node:child_process`/`node:net`.

## Global Constraints

- Type definitions use `type`, never `interface`.
- Arrays are `Array<T>`, never `T[]`.
- No `any` — use `unknown`, `Record<string, unknown>`, or a specific type.
- Names: `ID` not `Id`, `HTTP` not `Http`, `URL` not `Url`.
- Package manager is `pnpm` / `pnpx` only — never `npm`/`npx`.
- Never edit generated files (`lib/`, `*.gen.ts`, `__generated__/`).
- Lint runs via `rtk proxy pnpm run lint` (not `pnpm lint`).
- Cross-package Vitest resolves a dependency's built `lib/`, not its `src/`. After editing a package that another package's test imports, run `pnpm --filter <dep> build` before testing the dependent.
- Each task is TDD: write the failing test, run it red, implement the minimal fix, run it green, commit.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 1: SIGTERM → SIGKILL escalation on child dispose

**Files:**
- Modify: `packages/host/src/host.ts` (`spawnHostedContext`, lines ~99-144)
- Test: `packages/host/test/lifecycle.test.ts`

**Interfaces:**
- Consumes: `spawnHostedContext(params: SpawnHostedContextParams): Promise<HostedContext>` (exported from `host.ts`).
- Produces: `SpawnHostedContextParams` gains optional `killTimeout?: number` (ms, default 5000). The returned `HostedContext.disposer.dispose()` now resolves only after the child has actually exited.

- [ ] **Step 1: Write the failing test**

Add to `packages/host/test/lifecycle.test.ts`:

```typescript
import { spawnHostedContext } from '../src/host.js'

describe('spawnHostedContext dispose escalation', () => {
  test('escalates to SIGKILL when the child ignores SIGTERM, and awaits real exit', async () => {
    // Child traps SIGTERM and never exits on its own.
    const ctx = await spawnHostedContext({
      command: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1e9)"],
      killTimeout: 300,
    })

    const start = Date.now()
    await ctx.disposer.dispose()
    const elapsed = Date.now() - start

    // dispose must have waited for the kill deadline, then SIGKILLed and
    // awaited the real exit — i.e. it did not resolve immediately.
    expect(elapsed).toBeGreaterThanOrEqual(250)
  })

  test('exits on SIGTERM without escalating for a well-behaved child', async () => {
    const ctx = await spawnHostedContext({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1e9)'],
      killTimeout: 2000,
    })
    const start = Date.now()
    await ctx.disposer.dispose()
    // Resolves well before the 2s deadline because SIGTERM is honored.
    expect(Date.now() - start).toBeLessThan(1500)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test lifecycle`
Expected: FAIL — current dispose calls `childProcess.kill()` and resolves immediately (first test sees `elapsed` near 0; `killTimeout` is also an unknown param).

- [ ] **Step 3: Write minimal implementation**

In `packages/host/src/host.ts`, add a constant near `DEFAULT_MAX_BUFFER_SIZE`:

```typescript
/** Grace period (ms) between SIGTERM and SIGKILL when disposing a child. */
const DEFAULT_KILL_TIMEOUT = 5000
```

Add `killTimeout?: number` to `SpawnHostedContextParams`:

```typescript
export type SpawnHostedContextParams = SpawnContextServerParams & {
  onExit?: (error: Error | null) => void
  /** Called when the stdout framing/read stream faults (invalid JSON or buffer overflow). */
  onStreamError?: (error: Error) => void
  /** Max total live framer memory in bytes. Default 8 MiB. */
  maxBufferSize?: number
  /** Optional tighter per-message cap in bytes. Default unset (= buffer cap). */
  maxMessageSize?: number
  /** Grace period (ms) between SIGTERM and SIGKILL on dispose. Default 5000. */
  killTimeout?: number
}
```

Destructure it: `const { onExit, onStreamError, maxBufferSize, maxMessageSize, killTimeout, ...spawnParams } = params`.

Replace the `dispose` in the returned `createHostedContext` call:

```typescript
  return createHostedContext({
    transport: transport as ClientTransport,
    dispose: async () => {
      // Already exited — nothing to reap.
      if (childProcess.exitCode != null || childProcess.signalCode != null) {
        return
      }
      await new Promise<void>((resolve) => {
        let killTimer: ReturnType<typeof setTimeout>
        childProcess.once('exit', () => {
          clearTimeout(killTimer)
          resolve()
        })
        childProcess.kill('SIGTERM')
        killTimer = setTimeout(() => {
          // Child ignored SIGTERM; force it. The `exit` listener above still
          // resolves once the kill lands.
          childProcess.kill('SIGKILL')
        }, killTimeout ?? DEFAULT_KILL_TIMEOUT)
      })
    },
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test lifecycle`
Expected: PASS (both new tests, plus existing lifecycle tests still green).

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/host.ts packages/host/test/lifecycle.test.ts
git commit -m "fix(host): escalate to SIGKILL and await exit on child dispose

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Daemon floating writes + child-exit cleanup

**Files:**
- Modify: `packages/host/src/server.ts` (`createHandlers`, lines ~44-131)
- Test: `packages/host/test/daemon-server.test.ts`

**Interfaces:**
- Consumes: `startServer(params: ServerParams): Promise<RunningServer>`, `createClient(socketPath: string): Promise<HostClient>` (from `daemon/controller.ts`). `HostClient.createStream('events')` returns a `StreamCall` with `.readable: ReadableStream<{ type: string; data?: unknown; meta: HostEventMeta }>`. `HostClient.createChannel('spawn', { param })` returns a `ChannelCall`.
- Produces: a self-exiting spawned child now dispatches `context:stop` and is removed from `activeContexts` + `children`; a failed event write tears down that subscription instead of throwing an unhandled rejection.

- [ ] **Step 1: Write the failing test**

Add to `packages/host/test/daemon-server.test.ts`:

```typescript
import { createClient } from '../src/daemon/controller.js'

describe('spawn handler child-exit cleanup', () => {
  test('dispatches context:stop and prunes maps when a spawned child self-exits', async () => {
    const socketPath = tmpSocket()
    const { dispose } = await startServer({ socketPath })
    const client = await createClient(socketPath)

    const stops: Array<{ type: string }> = []
    const events = client.createStream('events')
    void (async () => {
      for await (const event of events.readable) {
        if (event.type === 'context:stop') {
          stops.push(event)
        }
      }
    })()

    // Spawn a child that exits immediately on its own.
    client.createChannel('spawn', {
      param: { command: process.execPath, args: ['-e', 'process.exit(0)'] },
    })

    await vi.waitFor(() => {
      expect(stops.length).toBeGreaterThan(0)
    })

    events.close()
    await client.dispose()
    await dispose()
  })
})
```

Ensure `vi` is imported in the test file: `import { afterEach, describe, expect, test, vi } from 'vitest'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test daemon-server`
Expected: FAIL — no `exit` listener exists, so `context:stop` is never dispatched for a self-exiting child; `vi.waitFor` times out.

- [ ] **Step 3: Write minimal implementation**

In `packages/host/src/server.ts`, in the `events` handler, guard each `writer.write` and unsubscribe on failure:

```typescript
    events: (ctx) => {
      const writer = ctx.writable.getWriter()

      const handleEvent = (event: Event) => {
        const e = event as CustomEvent<{ data?: unknown; meta: HostEventMeta }>
        const msg = { type: e.type, data: e.detail.data, meta: e.detail.meta }
        // A disconnected monitor makes write() reject; drop this subscriber
        // rather than turning the rejection into an unhandled crash.
        writer.write(msg).catch(() => {
          ctx.controller?.abort?.()
        })
      }
      events.addEventListener('context:message', handleEvent, { signal: ctx.signal })
      events.addEventListener('context:start', handleEvent, { signal: ctx.signal })
      events.addEventListener('context:stop', handleEvent, { signal: ctx.signal })

      return new Promise((resolve) => {
        ctx.signal.addEventListener('abort', () => {
          resolve()
        })
      })
    },
```

If `ctx.controller` is not part of the handler context type, instead unsubscribe directly with a local `AbortController` that mirrors `ctx.signal`:

```typescript
    events: (ctx) => {
      const writer = ctx.writable.getWriter()
      const sub = new AbortController()
      ctx.signal.addEventListener('abort', () => sub.abort(), { once: true })

      const handleEvent = (event: Event) => {
        const e = event as CustomEvent<{ data?: unknown; meta: HostEventMeta }>
        const msg = { type: e.type, data: e.detail.data, meta: e.detail.meta }
        writer.write(msg).catch(() => sub.abort())
      }
      events.addEventListener('context:message', handleEvent, { signal: sub.signal })
      events.addEventListener('context:start', handleEvent, { signal: sub.signal })
      events.addEventListener('context:stop', handleEvent, { signal: sub.signal })

      return new Promise((resolve) => {
        ctx.signal.addEventListener('abort', () => resolve())
      })
    },
```

In the `spawn` handler, extract the teardown so the abort path and a new child `exit` listener share it. Replace the `ctx.signal.addEventListener('abort', …)` block:

```typescript
      let stopped = false
      const stopContext = () => {
        if (stopped) {
          return
        }
        stopped = true
        spawned.childProcess.kill()
        delete activeContexts[contextID]
        children.delete(contextID)
        events.dispatchEvent(
          new CustomEvent('context:stop', { detail: { meta: createEventMeta(contextID) } }),
        )
      }

      // A child that exits on its own must leave activeContexts and notify
      // proxy clients, exactly as an explicit abort would.
      spawned.childProcess.once('exit', stopContext)
      ctx.signal.addEventListener('abort', stopContext)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test daemon-server`
Expected: PASS (new test + existing `killChildren`/`startServer` tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/server.ts packages/host/test/daemon-server.test.ts
git commit -m "fix(host): reap self-exiting daemon children and guard event writes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: setup/remove race re-check

**Files:**
- Modify: `packages/host/src/host.ts` (`setup`, lines ~475-485)
- Test: `packages/host/test/lifecycle.test.ts`

**Interfaces:**
- Consumes: `ContextHost#setup(key, enableTools)`.
- Produces: `setup` throws `Context ${key} was removed during setup` if the context disappears while `listTools` is in flight, instead of a TypeError.

- [ ] **Step 1: Write the failing test**

Add to `packages/host/test/lifecycle.test.ts`:

```typescript
describe('ContextHost.setup race', () => {
  test('throws a clear error if the context is removed during listTools', async () => {
    const host = new ContextHost()
    await host.addLocalContext({
      key: 'racy',
      command: process.execPath,
      // Minimal server that responds to initialize + tools/list slowly enough
      // for the remove below to land first is hard to time deterministically;
      // instead drive the race directly by removing mid-setup.
      args: ['-e', 'setInterval(() => {}, 1e9)'],
    })

    // Start setup, then remove before it can assign tools.
    const setupPromise = host.setup('racy').catch((err: Error) => err)
    await host.remove('racy')

    const result = await setupPromise
    if (result instanceof Error) {
      expect(result.message).toContain('was removed during setup')
    }
    // Either it raced and threw the clear error, or it finished before remove —
    // in both cases there must be no leftover context and no TypeError.
    expect(host.getContextKeys()).not.toContain('racy')

    await host.dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test lifecycle`
Expected: FAIL or flaky with `TypeError: Cannot set properties of undefined (setting 'tools')` when the remove wins the race.

- [ ] **Step 3: Write minimal implementation**

In `packages/host/src/host.ts`, in `setup`, re-check after the await:

```typescript
  async setup(key: string, enableTools: EnableToolsArg = true): Promise<Array<ContextTool>> {
    const { tools } = await this.getContext(key).client.listTools()
    const enabledTools = typeof enableTools === 'function' ? await enableTools(tools) : enableTools
    const contextTools = tools.map((tool: Tool) => {
      const enabled =
        typeof enabledTools === 'boolean' ? enabledTools : enabledTools.includes(tool.name)
      return { id: getContextToolID(key, tool.name), tool, enabled }
    })
    // The context may have been removed while listTools / enableTools awaited.
    if (this._contexts[key] == null) {
      throw new Error(`Context ${key} was removed during setup`)
    }
    this._contexts[key].tools = contextTools
    return contextTools
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test lifecycle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/host.ts packages/host/test/lifecycle.test.ts
git commit -m "fix(host): re-check context existence after listTools in setup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Local tool AbortSignal plumbing

**Files:**
- Modify: `packages/host/src/local-tools.ts` (`LocalToolExecute`, lines ~8-10)
- Modify: `packages/host/src/host.ts` (`callLocalTool`, lines ~532-563)
- Test: `packages/host/test/local-tools.test.ts`

**Interfaces:**
- Consumes: `ContextHost#callLocalTool(name, args)`.
- Produces: `LocalToolExecute<TArgs>` becomes `(args: TArgs, signal?: AbortSignal) => CallToolResult | Promise<CallToolResult>` (additive optional param). `callLocalTool(...).cancel()` aborts the signal passed into `execute`.

- [ ] **Step 1: Write the failing test**

Add to `packages/host/test/local-tools.test.ts` (inside a `describe('callLocalTool cancellation', …)`):

```typescript
import { ContextHost } from '../src/index.js'

describe('callLocalTool cancellation', () => {
  test('aborts the signal passed to a running execute when cancelled', async () => {
    const host = new ContextHost()
    let observedAbort = false

    host.addLocalTool({
      name: 'waiter',
      description: 'waits until aborted',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, signal) => {
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => {
            observedAbort = true
            resolve()
          })
        })
        return { content: [{ type: 'text', text: 'done' }] }
      },
    })

    const request = host.callLocalTool('waiter', {})
    // Let execute start and subscribe to the signal.
    await new Promise((resolve) => setTimeout(resolve, 10))
    request.cancel()
    await request

    expect(observedAbort).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test local-tools`
Expected: FAIL — `execute` receives no signal today, so `observedAbort` stays `false` and the request never settles (test times out).

- [ ] **Step 3: Write minimal implementation**

In `packages/host/src/local-tools.ts`:

```typescript
export type LocalToolExecute<TArgs = Record<string, unknown>> = (
  args: TArgs,
  signal?: AbortSignal,
) => CallToolResult | Promise<CallToolResult>
```

In `packages/host/src/host.ts`, rewrite `callLocalTool`:

```typescript
  callLocalTool(name: string, args: Record<string, unknown> = {}): SentRequest<CallToolResult> {
    const localTool = this._localTools.get(name)
    if (localTool == null) {
      throw new Error(`Local tool "${name}" does not exist`)
    }

    const controller = new AbortController()
    const promise = Promise.resolve().then(async () => {
      if (controller.signal.aborted) {
        throw new Error('Request cancelled')
      }
      try {
        return await localTool.execute(args, controller.signal)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: 'text' as const, text: errorMessage }],
          isError: true,
        }
      }
    })

    const request = promise as SentRequest<CallToolResult>
    request.cancel = () => {
      controller.abort()
    }
    return request
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test local-tools`
Expected: PASS (new test + existing local-tools tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/local-tools.ts packages/host/src/host.ts packages/host/test/local-tools.test.ts
git commit -m "fix(host): plumb AbortSignal into local tool execute

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Monitor pipe failure + locked-stream dispose

**Files:**
- Create: `packages/host-monitor/src/pipes.ts`
- Modify: `packages/host-monitor/src/index.ts` (lines ~73-86)
- Test: `packages/host-monitor/test/pipes.test.ts`

**Interfaces:**
- Produces: `wireMonitorStreams(params): { done: Promise<void>; dispose: () => Promise<void> }` — wires the socket ↔ bridge pipes with an abort-driven teardown and an attached rejection handler. `done` never rejects to the caller (a daemon disconnect is handled, not fatal); `dispose()` aborts the pipes and resolves.

- [ ] **Step 1: Write the failing test**

Create `packages/host-monitor/test/pipes.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'

import { wireMonitorStreams } from '../src/pipes.js'

function passthrough() {
  return new TransformStream<unknown, unknown>()
}

describe('wireMonitorStreams', () => {
  test('does not crash when a source stream errors (daemon disconnect)', async () => {
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    const socket = passthrough()
    const bridge = passthrough()

    const erroringReadable = new ReadableStream({
      start(controller) {
        controller.error(new Error('daemon disconnected'))
      },
    })

    const pipes = wireMonitorStreams({
      socketReadable: erroringReadable,
      socketWritable: socket.writable,
      bridgeReadable: bridge.readable,
      bridgeWritable: bridge.writable,
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toHaveLength(0)

    await pipes.dispose()
  })

  test('dispose resolves while pipes are active (no close-on-locked-stream throw)', async () => {
    const socket = passthrough()
    const bridge = passthrough()

    const idleReadable = new ReadableStream({ start() {} }) // never closes

    const pipes = wireMonitorStreams({
      socketReadable: idleReadable,
      socketWritable: socket.writable,
      bridgeReadable: bridge.readable,
      bridgeWritable: bridge.writable,
    })

    await expect(pipes.dispose()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/host-monitor test pipes`
Expected: FAIL — `wireMonitorStreams` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `packages/host-monitor/src/pipes.ts`:

```typescript
export type MonitorPipes = {
  done: Promise<void>
  dispose: () => Promise<void>
}

export type WireMonitorStreamsParams = {
  socketReadable: ReadableStream<unknown>
  socketWritable: WritableStream<unknown>
  bridgeReadable: ReadableStream<unknown>
  bridgeWritable: WritableStream<unknown>
}

/**
 * Wire the daemon socket and the HTTP server bridge together. Teardown is
 * abort-driven (never `.close()` on a writable locked by an active `pipeTo`),
 * and the combined promise carries its own rejection handler so a daemon
 * disconnect surfaces as a settled `done`, not an unhandled rejection.
 */
export function wireMonitorStreams(params: WireMonitorStreamsParams): MonitorPipes {
  const controller = new AbortController()
  const done = Promise.all([
    params.socketReadable.pipeTo(params.bridgeWritable, { signal: controller.signal }),
    params.bridgeReadable.pipeTo(params.socketWritable, { signal: controller.signal }),
  ]).then(() => {})
  // Daemon disconnect / abort must not crash the process.
  done.catch(() => {})

  return {
    done,
    dispose: async () => {
      controller.abort()
      await done.catch(() => {})
    },
  }
}
```

Update `packages/host-monitor/src/index.ts`. Replace the `decoupled` block and disposer:

```typescript
import { wireMonitorStreams } from './pipes.js'
```

```typescript
  const pipes = wireMonitorStreams({
    socketReadable: socketStream.readable,
    socketWritable: socketStream.writable,
    bridgeReadable: serverBridge.stream.readable,
    bridgeWritable: serverBridge.stream.writable,
  })
  const disposer = new Disposer({
    dispose: async () => {
      server.close()
      await Promise.all([serverClosed.promise, pipes.dispose()])
    },
  })
```

Remove the now-unused `defer`-based `decoupled` Promise.all and the `serverBridge.stream.writable.close()` / `socketStream.writable.close()` calls.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/host-monitor test pipes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/host-monitor/src/pipes.ts packages/host-monitor/src/index.ts packages/host-monitor/test/pipes.test.ts
git commit -m "fix(host-monitor): abort-driven pipe teardown, handle daemon disconnect

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: addContext abort orphan

**Files:**
- Modify: `packages/session/src/session.ts` (`addContext`, lines ~174-181)
- Test: `packages/session/test/lifecycle.test.ts` (create)

**Interfaces:**
- Consumes: `Session#addContext(params)`, `ContextHost#getContextKeys()`.
- Produces: on abort, `addContext` awaits the host `remove` and re-checks after `#setupContext` settles, so no child remains for the key.

- [ ] **Step 1: Write the failing test**

Create `packages/session/test/lifecycle.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'

import { Session } from '../src/session.js'

describe('Session.addContext abort', () => {
  test('leaves no context behind when aborted mid-setup', async () => {
    const session = new Session()
    const controller = new AbortController()

    const promise = session
      .addContext({
        key: 'aborted',
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1e9)'],
        signal: controller.signal,
      })
      .catch(() => {})

    // Abort almost immediately, racing the spawn/registration.
    controller.abort()
    await promise

    // Give a late-registering spawn a chance to surface, then assert cleanup.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(session.contextHost.getContextKeys()).not.toContain('aborted')

    await session.contextHost.dispose()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/session build && pnpm --filter @mokei/session test lifecycle`
Expected: FAIL (flaky) — when abort lands before `addLocalContext` registers, the fire-and-forget `remove` misses the late spawn and `getContextKeys()` still contains `aborted`.

- [ ] **Step 3: Write minimal implementation**

In `packages/session/src/session.ts`, rewrite `addContext`:

```typescript
  addContext(params: AddContextParams): Promise<Array<ContextTool>> {
    if (!params.signal) {
      return this.#setupContext(params)
    }
    return raceSignal(this.#setupContext(params), params.signal).catch(async (err) => {
      // The spawn may register the context after the abort wins the race;
      // await the removal and re-check so a late spawn cannot leak a child.
      await this.#contextHost.remove(params.key).catch(() => {})
      if (this.#contextHost.getContextKeys().includes(params.key)) {
        await this.#contextHost.remove(params.key).catch(() => {})
      }
      throw err
    })
  }
```

Note: `#setupContext` already awaits `addLocalContext` then `setup`; the second re-check covers a registration that completes between the first `remove` and the rejection settling.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/session test lifecycle` (run several times to confirm non-flaky: append `--retry=0` and re-run 3×)
Expected: PASS consistently.

- [ ] **Step 5: Commit**

```bash
git add packages/session/src/session.ts packages/session/test/lifecycle.test.ts
git commit -m "fix(session): await removal and re-check on addContext abort

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `#activeChatRequest` clobber guard

**Files:**
- Modify: `packages/session/src/session.ts` (`chat`, lines ~310-345)
- Test: `packages/session/test/lifecycle.test.ts`

**Interfaces:**
- Consumes: `Session#chat(params)`, `Session#activeChatRequest`.
- Produces: `chat`'s `finally` nulls `#activeChatRequest` only when it still references this call's request, so a replacing chat's guard holds against a third concurrent `chat()`.

- [ ] **Step 1: Write the failing test**

Add to `packages/session/test/lifecycle.test.ts`. Use a fake provider whose `streamChat` returns an abortable request that never completes until aborted:

```typescript
import type { ModelProvider } from '@mokei/model-provider'

function hangingProvider(): ModelProvider {
  // Minimal provider: streamChat returns a StreamChatRequest (a Promise with
  // .abort) that resolves to an empty stream only after abort.
  const makeRequest = () => {
    let abortFn: () => void = () => {}
    const promise = new Promise((resolve) => {
      abortFn = () => resolve(new ReadableStream({ start: (c) => c.close() }))
    }) as ReturnType<ModelProvider['streamChat']>
    ;(promise as unknown as { abort: () => void }).abort = abortFn
    return promise
  }
  return {
    streamChat: makeRequest,
    aggregateMessage: () => ({ role: 'assistant', text: '', toolCalls: [] }),
    toolFromMCP: (t: unknown) => t,
  } as unknown as ModelProvider
}

describe('Session.chat active-request guard', () => {
  test('a third concurrent chat is rejected after one replaces another', async () => {
    const session = new Session()
    session.addProvider('fake', hangingProvider())
    const base = { provider: 'fake', model: 'm', messages: [] }

    const chatA = session.chat(base).catch(() => 'A-done')
    await new Promise((r) => setTimeout(r, 5))
    // B replaces A by aborting it.
    const chatB = session.chat({ ...base, abortActiveRequest: true }).catch(() => 'B-done')
    await new Promise((r) => setTimeout(r, 5))

    // C must see B still active and be rejected.
    await expect(session.chat(base)).rejects.toThrow('already active')

    // Cleanup: abort B.
    session.activeChatRequest?.abort()
    await Promise.all([chatA, chatB])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/session build && pnpm --filter @mokei/session test lifecycle`
Expected: FAIL — A's `finally` nulls the shared field after B registered, so C's guard passes and the `rejects.toThrow('already active')` assertion fails.

- [ ] **Step 3: Write minimal implementation**

In `packages/session/src/session.ts`, rewrite `chat` to capture the local request and only null if unchanged:

```typescript
  async chat<P extends T = T>(params: ChatParams<P>): Promise<AggregatedMessage<P['ToolCall']>> {
    if (this.#activeChatRequest != null) {
      if (params.abortActiveRequest) {
        this.#activeChatRequest.abort()
      } else {
        throw new Error('A chat request is already active')
      }
    }

    const provider = this.resolveProvider(params.provider)
    const tools = params.tools ?? this.getToolsForProvider(provider)

    const request = provider.streamChat({ ...params, tools })
    this.#activeChatRequest = request
    try {
      const stream = await request

      const messageParts: Array<ServerMessage<P['MessagePart'], P['ToolCall']>> = []

      for await (const chunk of fromStream(stream)) {
        this.#events.emit('message-part', chunk)

        if (chunk.type === 'error') {
          throw chunk.error
        }

        const serverMessage = chunkToServerMessage(chunk)
        if (serverMessage != null) {
          messageParts.push(serverMessage)
        }
      }

      return provider.aggregateMessage(messageParts)
    } finally {
      // Only clear if a replacing chat has not already taken ownership.
      if (this.#activeChatRequest === request) {
        this.#activeChatRequest = null
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/session test lifecycle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/session/src/session.ts packages/session/test/lifecycle.test.ts
git commit -m "fix(session): guard activeChatRequest clear against replacing chat

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Bounded + drop-when-no-reader notifications

**Files:**
- Modify: `packages/context-client/src/client.ts` (constructor ~159-169, `_handleNotification` ~274-279, `notifications` getter ~314-316)
- Test: `packages/context-client/test/notifications.test.ts` (create)

**Interfaces:**
- Consumes: `ContextClient#notifications` getter, `ContextClient#_handleNotification(notification)`.
- Produces: notifications are dropped while no reader has attached; once `notifications` is read, at most `NOTIFICATION_BUFFER_CAP` (256) are buffered, dropping oldest on overflow.

- [ ] **Step 1: Write the failing test**

Create `packages/context-client/test/notifications.test.ts`. Build a client over `DirectTransports` with a server that emits notifications on demand. If an existing test helper spins up a `ContextClient`+`ContextServer` pair, reuse it; otherwise drive `_handleNotification` directly (it is the seam the transport calls):

```typescript
import { describe, expect, test } from 'vitest'

import { ContextClient } from '../src/client.js'

// Minimal transport stub: ContextClient only needs a transport object with the
// ClientTransport shape; these tests call _handleNotification directly and never
// initialize, so a no-op transport is sufficient.
function noopTransport() {
  return {
    write: async () => {},
    read: () => new ReadableStream({ start: (c) => c.close() }),
    dispose: async () => {},
    events: { on: () => () => {}, emit: () => {} },
  } as never
}

function makeNotification(n: number) {
  return { jsonrpc: '2.0' as const, method: 'notifications/progress', params: { n } }
}

describe('ContextClient notifications buffering', () => {
  test('drops notifications when no reader is attached', async () => {
    const client = new ContextClient({ transport: noopTransport() })
    for (let i = 0; i < 1000; i++) {
      client._handleNotification(makeNotification(i) as never)
    }
    // Attach a reader now; nothing buffered before attach should be delivered.
    const reader = client.notifications.getReader()
    const first = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve('empty'), 50)),
    ])
    expect(first).toBe('empty')
    reader.releaseLock()
  })

  test('buffers at most the cap once a reader is attached, dropping oldest', async () => {
    const client = new ContextClient({ transport: noopTransport() })
    const reader = client.notifications.getReader()

    // Emit more than the cap without reading.
    for (let i = 0; i < 1000; i++) {
      client._handleNotification(makeNotification(i) as never)
    }

    // Drain what is buffered; count and confirm the newest survived.
    const received: Array<number> = []
    for (let i = 0; i < 256; i++) {
      const { value } = await reader.read()
      received.push((value as { params: { n: number } }).params.n)
    }
    expect(received.length).toBe(256)
    // Oldest dropped: the last received must be the newest emitted (999).
    expect(received[received.length - 1]).toBe(999)
    reader.releaseLock()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/context-client build && pnpm --filter @mokei/context-client test notifications`
Expected: FAIL — current implementation enqueues every notification eagerly via `createReadable`, so the no-reader test delivers data and the cap test has no bound.

- [ ] **Step 3: Write minimal implementation**

In `packages/context-client/src/client.ts`, remove the `createReadable` import usage for notifications and replace the fields. Add a constant near the other defaults:

```typescript
/** Max notifications buffered once a reader is attached; oldest dropped past this. */
const NOTIFICATION_BUFFER_CAP = 256
```

Replace the notification fields and constructor wiring:

```typescript
  #notificationBuffer: Array<HandleNotification> = []
  #notificationPull: (() => void) | null = null
  #hasNotificationReader = false
  #notifications: ReadableStream<HandleNotification>
```

In the constructor, replace the `createReadable` block:

```typescript
    this.#notifications = new ReadableStream<HandleNotification>(
      {
        pull: (controller) => {
          const next = this.#notificationBuffer.shift()
          if (next != null) {
            controller.enqueue(next)
            return
          }
          // No buffered item: park until the next notification arrives.
          return new Promise<void>((resolve) => {
            this.#notificationPull = () => {
              this.#notificationPull = null
              const queued = this.#notificationBuffer.shift()
              if (queued != null) {
                controller.enqueue(queued)
              }
              resolve()
            }
          })
        },
        cancel: () => {
          this.#hasNotificationReader = false
          this.#notificationBuffer = []
          this.#notificationPull = null
        },
      },
      new CountQueuingStrategy({ highWaterMark: 0 }),
    )
```

Remove the old `#notificationController` field and its constructor assignment.

Update `_handleNotification`:

```typescript
  _handleNotification(notification: HandleNotification): void {
    if (notification.method === 'notifications/message') {
      this.events.emit('log', notification.params)
    }
    // Drop until a reader attaches, then keep only the most recent CAP.
    if (!this.#hasNotificationReader) {
      return
    }
    this.#notificationBuffer.push(notification)
    if (this.#notificationBuffer.length > NOTIFICATION_BUFFER_CAP) {
      this.#notificationBuffer.shift()
    }
    this.#notificationPull?.()
  }
```

Update the getter to mark a reader as present:

```typescript
  get notifications(): ReadableStream<ServerNotification> {
    this.#hasNotificationReader = true
    return this.#notifications as ReadableStream<ServerNotification>
  }
```

If the `createReadable` import becomes unused, remove it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/context-client build && pnpm --filter @mokei/context-client test notifications`
Expected: PASS. Also run the full package suite to confirm no regression: `pnpm --filter @mokei/context-client test`.

- [ ] **Step 5: Commit**

```bash
git add packages/context-client/src/client.ts packages/context-client/test/notifications.test.ts
git commit -m "fix(context-client): bound notifications buffer, drop when no reader

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: `anySignal` listener leak

**Files:**
- Modify: `packages/session/src/agent-session.ts` (`anySignal`, lines ~678-690)
- Modify: `packages/llama-provider/src/provider.ts` (same pattern, lines ~274-276)
- Test: `packages/session/test/any-signal.test.ts` (create)

**Interfaces:**
- Consumes: `anySignal(signals: Array<AbortSignal>): AbortSignal` (module-local in agent-session).
- Produces: `anySignal` no longer accumulates listeners on caller-owned signals across calls (uses `AbortSignal.any`).

- [ ] **Step 1: Write the failing test**

`anySignal` is module-local (not exported). Export it for testing (named export, no behavior change) and write `packages/session/test/any-signal.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest'

import { anySignal } from '../src/agent-session.js'

describe('anySignal', () => {
  test('does not accumulate listeners on a shared long-lived signal', () => {
    const longLived = new AbortController().signal
    const addSpy = vi.spyOn(longLived, 'addEventListener')

    for (let i = 0; i < 50; i++) {
      const perCall = new AbortController()
      anySignal([longLived, perCall.signal])
      perCall.abort()
    }

    // AbortSignal.any manages listeners internally and weakly; our wrapper must
    // not register 50 persistent listeners on the long-lived signal.
    // Allow a small constant but not linear growth.
    expect(addSpy.mock.calls.length).toBeLessThan(5)
  })

  test('aborts when any input signal aborts', () => {
    const a = new AbortController()
    const b = new AbortController()
    const combined = anySignal([a.signal, b.signal])
    expect(combined.aborted).toBe(false)
    b.abort(new Error('boom'))
    expect(combined.aborted).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/session build && pnpm --filter @mokei/session test any-signal`
Expected: FAIL on the first test — current `anySignal` calls `addEventListener` once per call (50 persistent listeners), and/or `anySignal` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/session/src/agent-session.ts`, replace the body and export it:

```typescript
/**
 * Combine multiple AbortSignals into one. Delegates to `AbortSignal.any`, which
 * manages and releases its listeners internally — no manual cleanup needed.
 */
export function anySignal(signals: Array<AbortSignal>): AbortSignal {
  return AbortSignal.any(signals)
}
```

In `packages/llama-provider/src/provider.ts`, replace the equivalent inline `anySignal`/manual-combine block with `AbortSignal.any([...])` over the same signals.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/session test any-signal`
Expected: PASS. Then `pnpm --filter @mokei/llama-provider build` to confirm the llama change typechecks.

- [ ] **Step 5: Commit**

```bash
git add packages/session/src/agent-session.ts packages/llama-provider/src/provider.ts packages/session/test/any-signal.test.ts
git commit -m "fix(session,llama): use AbortSignal.any to avoid listener leaks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Abandoned agent generator closes provider stream

**Files:**
- Modify: `packages/session/src/agent-session.ts` (`stream` loop + outer `finally`, lines ~218-246, ~517-519)
- Test: `packages/session/test/agent-session.test.ts`

**Interfaces:**
- Consumes: `AgentSession#stream(prompt, opts)` (async generator), `Session#streamChatTurn` (the per-iteration generator assigned to `chatTurn`).
- Produces: when a consumer `break`s out of `stream()`, the outer `finally` calls `.return()` on the in-flight `chatTurn`, closing the provider stream.

- [ ] **Step 1: Write the failing test**

Add to `packages/session/test/agent-session.test.ts`. Use a fake provider whose `streamChat` stream records when its `cancel`/`return` runs:

```typescript
test('breaking out of stream() closes the in-flight provider stream', async () => {
  let cancelled = false
  const provider = {
    streamChat: () => {
      const stream = new ReadableStream({
        pull(controller) {
          // Emit text-deltas forever until cancelled.
          controller.enqueue({ type: 'text-delta', text: 'x' })
        },
        cancel() {
          cancelled = true
        },
      })
      const req = Promise.resolve(stream) as never
      ;(req as unknown as { abort: () => void }).abort = () => {}
      return req
    },
    aggregateMessage: () => ({ role: 'assistant', text: 'x', toolCalls: [] }),
    toolFromMCP: (t: unknown) => t,
  } as never

  const session = new Session()
  session.addProvider('fake', provider)
  const agent = new AgentSession({ session, provider: 'fake', model: 'm' })

  for await (const event of agent.stream('hi')) {
    if (event.type === 'text-delta') {
      break // abandon the generator mid-stream
    }
  }

  await new Promise((r) => setTimeout(r, 20))
  expect(cancelled).toBe(true)
})
```

Adjust the `AgentSession` construction and event-type names to match the existing test file's helpers/imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/session build && pnpm --filter @mokei/session test agent-session`
Expected: FAIL — the outer `finally` only clears the timeout; `chatTurn` is never returned on an external `break`, so `cancelled` stays `false`.

- [ ] **Step 3: Write minimal implementation**

In `packages/session/src/agent-session.ts`, declare a hoisted reference before the agent loop (near `let iteration = 0`):

```typescript
      let activeChatTurn: ReturnType<typeof session.streamChatTurn> | null = null
```

Assign it where `chatTurn` is created:

```typescript
        const chatTurn = session.streamChatTurn({
          provider,
          model,
          messages,
          tools,
          signal: combinedSignal,
        })
        activeChatTurn = chatTurn
```

After the inner drain loop completes normally, clear it so the outer `finally` does not double-return a finished generator (optional but tidy) — add right after the `while (!result.done)` block / before the next iteration’s work:

```typescript
        activeChatTurn = null
```

Extend the outer `finally` (currently `clearTimeout(timeoutId)`):

```typescript
    } finally {
      clearTimeout(timeoutId)
      // A consumer that breaks out of this generator leaves the current turn's
      // provider stream open; return it so the provider releases the reader.
      void activeChatTurn?.return(undefined as never).catch(() => {})
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/session test agent-session`
Expected: PASS (new test + existing agent-session suite green).

- [ ] **Step 5: Commit**

```bash
git add packages/session/src/agent-session.ts packages/session/test/agent-session.test.ts
git commit -m "fix(session): return in-flight chatTurn when agent stream is abandoned

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Inherited-prop tool/prompt lookup hardening

**Files:**
- Modify: `packages/context-server/src/server.ts` (`#callTool` ~257-262, `#getPrompt` / prompt lookup ~290)
- Test: `packages/context-server/test/lib.test.ts`

**Interfaces:**
- Consumes: `ContextServer` request handling for `tools/call` and `prompts/get`.
- Produces: lookups use `Object.hasOwn`, so `constructor` / `__proto__` / `toString` names return a clean "not found" RPC error instead of invoking an inherited member.

- [ ] **Step 1: Write the failing test**

Add to `packages/context-server/test/lib.test.ts` (mirror the existing pattern there for constructing a `ContextServer` + driving a `tools/call`). Minimal direct test of the lookup behavior:

```typescript
describe('inherited-prop tool/prompt lookup', () => {
  test('tools/call with an inherited prop name returns not found', async () => {
    // Build a server with at least one real tool, then call "constructor".
    const { client } = makeServerClientPair() // existing helper in this file
    await client.initialize()
    const result = await client.callTool({ name: 'constructor', arguments: {} }).catch((e: Error) => e)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('not found')
  })
})
```

If `lib.test.ts` has no reusable pair helper, drive it the same way other `tools/call` tests in that file do (use the existing setup verbatim, only changing the tool name to `'constructor'`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/context-server build && pnpm --filter @mokei/context-server test lib`
Expected: FAIL — `this.#toolHandlers['constructor']` resolves `Object`'s constructor (truthy), so the null-check passes and the handler invocation produces a malformed result rather than a "not found" error.

- [ ] **Step 3: Write minimal implementation**

In `packages/context-server/src/server.ts`, guard both handler lookups with `Object.hasOwn`. In `#callTool`:

```typescript
    const name = request.params.name
    const handler = Object.hasOwn(this.#toolHandlers, name) ? this.#toolHandlers[name] : undefined
    if (handler == null) {
      throw new RPCError(INVALID_PARAMS, `Tool ${name} not found`)
    }
```

Apply the identical pattern to the prompt handler lookup (`this.#promptHandlers[request.params.name]` at ~290):

```typescript
    const name = request.params.name
    const handler = Object.hasOwn(this.#promptHandlers, name) ? this.#promptHandlers[name] : undefined
    if (handler == null) {
      throw new RPCError(INVALID_PARAMS, `Prompt ${name} not found`)
    }
```

(Keep the existing error messages/codes; only the lookup guard changes.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/context-server test lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/context-server/src/server.ts packages/context-server/test/lib.test.ts
git commit -m "fix(context-server): guard tool/prompt lookups with Object.hasOwn

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Rebuild everything**

Run: `pnpm build`
Expected: all packages build, no type errors.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: all suites green, including the new tests from Tasks 1-11.

- [ ] **Step 3: Lint**

Run: `rtk proxy pnpm run lint`
Expected: no lint/format errors.

- [ ] **Step 4: Update the roadmap**

Move the "Host + session lifecycle" entry out of `docs/agents/plans/backlog/` per the project's completed-work convention (mark complete, note item 12 was already fixed, reference this plan). Follow the format of existing `completed/*.complete.md` files.

- [ ] **Step 5: Commit**

```bash
git add docs/agents/plans
git commit -m "docs: mark host + session lifecycle robustness complete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** Tasks 1-5 map to spec Group 1 items 1-5; Tasks 6-10 map to Group 2 items 6-10; Task 11 maps to Group 3 item 11. Spec item 12 is already fixed (noted in spec + Task 12 step 4). All spec sections covered.
- **Notifications policy:** Task 8 implements both bounded (cap 256, drop oldest) and drop-when-no-reader, matching the spec decision.
- **Test rigor:** every task is TDD with a concrete failing test using the agreed fakes (real children for host reaping, `DirectTransports`/no-op transport for client, hand-driven `AbortController` for timing).
- **Type consistency:** `killTimeout` (Task 1), `wireMonitorStreams` (Task 5), `anySignal` export (Task 9), `NOTIFICATION_BUFFER_CAP` (Task 8), `activeChatTurn` (Task 10) are each defined and consumed within their task.
