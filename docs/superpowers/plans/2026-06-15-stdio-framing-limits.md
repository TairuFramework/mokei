# Stdio Framing Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound a child MCP server's stdout framing (memory + invalid-JSON) so a misbehaving server can't exhaust host memory or silently hang the transport, reaping the context on any fatal framing fault.

**Architecture:** Bump `@enkaku/*` to 0.17.0 (flat framing API), then thread `maxBufferSize` / `maxMessageSize` / `onInvalidJSON` into the host's `NodeStreamsTransport`. A single seam — the transport's `readFailed` event — forwards every fatal framing fault to the host, which emits `context:failed` and reaps. Two guards (`_contexts[key] == null` + a `framingError` flag) keep that to exactly one event and avoid false positives on clean removal.

**Tech Stack:** TypeScript, `@enkaku/node-streams-transport` 0.17.0, `@mokei/context-server` (`serveProcess`) for the happy-path fixture, Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-06-15-stdio-framing-limits-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `pnpm-workspace.yaml` | enkaku catalog versions | Modify: `^0.16.x` → `^0.17.0` |
| `packages/host/src/host.ts` | `spawnHostedContext` (build transport), `SpawnHostedContextParams`, `AddLocalContextParams`, `addLocalContext` (reap wiring) | Modify |
| `packages/host/test/fixtures/echo-server.mjs` | Real stdio MCP server with one `echo` tool (happy-path fixture) | Create |
| `packages/host/test/framing.test.ts` | Framing tests: flood, stray line, happy path, dedup | Create |

**Note on `truncate`:** the spec shows `truncate(value)` in the `onInvalidJSON` message. Keep it inline and tiny (no new module) — `value.slice(0, 200)`. See Task 3.

---

## Task 1: Bump enkaku catalog to 0.17.0

**Files:**
- Modify: `pnpm-workspace.yaml` (the `catalog:` block, lines ~11-25)

This task is a dependency bump with no code change. Verify the whole workspace still builds and tests green on 0.17 **before** touching framing, so any 0.16→0.17 breakage is isolated to its own commit.

- [ ] **Step 1: Read the current catalog block**

Run: `grep -n "@enkaku" pnpm-workspace.yaml`
Expected (current):
```
'@enkaku/async': ^0.16.0
'@enkaku/client': ^0.16.0
'@enkaku/event': ^0.16.0
'@enkaku/generator': ^0.16.0
'@enkaku/http-client-transport': ^0.16.0
'@enkaku/http-server-transport': ^0.16.0
'@enkaku/log': ^0.16.0
'@enkaku/node-streams-transport': ^0.16.0
'@enkaku/otel': ^0.16.1
'@enkaku/protocol': ^0.16.0
'@enkaku/schema': ^0.16.1
'@enkaku/server': ^0.16.0
'@enkaku/socket-transport': ^0.16.2
'@enkaku/stream': ^0.16.0
'@enkaku/transport': ^0.16.0
```

- [ ] **Step 2: Rewrite every `@enkaku/*` entry to `^0.17.0`**

Edit `pnpm-workspace.yaml` so each of the 15 `@enkaku/*` catalog entries reads `^0.17.0` (this includes the patch-pinned `otel`, `schema`, `socket-transport` — all go to `^0.17.0`). Leave the trailing `- '@enkaku/*'` line (the `onlyBuiltDependencies`/peer glob at line ~81) unchanged.

Result block:
```yaml
'@enkaku/async': ^0.17.0
'@enkaku/client': ^0.17.0
'@enkaku/event': ^0.17.0
'@enkaku/generator': ^0.17.0
'@enkaku/http-client-transport': ^0.17.0
'@enkaku/http-server-transport': ^0.17.0
'@enkaku/log': ^0.17.0
'@enkaku/node-streams-transport': ^0.17.0
'@enkaku/otel': ^0.17.0
'@enkaku/protocol': ^0.17.0
'@enkaku/schema': ^0.17.0
'@enkaku/server': ^0.17.0
'@enkaku/socket-transport': ^0.17.0
'@enkaku/stream': ^0.17.0
'@enkaku/transport': ^0.17.0
```

- [ ] **Step 3: Install**

Run: `pnpm install`
Expected: lockfile updates, resolves `@enkaku/*` to `0.17.0`, no peer-dependency errors. If a transitive `@enkaku/*` package is missing at `0.17.0` on npm, STOP and report — do not pin mismatched versions.

- [ ] **Step 4: Build the whole workspace**

Run: `pnpm build`
Expected: all packages build (types + js), no TypeScript errors. If 0.17 changed a type signature we consume, fix the consumer here and note it in the commit body.

- [ ] **Step 5: Run the whole test suite**

Run: `pnpm test`
Expected: all package + mcp-server tests pass. Pre-existing failures unrelated to enkaku are out of scope — confirm they fail on `main` too before ignoring.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore: bump @enkaku/* catalog to ^0.17.0"
```

---

## Task 2: Happy-path fixture — stdio echo MCP server

**Files:**
- Create: `packages/host/test/fixtures/echo-server.mjs`

A real stdio MCP server used by the happy-path test to prove valid (and large) JSONL frames pass the framer untouched. It uses `serveProcess` from `@mokei/context-server`, exactly like `mcp-servers/fetch/src/serve.ts`. The `echo` tool returns its `text` argument, optionally repeated, so a test can ask for a result that is large but under the buffer cap.

There is no test runner step here — this fixture is exercised by Task 6. Build the dep so the import resolves at spawn time.

- [ ] **Step 1: Ensure `@mokei/context-server` is built**

Run: `pnpm --filter @mokei/context-server build`
Expected: `packages/context-server/lib/` exists and is current. (Cross-package resolution uses built `lib/`, and this fixture is spawned as a real node process that imports `@mokei/context-server`.)

- [ ] **Step 2: Write the fixture**

Create `packages/host/test/fixtures/echo-server.mjs`:

```js
import { createTool, serveProcess } from '@mokei/context-server'

// Minimal stdio MCP server exposing one `echo` tool. Used by the framing
// happy-path test to prove valid JSONL frames (including large ones) pass the
// framer untouched. `repeat` lets a test request a big-but-bounded result.
const config = {
  name: 'echo',
  version: '0.0.0',
  tools: {
    echo: createTool(
      'Echo the given text back, optionally repeated',
      {
        type: 'object',
        properties: {
          text: { type: 'string' },
          repeat: { type: 'integer', minimum: 1 },
        },
        required: ['text'],
        additionalProperties: false,
      },
      (req) => {
        const { text, repeat = 1 } = req.arguments
        return { content: [{ type: 'text', text: text.repeat(repeat) }] }
      },
    ),
  },
}

serveProcess(config)
```

- [ ] **Step 3: Smoke-check the fixture starts and speaks MCP**

Run:
```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' | node packages/host/test/fixtures/echo-server.mjs
```
Expected: a single JSON line on stdout containing `"result"` with `serverInfo`/`capabilities` (the initialize response), then the process stays open (Ctrl-C to exit). If it errors on the import, the dep isn't built — redo Step 1.

> Note: the exact `protocolVersion` string above is only for the manual smoke check; the real test drives the server through `ContextClient`, which sends the correct handshake itself.

- [ ] **Step 4: Commit**

```bash
git add packages/host/test/fixtures/echo-server.mjs
git commit -m "test(host): add stdio echo-server fixture for framing tests"
```

---

## Task 3: Thread framing options into `spawnHostedContext`

**Files:**
- Modify: `packages/host/src/host.ts` (`SpawnHostedContextParams` at `:96-98`, `spawnHostedContext` at `:100-118`)

Add the framing params to `SpawnHostedContextParams`, build the transport with the flat 0.17 options, force unparseable lines into stream errors via `onInvalidJSON`, and forward `readFailed` to a new `onStreamError` callback. No child kill here (no orphan window — see spec Read-loop timing).

This task has no standalone unit test — its behavior is covered end-to-end by Task 5 (flood) and Task 6 (happy path). It is a pure wiring change; the gate is "still builds + existing tests pass".

- [ ] **Step 1: Extend `SpawnHostedContextParams`**

In `packages/host/src/host.ts`, replace:
```ts
export type SpawnHostedContextParams = SpawnContextServerParams & {
  onExit?: (error: Error | null) => void
}
```
with:
```ts
export type SpawnHostedContextParams = SpawnContextServerParams & {
  onExit?: (error: Error | null) => void
  /** Called when the stdout framing/read stream faults (invalid JSON or buffer overflow). */
  onStreamError?: (error: Error) => void
  /** Max total live framer memory in bytes. Default 8 MiB. */
  maxBufferSize?: number
  /** Optional tighter per-message cap in bytes. Default unset (= buffer cap). */
  maxMessageSize?: number
}
```

- [ ] **Step 2: Add the default constant near the top of the module**

Just below the imports in `packages/host/src/host.ts` (e.g. after the `EnableTools*` type aliases at `:35-37`), add:
```ts
/** Default cap on total live stdout framer memory per context (8 MiB). */
const DEFAULT_MAX_BUFFER_SIZE = 8 * 1024 * 1024
```

- [ ] **Step 3: Rewrite `spawnHostedContext` body to build the framed transport**

Replace the current body:
```ts
export async function spawnHostedContext<T extends ContextTypes = UnknownContextTypes>(
  params: SpawnHostedContextParams,
): Promise<HostedContext<T>> {
  const { onExit, ...spawnParams } = params
  const { childProcess, streams, subprocess } = await spawnContextServer(spawnParams)
  if (onExit != null) {
    subprocess.then(
      () => onExit(null),
      (error) => onExit(error as Error),
    )
  }
  const transport = new NodeStreamsTransport({ streams }) as ClientTransport
  return createHostedContext({
    transport,
    dispose: () => {
      childProcess.kill()
    },
  })
}
```
with:
```ts
export async function spawnHostedContext<T extends ContextTypes = UnknownContextTypes>(
  params: SpawnHostedContextParams,
): Promise<HostedContext<T>> {
  const { onExit, onStreamError, maxBufferSize, maxMessageSize, ...spawnParams } = params
  const { childProcess, streams, subprocess } = await spawnContextServer(spawnParams)
  if (onExit != null) {
    subprocess.then(
      () => onExit(null),
      (error) => onExit(error as Error),
    )
  }
  const transport = new NodeStreamsTransport({
    streams,
    maxBufferSize: maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
    maxMessageSize,
    onInvalidJSON: (value, controller) => {
      // Strict: a server that can't speak clean JSONL is broken. Turn the bad
      // line into a stream error so it surfaces as `readFailed` and reaps the
      // context, instead of silently vanishing.
      controller.error(new Error(`Invalid JSON on context stdout: ${value.slice(0, 200)}`))
    },
  }) as ClientTransport
  // Single seam: every fatal framing fault (invalid JSON or buffer overflow)
  // surfaces here. No child kill — there is no pre-registration orphan window
  // (the read loop starts only on first request), and the host's reap disposes
  // the transport, which kills the child.
  transport.events.on('readFailed', ({ error }) => {
    onStreamError?.(error)
  })
  return createHostedContext({
    transport,
    dispose: () => {
      childProcess.kill()
    },
  })
}
```

> If `transport.events.on('readFailed', ...)` reports a type error because `transport` is cast to `ClientTransport`, attach the listener before the cast: build into a `const transport = new NodeStreamsTransport({...})`, call `transport.events.on(...)`, then pass `transport as ClientTransport` to `createHostedContext`. Functionally identical.

- [ ] **Step 4: Type-check the host package**

Run: `pnpm --filter @mokei/host test:types`
Expected: PASS. If `onInvalidJSON` / `maxBufferSize` aren't accepted by `NodeStreamsTransportParams`, the 0.17 bump (Task 1) didn't land — re-verify `node_modules/@enkaku/node-streams-transport/lib/index.d.ts` shows the flat `FromJSONLinesOptions` fields.

- [ ] **Step 5: Build the host package**

Run: `pnpm --filter @mokei/host build`
Expected: builds clean (so later cross-package tests resolve the new `lib/`).

- [ ] **Step 6: Run existing host tests (no regression)**

Run: `pnpm --filter @mokei/host test:unit`
Expected: existing `lifecycle.test.ts` etc. still pass — clean removal must NOT have started emitting `context:failed` (the reap wiring in this task only forwards `readFailed`; the host handler that could emit comes in Task 4).

- [ ] **Step 7: Commit**

```bash
git add packages/host/src/host.ts
git commit -m "feat(host): thread stdio framing limits into spawnHostedContext"
```

---

## Task 4: Reap on framing fault in `addLocalContext`

**Files:**
- Modify: `packages/host/src/host.ts` (`AddLocalContextParams` at `:126-128`, `addLocalContext` at `:339-359`)

Surface framing faults as `context:failed` and reap, with the two dedup guards. Expose `maxBufferSize` / `maxMessageSize` overrides on `AddLocalContextParams`.

- [ ] **Step 1: Extend `AddLocalContextParams`**

Replace:
```ts
export type AddLocalContextParams = SpawnContextServerParams & {
  key: string
}
```
with:
```ts
export type AddLocalContextParams = SpawnContextServerParams & {
  key: string
  /** Override the default 8 MiB stdout framer memory cap. */
  maxBufferSize?: number
  /** Optional tighter per-message cap in bytes. */
  maxMessageSize?: number
}
```

- [ ] **Step 2: Rewrite `addLocalContext` to wire `onStreamError` with guards**

Replace the current body:
```ts
  async addLocalContext<T extends ContextTypes = UnknownContextTypes>(
    params: AddLocalContextParams,
  ): Promise<ContextClient<T>> {
    const { key, ...spawnParams } = params
    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    const context = await spawnHostedContext<T>({
      ...spawnParams,
      onExit: (error) => {
        if (error != null && !isSubprocessExit(error)) {
          void this._events.emit('context:failed', { key, error }).catch(() => {})
        }
        void this.remove(key).catch(() => {})
      },
    })
    this._contexts[key] = context as unknown as HostedContext
    void this._events.emit('context:added', { key }).catch(() => {})
    return context.client
  }
```
with:
```ts
  async addLocalContext<T extends ContextTypes = UnknownContextTypes>(
    params: AddLocalContextParams,
  ): Promise<ContextClient<T>> {
    const { key, ...spawnParams } = params
    if (this._contexts[key] != null) {
      throw new Error(`Context ${key} already exists`)
    }

    // Set once when a framing fault is handled, so the follow-up `onExit` (from
    // the kill during reap) doesn't emit a second `context:failed`.
    let framingError: Error | null = null
    const context = await spawnHostedContext<T>({
      ...spawnParams,
      onStreamError: (error) => {
        // A `readFailed` that arrives after the entry is already gone is
        // teardown noise (disposal, or the re-rejection our own remove() causes)
        // — not a fault. This is what keeps a clean remove() from emitting a
        // bogus context:failed.
        if (this._contexts[key] == null) {
          return
        }
        framingError = error
        void this._events.emit('context:failed', { key, error }).catch(() => {})
        void this.remove(key).catch(() => {})
      },
      onExit: (error) => {
        if (framingError != null) {
          return
        }
        if (error != null && !isSubprocessExit(error)) {
          void this._events.emit('context:failed', { key, error }).catch(() => {})
        }
        void this.remove(key).catch(() => {})
      },
    })
    this._contexts[key] = context as unknown as HostedContext
    void this._events.emit('context:added', { key }).catch(() => {})
    return context.client
  }
```

- [ ] **Step 3: Type-check + build the host package**

Run: `pnpm --filter @mokei/host test:types && pnpm --filter @mokei/host build`
Expected: PASS, clean build.

- [ ] **Step 4: Run existing host tests (no regression)**

Run: `pnpm --filter @mokei/host test:unit`
Expected: `lifecycle.test.ts` still green — in particular "clean removal emits no context:failed" must still hold (proves the `_contexts[key] == null` guard works against disposal `readFailed`).

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/host.ts
git commit -m "feat(host): reap context and emit context:failed on framing fault"
```

---

## Task 5: Test — flood past `maxBufferSize` reaps the context

**Files:**
- Create: `packages/host/test/framing.test.ts`

The child floods stdout with non-terminated bytes past a small `maxBufferSize` override. Because `host.setup()` triggers the lazy `initialize` read, the framer pulls the flood, overflows, errors the stream → `readFailed` → reap. Assert `context:failed` fired, the context is gone, no hang, no unhandled rejection.

- [ ] **Step 1: Write the failing test**

Create `packages/host/test/framing.test.ts`:
```ts
import { describe, expect, test, vi } from 'vitest'

import { ContextHost } from '../src/host.js'

describe('ContextHost stdio framing', () => {
  test('reaps the context when a child floods stdout past maxBufferSize', async () => {
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    const host = new ContextHost()
    const failures: Array<{ key: string; error: Error }> = []
    host.events.on('context:failed', (data) => {
      failures.push(data)
    })

    await host.addLocalContext({
      key: 'flood',
      command: process.execPath,
      // Emit one giant un-terminated line (no newline) far past the cap.
      args: ['-e', 'process.stdout.write("x".repeat(1_000_000))'],
      maxBufferSize: 64 * 1024,
    })

    // Trigger the lazy initialize read so the framer pulls the flood. The child
    // never speaks MCP, so setup() rejects — we assert on the event, not this.
    await host.setup('flood').catch(() => {})

    await vi.waitFor(() => {
      expect(failures).toHaveLength(1)
    })
    expect(failures[0]?.key).toBe('flood')
    expect(host.getContextKeys()).not.toContain('flood')

    await new Promise((resolve) => setTimeout(resolve, 50))
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toHaveLength(0)

    await host.dispose()
  })
})
```

- [ ] **Step 2: Rebuild deps, then run the test to verify it passes**

Cross-package tests resolve `@mokei/*` to built `lib/` — rebuild the host first (it carries the framing code under test):
Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test:unit -- framing`
Expected: PASS. The flood overflows the 64 KiB cap, the stream errors, the context is reaped, exactly one `context:failed`, no unhandled rejection.

> If this hangs instead of failing fast: the read was never triggered (confirm `host.setup('flood')` is called) or `maxBufferSize` didn't thread through (re-check Task 3 Step 3). A hang here is the exact bug this work fixes — treat it as a real failure, not a flaky test.

- [ ] **Step 3: Commit**

```bash
git add packages/host/test/framing.test.ts
git commit -m "test(host): flood past maxBufferSize reaps the context"
```

---

## Task 6: Test — stray non-JSON line, happy path, dedup

**Files:**
- Modify: `packages/host/test/framing.test.ts`

Three more tests in the same file: a stray non-JSON line drives `onInvalidJSON`; a valid large echo result passes untouched; a framing fault emits `context:failed` exactly once.

- [ ] **Step 1: Add the stray-line test**

Append inside the `describe` block in `packages/host/test/framing.test.ts`:
```ts
  test('reaps the context when a child prints a stray non-JSON line', async () => {
    const host = new ContextHost()
    const failures: Array<{ key: string; error: Error }> = []
    host.events.on('context:failed', (data) => {
      failures.push(data)
    })

    await host.addLocalContext({
      key: 'stray',
      command: process.execPath,
      // A single newline-terminated line that is not valid JSON.
      args: ['-e', 'process.stdout.write("not json at all\\n")'],
    })

    await host.setup('stray').catch(() => {})

    await vi.waitFor(() => {
      expect(failures).toHaveLength(1)
    })
    expect(failures[0]?.key).toBe('stray')
    expect(failures[0]?.error.message).toContain('Invalid JSON on context stdout')
    expect(host.getContextKeys()).not.toContain('stray')

    await host.dispose()
  })
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test:unit -- framing`
Expected: PASS. The stray line is unparseable → `onInvalidJSON` → `controller.error` → `readFailed` → reap, and the error message carries the `Invalid JSON on context stdout` prefix from Task 3.

- [ ] **Step 3: Add the happy-path test (real echo server, large valid result)**

Append inside the `describe` block:
```ts
  test('passes valid large frames through the framer untouched', async () => {
    const host = new ContextHost()
    let failed = 0
    host.events.on('context:failed', () => {
      failed += 1
    })

    await host.addLocalContext({
      key: 'echo',
      command: process.execPath,
      args: [new URL('./fixtures/echo-server.mjs', import.meta.url).pathname],
    })

    const tools = await host.setup('echo')
    expect(tools.map((t) => t.tool.name)).toContain('echo')

    // ~500 KiB result: well under the 8 MiB default cap, comfortably larger
    // than a single OS pipe buffer, so it exercises multi-chunk framing.
    const result = await host.callTool('echo', {
      name: 'echo',
      arguments: { text: 'abcd', repeat: 128 * 1024 },
    })
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toHaveLength(4 * 128 * 1024)

    expect(failed).toBe(0)
    await host.dispose()
  })
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter @mokei/context-server build && pnpm --filter @mokei/host build && pnpm --filter @mokei/host test:unit -- framing`
Expected: PASS. The echo server starts, `setup()` lists the `echo` tool, the ~500 KiB result returns intact, no `context:failed`. (Build `@mokei/context-server` first — the spawned fixture imports its built `lib/`.)

> If `host.callTool` typing for `result.content[0]` is awkward, narrow with the existing `CallToolResult` shape rather than `any` — the host re-exports the protocol types. A local `as { type: 'text'; text: string }` on the first content item (as shown) is acceptable in a test.

- [ ] **Step 5: Add the dedup test (exactly one `context:failed`)**

Append inside the `describe` block:
```ts
  test('emits context:failed exactly once on a framing fault', async () => {
    const host = new ContextHost()
    let failed = 0
    let removed = 0
    host.events.on('context:failed', () => {
      failed += 1
    })
    host.events.on('context:removed', () => {
      removed += 1
    })

    await host.addLocalContext({
      key: 'dedup',
      command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(1_000_000))'],
      maxBufferSize: 64 * 1024,
    })

    await host.setup('dedup').catch(() => {})

    await vi.waitFor(() => {
      expect(removed).toBeGreaterThanOrEqual(1)
    })
    // Give the post-reap disposal readFailed + the onExit-from-kill a chance to
    // (wrongly) double-emit, so the assertion is meaningful.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(failed).toBe(1)

    await host.dispose()
  })
```

- [ ] **Step 6: Run the full framing suite**

Run: `pnpm --filter @mokei/host build && pnpm --filter @mokei/host test:unit -- framing`
Expected: all four framing tests PASS. `failed` is exactly 1 in the dedup test — proving both guards (the `_contexts[key] == null` skip on disposal `readFailed`, and the `framingError` flag on `onExit`).

- [ ] **Step 7: Run the whole host package test suite (types + unit)**

Run: `pnpm --filter @mokei/host test`
Expected: PASS — framing tests plus all pre-existing host tests, and `test:types`.

- [ ] **Step 8: Commit**

```bash
git add packages/host/test/framing.test.ts
git commit -m "test(host): stray-line, happy-path, and dedup framing tests"
```

---

## Task 7: Verify whole workspace + archive the planning note

**Files:**
- Move: `docs/agents/plans/next/2026-06-12-stdio-framing-limits.md` → `docs/agents/plans/archive/`

- [ ] **Step 1: Full workspace build + test**

Run: `pnpm build && pnpm test`
Expected: everything green. This catches any consumer of `SpawnHostedContextParams` / `AddLocalContextParams` elsewhere (CLI, host-monitor) that the new optional fields might affect — they're optional, so no caller should break, but confirm.

- [ ] **Step 2: Lint**

Run: `rtk proxy pnpm run lint`
Expected: clean (or auto-fixed). Per project convention, lint via the rtk proxy — not `pnpm lint` directly.

- [ ] **Step 3: Archive the superseded planning note**

```bash
git mv docs/agents/plans/next/2026-06-12-stdio-framing-limits.md docs/agents/plans/archive/2026-06-12-stdio-framing-limits.md
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: archive stdio-framing planning note (shipped)"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Task 1 = §1 catalog bump; Tasks 3-4 = §2/§3 wiring + dedup guards; Tasks 2/5/6 = §4 tests (happy/flood/stray/dedup); Task 7 = §sequencing archive. The dropped "update hang-crash-core-design §6" step is intentionally omitted (that doc is archived — see spec Out of scope).
- **Default 8 MiB, `maxMessageSize` undefined:** set in Task 3 (`DEFAULT_MAX_BUFFER_SIZE`); pass-through `maxMessageSize` stays optional and untested by a dedicated case (YAGNI — overflow is covered by `maxBufferSize`). If you want explicit per-message coverage, add a test passing a small `maxMessageSize` with a single large valid line; not required.
- **Names are consistent across tasks:** `onStreamError`, `framingError`, `DEFAULT_MAX_BUFFER_SIZE`, `maxBufferSize`, `maxMessageSize` are used identically in Tasks 3-6.
- **Read trigger:** every framing test calls `host.setup(key)` — required because the read loop is lazy (spec Read-loop timing). Omitting it makes the test hang, not fail.
