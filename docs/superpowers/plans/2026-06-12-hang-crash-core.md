# Hang/crash core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a misbehaving child MCP server (crash, non-zero exit, silent on `initialize`, stray stdout) from crashing the host process or permanently hanging callers, and stop the CLI from crash-dumping on those failures.

**Architecture:** Three layers. (1) `@mokei/context-rpc` — a caught read loop that rejects all pending requests with a typed `TransportClosedError` when the transport dies, deletes settled requests, and supports an opt-in per-request timeout. (2) `@mokei/context-client` — a hardened `initialize()` with a default timeout, read-until-matching-id, error-response handling, and a `closed` event. (3) `@mokei/host` — `spawn` no longer rethrows into an unowned promise; `ContextHost` emits lifecycle events and reaps a context when its child exits abnormally. The CLI consumes rejected promises through its existing error UX plus a top-level safety net. Stdio framing limits are deferred to an upstream `@enkaku` change (ask doc filed).

**Tech Stack:** TypeScript, pnpm workspace, Vitest (`DirectTransports` for in-process transport tests), Ink (CLI TUI), `nano-spawn`, `@enkaku/{transport,event,async,schema}`.

**Spec:** `docs/agents/plans/next/2026-06-12-hang-crash-core.md` and design `docs/superpowers/specs/2026-06-12-hang-crash-core-design.md`.

**Conventions (project memory — do not skip):**
- Lint with `rtk proxy pnpm run lint` (NOT `pnpm lint` — eslint-not-found).
- The CLI binary loads `dist/`, not `src/`. Rebuild before any real-binary/PTY check: `pnpm --filter ./packages/cli... build:js`.
- Use `type`, not `interface`. `Array<T>`, not `T[]`. No `any`. Names: `ID`/`HTTP` not `Id`/`Http`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/context-rpc/src/error.ts` | RPC error types | Add `TransportClosedError`, `RequestTimeoutError` |
| `packages/context-rpc/src/rpc.ts` | RPC core: read loop, request correlation | Caught loop, `#close`/`#endPendingRequests`, `_onTransportClosed` hook, settled-request deletion, opt-in timeout, dispose rejection |
| `packages/context-rpc/test/rpc.test.ts` | RPC core tests | Create |
| `packages/context-rpc/package.json` | scripts | Add `test:unit`, wire into `test` |
| `packages/context-client/src/client.ts` | MCP client + initialize handshake | Init timeout, read-until-id, error handling, `closed` event |
| `packages/context-client/test/lib.test.ts` | client tests | Add init-hardening + closed-event tests |
| `packages/host/src/spawn.ts` | spawn child server | Remove rethrow, add rejection guard, export `isSubprocessExit` |
| `packages/host/src/host.ts` | `ContextHost`, `spawnHostedContext` | Lifecycle events, `onExit` wiring, settle handler |
| `packages/host/test/lifecycle.test.ts` | host lifecycle tests | Create |
| `packages/host/package.json` | scripts | Add `test:unit`, wire into `test` |
| `packages/cli/src/chat/ChatApp.tsx` | chat TUI root | loadModels retry, Footer-submit wrap, context-failed notices |
| `packages/cli/src/chat/hooks/useSlashCommands.ts` | slash dispatch | try/catch around `loadModels()` |
| `packages/cli/src/chat/ChatLauncher.tsx` | chat launcher | Exit + exit code on build failure |
| `packages/cli/src/index.ts` | `run()` entry | Top-level catch, message-only error |
| `packages/cli/bin/run.js`, `packages/cli/bin/dev.js` | binaries | `unhandledRejection` last-resort handler |
| `../enkaku/docs/agents/plans/backlog/node-streams-framing-limits.md` | upstream ask | Create (deferred item 6) |

---

## Task 1: Wire Vitest into context-rpc and host

Neither package currently runs unit tests (`test` = `test:types` only). Vitest resolves from the workspace root (no per-package devDep needed, same as `@mokei/context-client`).

**Files:**
- Modify: `packages/context-rpc/package.json`
- Modify: `packages/host/package.json`

- [ ] **Step 1: Add `test:unit` to context-rpc and chain it into `test`**

In `packages/context-rpc/package.json`, change the `test` script and add `test:unit`:

```json
    "test:types": "tsc --noEmit --skipLibCheck",
    "test:unit": "vitest run",
    "test": "pnpm run test:types && pnpm run test:unit",
```

- [ ] **Step 2: Same for host**

In `packages/host/package.json`:

```json
    "test:types": "tsc --noEmit --skipLibCheck",
    "test:unit": "vitest run",
    "test": "pnpm run test:types && pnpm run test:unit",
```

- [ ] **Step 3: Verify host's pre-existing tests still pass under the new script**

Run: `pnpm --filter @mokei/host test:unit`
Expected: PASS (existing `http-transport.test.ts`, `local-tools.test.ts` — green baseline already confirmed).

- [ ] **Step 4: Commit**

```bash
git add packages/context-rpc/package.json packages/host/package.json
git commit -m "test: run vitest unit tests in context-rpc and host"
```

---

## Task 2: Add RPC error types

**Files:**
- Modify: `packages/context-rpc/src/error.ts`

- [ ] **Step 1: Append the two error classes to `error.ts`**

Add after the `errorResponse` function (end of file):

```typescript
export class TransportClosedError extends Error {
  name = 'TransportClosedError'
  constructor(message = 'Transport closed', options?: { cause?: unknown }) {
    super(message, options)
  }
}

export class RequestTimeoutError extends Error {
  name = 'RequestTimeoutError'
  constructor(message: string) {
    super(message)
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm --filter @mokei/context-rpc test:types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/context-rpc/src/error.ts
git commit -m "feat(context-rpc): add TransportClosedError and RequestTimeoutError"
```

---

## Task 3: Caught read loop + pending-request rejection on close/dispose

This is the core fix: the read loop must never produce an unhandled rejection, and any pending request must settle (reject) when the transport ends or the RPC is disposed.

**Files:**
- Modify: `packages/context-rpc/src/rpc.ts`
- Test: `packages/context-rpc/test/rpc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/context-rpc/test/rpc.test.ts`:

```typescript
import { DirectTransports, type TransportType } from '@enkaku/transport'
import type { Validator } from '@enkaku/schema'
import type { AnyMessage } from '@mokei/context-protocol'
import { describe, expect, test, vi } from 'vitest'

import { ContextRPC, type RPCTypes } from '../src/rpc.js'
import { RequestTimeoutError, TransportClosedError } from '../src/error.js'

// Passthrough validator — these tests exercise transport lifecycle, not schema.
const passthrough = ((message: unknown) => ({ value: message })) as unknown as Validator<AnyMessage>

type TestTypes = RPCTypes & {
  SendRequests: { 'tools/list': { Params: Record<string, unknown>; Result: unknown } }
}

function makeRPC(transport: TransportType<AnyMessage, AnyMessage>): ContextRPC<TestTypes> {
  return new ContextRPC<TestTypes>({ transport, validateMessageIn: passthrough })
}

describe('ContextRPC transport lifecycle', () => {
  test('rejects pending requests with TransportClosedError on dispose', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()

    const pending = rpc.request('tools/list', {})
    const settled = pending.then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error }),
    )

    await rpc.dispose()
    const outcome = await settled
    expect(outcome.ok).toBe(false)
    expect((outcome as { error: unknown }).error).toBeInstanceOf(TransportClosedError)

    await transports.dispose()
  })

  test('resolves a request on response and sends no cancel afterwards', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()
    const notifySpy = vi.spyOn(rpc, 'notify')

    const pending = rpc.request('tools/list', {})
    // Reply from the server side; request id starts at 0.
    await transports.server.write({ jsonrpc: '2.0', id: 0, result: { tools: [] } } as AnyMessage)
    await expect(pending).resolves.toEqual({ tools: [] })

    // Cancelling an already-settled request must NOT emit notifications/cancelled.
    pending.cancel()
    await Promise.resolve()
    expect(notifySpy).not.toHaveBeenCalled()

    await rpc.dispose()
    await transports.dispose()
  })

  test('opt-in timeout rejects with RequestTimeoutError and notifies cancellation', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()
    const notifySpy = vi.spyOn(rpc, 'notify')

    const pending = rpc.request('tools/list', {}, { timeout: 30 })
    await expect(pending).rejects.toBeInstanceOf(RequestTimeoutError)
    expect(notifySpy).toHaveBeenCalledWith('cancelled', { requestId: 0 })

    await rpc.dispose()
    await transports.dispose()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/context-rpc/test/rpc.test.ts`
Expected: FAIL — `request()` has no `options` arg, dispose does not reject pending, settled requests are not deleted (cancel still notifies).

- [ ] **Step 3: Rewrite the read loop, close path, and dispose in `rpc.ts`**

Add to the imports from `./error.js`:

```typescript
import { errorResponse, RPCError, RequestTimeoutError, TransportClosedError } from './error.js'
```

Add a `#closed` field next to the other private fields (around line 51-57):

```typescript
  #closed = false
```

Change the constructor's dispose wiring (line 60) from `dispose: () => this.#transport.dispose()` to:

```typescript
    super({ dispose: () => this.#dispose() })
```

Replace `_handle()` (lines 82-98) with a caught loop plus the close machinery:

```typescript
  _handle(): void {
    void this.#readLoop()
  }

  async #readLoop(): Promise<void> {
    try {
      while (true) {
        const next = await this._read()
        if (next.done) {
          break
        }
        let response: Response | null = null
        try {
          response = await this._handleMessage(next.value)
        } catch {
          // _handleMessage is defensive; never let a handler error kill the loop.
          response = null
        }
        if (response != null) {
          try {
            await this._write(response)
          } catch {
            // A failed response write is not fatal; transport death surfaces on next read.
          }
        }
      }
      this.#close()
    } catch (cause) {
      this.#close(
        cause instanceof Error
          ? cause
          : new TransportClosedError('Transport read failed', { cause }),
      )
    }
  }

  #close(reason?: Error): void {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#endPendingRequests(reason ?? new TransportClosedError())
    this._onTransportClosed(reason)
  }

  #endPendingRequests(reason: Error): void {
    const pending = Object.values(this.#sentRequests)
    this.#sentRequests = {}
    for (const controller of pending) {
      controller.reject(reason)
    }
  }

  async #dispose(): Promise<void> {
    this.#close(new TransportClosedError('Transport disposed'))
    await this.#transport.dispose()
  }

  /** @internal Called once when the read loop terminates. Subclasses may override to surface it. */
  _onTransportClosed(_reason?: Error): void {}
```

- [ ] **Step 4: Delete settled requests in the response branch**

In `_handleMessage`, replace the response-handling block (current lines 134-148):

```typescript
    if (validated.value.method == null) {
      // Message is a response
      const response = validated.value as Response
      const controller = this.#sentRequests[id]
      if (controller != null) {
        delete this.#sentRequests[id]
        if ('error' in response) {
          controller.reject(RPCError.fromResponse(response as ErrorResponse))
        } else if ('result' in response) {
          controller.resolve(response.result)
        }
      }
      return null
    }
```

- [ ] **Step 5: Add the opt-in timeout to `request()` and guard the cancel notify**

Replace `request()` (lines 201-228) with:

```typescript
  request<Method extends keyof T['SendRequests']>(
    method: Method,
    params: T['SendRequests'][Method]['Params'],
    options?: { timeout?: number },
  ): SentRequest<T['SendRequests'][Method]['Result']> {
    const id = this._getNextRequestID()
    const controller = Object.assign(new AbortController(), defer())
    this.#sentRequests[id] = controller

    controller.signal.addEventListener('abort', () => {
      if (this.#sentRequests[id] == null) {
        return
      }
      delete this.#sentRequests[id]
      controller.reject(new Error('Cancelled'))
      this.notify('cancelled', { requestId: id }).catch(() => {})
    })

    if (options?.timeout != null) {
      const timer = setTimeout(() => {
        if (this.#sentRequests[id] == null) {
          return
        }
        delete this.#sentRequests[id]
        controller.reject(new RequestTimeoutError(`Request timed out after ${options.timeout}ms`))
        this.notify('cancelled', { requestId: id }).catch(() => {})
      }, options.timeout)
      controller.promise.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer),
      )
    }

    this._write({ jsonrpc: '2.0', id, method, params } as T['MessageOut']).catch((error) => {
      controller.reject(error)
    })

    return Object.assign(controller.promise, {
      id,
      cancel: () => {
        controller.abort()
      },
    }) as SentRequest<T['SendRequests'][Method]['Result']>
  }
```

(Note: the abort listener now deletes the entry *before* rejecting, so a `cancel()` after the request already settled finds `#sentRequests[id] == null` and is a no-op — no bogus `notifications/cancelled`. The stray-floating `notify('cancelled')` is now `.catch`-guarded.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/context-rpc/test/rpc.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Type-check the package**

Run: `pnpm --filter @mokei/context-rpc test:types`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/context-rpc/src/rpc.ts packages/context-rpc/test/rpc.test.ts
git commit -m "fix(context-rpc): caught read loop, reject pending on close, settled-request hygiene, opt-in timeout"
```

---

## Task 4: Harden client `initialize()`

**Files:**
- Modify: `packages/context-client/src/client.ts`
- Test: `packages/context-client/test/lib.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/context-client/test/lib.test.ts` (it already imports `DirectTransports`, `ContextClient`, `ClientParams`, `vitest` helpers — reuse them; add `RPCError` to the `@mokei/context-rpc` import if not present):

```typescript
describe('initialize hardening', () => {
  test('times out when the server never responds', async () => {
    const transports = new DirectTransports<ClientMessage, ServerMessage>()
    const client = new ContextClient({
      transport: transports.client as ClientParams['transport'],
      initializeTimeout: 50,
    })
    // Drain the client's initialize request but never reply.
    void transports.server.read()
    await expect(client.initialize()).rejects.toThrow(/within 50ms/)
    await transports.dispose()
  })

  test('throws an RPCError when the server returns an error response', async () => {
    const transports = new DirectTransports<ClientMessage, ServerMessage>()
    const client = new ContextClient({
      transport: transports.client as ClientParams['transport'],
    })
    void (async () => {
      const req = await transports.server.read()
      const id = (req.value as { id: number }).id
      await transports.server.write({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: 'boom' },
      } as ServerMessage)
    })()
    await expect(client.initialize()).rejects.toMatchObject({ message: 'boom' })
    await transports.dispose()
  })

  test('tolerates a notification arriving before the initialize response', async () => {
    const transports = new DirectTransports<ClientMessage, ServerMessage>()
    const client = new ContextClient({
      transport: transports.client as ClientParams['transport'],
    })
    void (async () => {
      const req = await transports.server.read()
      const id = (req.value as { id: number }).id
      await transports.server.write({
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { level: 'info', data: 'hi' },
      } as ServerMessage)
      await transports.server.write({
        jsonrpc: '2.0',
        id,
        result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 's', version: '1' } },
      } as ServerMessage)
    })()
    const result = await client.initialize()
    expect(result.serverInfo.name).toBe('s')
    await transports.dispose()
  })

  test('emits closed when the transport ends', async () => {
    const transports = new DirectTransports<ClientMessage, ServerMessage>()
    const client = new ContextClient({
      transport: transports.client as ClientParams['transport'],
    })
    void (async () => {
      const req = await transports.server.read()
      const id = (req.value as { id: number }).id
      await transports.server.write({
        jsonrpc: '2.0',
        id,
        result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 's', version: '1' } },
      } as ServerMessage)
    })()
    await client.initialize()
    const closed = client.events.once('closed')
    await transports.dispose()
    await expect(closed).resolves.toBeDefined()
  })
})
```

(If `ClientMessage`/`ServerMessage` aren't already imported at the top of the test file, add them to the existing `@mokei/context-protocol` type import.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/context-client/test/lib.test.ts -t "initialize hardening"`
Expected: FAIL — no `initializeTimeout` param, error responses cast to `InitializeResult`, no `closed` event.

- [ ] **Step 3: Add the timeout default, param, and field**

In `client.ts`, after `DEFAULT_INITIALIZE_PARAMS` (line 57) add:

```typescript
export const DEFAULT_INITIALIZE_TIMEOUT = 30_000
```

Add `closed` to `ClientEvents` (lines 71-74):

```typescript
export type ClientEvents = {
  closed: { error?: Error }
  initialized: InitializeResult
  log: Log
}
```

Add `initializeTimeout` to `ClientParams` (lines 113-118):

```typescript
export type ClientParams = {
  createMessage?: CreateMessageHandler
  elicit?: ElicitHandler
  initializeTimeout?: number
  listRoots?: Array<Root> | ListRootsHandler
  transport: ClientTransport
}
```

Add the private field and set it in the constructor. Add next to the other `#` fields (after line 128):

```typescript
  #initializeTimeout: number
```

In the constructor (after line 135 `this.#initialized = lazy(...)`), add:

```typescript
    this.#initializeTimeout = params.initializeTimeout ?? DEFAULT_INITIALIZE_TIMEOUT
```

- [ ] **Step 4: Rewrite `#initialize()` and override `_onTransportClosed`**

Replace `#initialize()` (lines 161-198) with:

```typescript
  async #initialize(): Promise<InitializeResult> {
    const id = this._getNextRequestID()
    // Build capabilities
    const capabilities: ClientCapabilities = {}
    if (this.#elicit != null) {
      capabilities.elicitation = {}
    }
    if (this.#createMessage != null) {
      capabilities.sampling = {}
    }
    if (this.#listRoots != null) {
      capabilities.roots = {}
    }
    // Send initialize request
    await super._write({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: { ...DEFAULT_INITIALIZE_PARAMS, capabilities },
    })
    // Wait for the matching response, bounded by the initialize timeout.
    const timeoutMs = this.#initializeTimeout
    const deadline = AbortSignal.timeout(timeoutMs)
    let result: InitializeResult | undefined
    while (result == null) {
      const next = await Promise.race([
        this._read(),
        new Promise<never>((_resolve, reject) => {
          const fail = () =>
            reject(
              new Error(`Server did not respond to initialize request within ${timeoutMs}ms`),
            )
          if (deadline.aborted) {
            fail()
          } else {
            deadline.addEventListener('abort', fail, { once: true })
          }
        }),
      ])
      if (next.done) {
        throw new Error('Server closed the connection during initialize')
      }
      const message = next.value
      // Drop anything that isn't the initialize response (stray pre-init notifications).
      if (message.id !== id) {
        continue
      }
      if ('error' in message) {
        throw RPCError.fromResponse(message as ErrorResponse)
      }
      result = message.result as InitializeResult
    }
    // Start listening for incoming messages
    this._handle()
    // Notify server that client is initialized
    await super._write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    // TODO: check result.protocolVersion (tracked in mcp-2025-11-25-conformance backlog)
    this.events.emit('initialized', result)
    return result
  }

  _onTransportClosed(reason?: Error): void {
    this.events.emit('closed', { error: reason })
  }
```

Add `ErrorResponse` to the type import from `@mokei/context-protocol` (it's used in the new `'error' in message` branch). Add to the existing import block (lines 4-41):

```typescript
  ErrorResponse,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/context-client/test/lib.test.ts`
Expected: PASS (existing tests + 4 new).

- [ ] **Step 6: Type-check**

Run: `pnpm --filter @mokei/context-client test:types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/context-client/src/client.ts packages/context-client/test/lib.test.ts
git commit -m "fix(context-client): harden initialize (timeout, read-until-id, error responses, closed event)"
```

---

## Task 5: Stop spawn from rethrowing; export the exit predicate

**Files:**
- Modify: `packages/host/src/spawn.ts`

- [ ] **Step 1: Export `isSubprocessExit`, drop the rethrow, add a rejection guard**

Replace `isSubprocessExit` (lines 8-14) to add `export`:

```typescript
export function isSubprocessExit(reason: unknown): boolean {
  return (
    reason instanceof SubprocessError &&
    reason.signalName != null &&
    ['SIGINT', 'SIGTERM'].includes(reason.signalName)
  )
}
```

Replace the spawn block (lines 34-42) — remove the rethrowing `.catch`, add a no-op guard so a spawn failure or abnormal exit never becomes an unhandled rejection (lifecycle is observed via the returned `subprocess`):

```typescript
  const subprocess = spawn(params.command, params.args ?? [], {
    stdio: ['pipe', 'pipe', params.stderr ?? 'ignore'],
    env: filterEnv(params.env),
  })
  // Guard the subprocess promise so an abnormal exit or spawn failure is never an
  // unhandled rejection. Callers observe the real outcome via `subprocess` (see
  // ContextHost.addLocalContext) or via the throw below on spawn failure.
  subprocess.catch(() => {})
```

(The existing `const childProcess = await subprocess.nodeChildProcess` on the next line stays; on a spawn failure such as ENOENT it throws and `spawnContextServer` rejects cleanly — the guard absorbs the parallel `subprocess` rejection.)

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @mokei/host test:types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/host/src/spawn.ts
git commit -m "fix(host): spawn no longer rethrows abnormal child exit into an unowned promise"
```

---

## Task 6: ContextHost lifecycle events + settle wiring

**Files:**
- Modify: `packages/host/src/host.ts`
- Test: `packages/host/test/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/host/test/lifecycle.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest'

import { ContextHost } from '../src/host.js'

describe('ContextHost lifecycle', () => {
  test('reaps a context and emits context:failed when its child exits non-zero, with no unhandled rejection', async () => {
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    const host = new ContextHost()
    const failures: Array<{ key: string; error: Error }> = []
    host.events.on('context:failed', (data) => {
      failures.push(data)
    })

    await host.addLocalContext({
      key: 'boom',
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
    })

    await vi.waitFor(() => {
      expect(failures).toHaveLength(1)
    })
    expect(failures[0]?.key).toBe('boom')
    expect(host.getContextKeys()).not.toContain('boom')

    // Give any stray rejection a tick to surface.
    await new Promise((resolve) => setTimeout(resolve, 50))
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toHaveLength(0)

    await host.dispose()
  })

  test('emits context:added and context:removed without context:failed on a clean removal', async () => {
    const host = new ContextHost()
    const added: Array<string> = []
    const removed: Array<string> = []
    let failed = 0
    host.events.on('context:added', ({ key }) => added.push(key))
    host.events.on('context:removed', ({ key }) => removed.push(key))
    host.events.on('context:failed', () => {
      failed += 1
    })

    await host.addLocalContext({
      key: 'alive',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1e9)'],
    })
    expect(added).toContain('alive')

    await host.remove('alive')
    expect(removed).toContain('alive')
    // Killing our own child (SIGTERM) must not be reported as a failure.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(failed).toBe(0)

    await host.dispose()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/host/test/lifecycle.test.ts`
Expected: FAIL — `host.events` does not exist; no events emitted.

- [ ] **Step 3: Add imports for the event emitter and the exit predicate**

In `host.ts`, add to the `@enkaku` imports (near line 1-3):

```typescript
import { EventEmitter } from '@enkaku/event'
```

Change the spawn import (line 32) to include `isSubprocessExit`:

```typescript
import { type SpawnContextServerParams, isSubprocessExit, spawnContextServer } from './spawn.js'
```

- [ ] **Step 4: Add the `HostEvents` type and `onExit` param**

Add the `HostEvents` type near the other exported types (after `ContextTool`, around line 57):

```typescript
export type HostEvents = {
  'context:added': { key: string }
  'context:removed': { key: string }
  'context:failed': { key: string; error: Error }
}
```

Extend `spawnHostedContext` to accept an `onExit` callback. Replace `spawnHostedContext` (lines 89-100) with:

```typescript
export type SpawnHostedContextParams = SpawnContextServerParams & {
  onExit?: (error: Error | null) => void
}

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

- [ ] **Step 5: Add the event emitter to `ContextHost` and emit on add/remove/fail**

Add the private field + getter inside `ContextHost` (after `_localTools`, around line 129):

```typescript
  /** @internal */
  _events: EventEmitter<HostEvents> = new EventEmitter<HostEvents>()

  get events(): EventEmitter<HostEvents> {
    return this._events
  }
```

Replace `addLocalContext` (lines 315-325) to wire the settle handler and emit:

```typescript
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
          void this._events.emit('context:failed', { key, error })
        }
        void this.remove(key).catch(() => {})
      },
    })
    this._contexts[key] = context as unknown as HostedContext
    void this._events.emit('context:added', { key })
    return context.client
  }
```

Replace `remove` (lines ~398-406) to emit `context:removed`:

```typescript
  async remove(key: string): Promise<void> {
    const ctx = this._contexts[key]
    if (ctx == null) {
      return
    }

    await ctx.disposer.dispose()
    delete this._contexts[key]
    void this._events.emit('context:removed', { key })
  }
```

(`remove` returns early when the context is already gone, so a failed context emits `context:failed` then exactly one `context:removed`; our own SIGTERM-kill on dispose is filtered by `isSubprocessExit` and emits no `context:failed`.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/host/test/lifecycle.test.ts`
Expected: PASS (2 tests), no unhandled rejection.

- [ ] **Step 7: Type-check the package**

Run: `pnpm --filter @mokei/host test:types`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/host/src/host.ts packages/host/test/lifecycle.test.ts
git commit -m "feat(host): ContextHost lifecycle events and abnormal-exit reaping"
```

---

## Task 7: CLI — model-list retry and slash-command error surfacing

**Files:**
- Modify: `packages/cli/src/chat/ChatApp.tsx`
- Modify: `packages/cli/src/chat/hooks/useSlashCommands.ts`

- [ ] **Step 1: Clear the cached promise on failure so a retry re-fetches**

In `ChatApp.tsx`, replace `loadModels` (lines 48-57):

```typescript
  const loadModels = useCallback(() => {
    if (modelsPromiseRef.current == null) {
      modelsPromiseRef.current = provider.listModels().then(
        (list) => {
          const mapped = list.map((m) => ({ id: m.id }))
          setModels(mapped)
          return mapped
        },
        (err) => {
          // Don't cache the failure — a later attempt should re-fetch.
          modelsPromiseRef.current = null
          throw err
        },
      )
    }
    return modelsPromiseRef.current
  }, [provider])
```

- [ ] **Step 2: Catch `loadModels()` rejections in the slash dispatcher**

In `useSlashCommands.ts`, in the message-path block (lines 53-59), wrap the `loadModels()` call:

```typescript
        if (model == null) {
          setPendingPrompt(parsed.text)
          try {
            await loadModels()
          } catch (err) {
            setPendingPrompt(null)
            pushEntry({
              kind: 'notice',
              variant: 'error',
              text: `failed to list models: ${(err as Error).message} — check the endpoint/API key, then retry`,
            })
            return
          }
          setModal('model')
          pushEntry({ kind: 'notice', variant: 'info', text: 'select a model to continue' })
          return
        }
```

And in the `case 'model':` block (lines 126-140), wrap the `loadModels()` call:

```typescript
        case 'model': {
          const [id] = args
          let list: Array<{ id: string }>
          try {
            list = await loadModels()
          } catch (err) {
            pushEntry({
              kind: 'notice',
              variant: 'error',
              text: `failed to list models: ${(err as Error).message} — check the endpoint/API key, then retry`,
            })
            break
          }
          if (id != null) {
            if (list.some((m) => m.id === id)) {
              setModel(id)
              pushEntry({ kind: 'notice', variant: 'success', text: `model: ${id}` })
            } else {
              pushEntry({ kind: 'notice', variant: 'error', text: `unknown model: ${id}` })
            }
          } else {
            setModal('model')
          }
          break
        }
```

- [ ] **Step 3: Type-check the CLI package**

Run: `pnpm --filter @mokei/cli test:types`
Expected: PASS. (If the CLI package name differs, use the name from `packages/cli/package.json`.)

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/chat/ChatApp.tsx packages/cli/src/chat/hooks/useSlashCommands.ts
git commit -m "fix(cli): retry model listing after failure and surface the error in chat"
```

---

## Task 8: CLI — wrap Footer submit and show context-failed notices

**Files:**
- Modify: `packages/cli/src/chat/ChatApp.tsx`

- [ ] **Step 1: Wrap the slash handler so an async rejection becomes a notice, not an unhandled rejection**

In `ChatApp.tsx`, after `handleSubmit` is created (after line 120) add a guarded wrapper, and pass it to `Footer`:

```typescript
  const onSubmit = useCallback(
    (value: string) => {
      void handleSubmit(value).catch((err) => {
        pushEntry({ kind: 'notice', variant: 'error', text: `error: ${(err as Error).message}` })
      })
    },
    [handleSubmit, pushEntry],
  )
```

Change the `Footer` usage (line 275) from `onSubmit={handleSubmit}` to:

```typescript
        onSubmit={onSubmit}
```

- [ ] **Step 2: Subscribe to `context:failed` and surface it**

Add an effect in `ChatApp.tsx` (next to the other effects, after line 102). It subscribes only to `context:failed` — `context:removed` already has user-facing notices via the existing `/context remove` flow, so subscribing to it would double-notify.

```typescript
  useEffect(() => {
    const controller = new AbortController()
    session.contextHost.events.on(
      'context:failed',
      ({ key, error }) => {
        pushEntry({
          kind: 'notice',
          variant: 'error',
          text: `context ${key} failed: ${error.message}`,
        })
      },
      { signal: controller.signal },
    )
    return () => controller.abort()
  }, [session, pushEntry])
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @mokei/cli test:types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/chat/ChatApp.tsx
git commit -m "fix(cli): guard Footer submit and surface context:failed events"
```

---

## Task 9: CLI — top-level error handling and launcher exit

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/bin/run.js`
- Modify: `packages/cli/bin/dev.js`
- Modify: `packages/cli/src/chat/ChatLauncher.tsx`

- [ ] **Step 1: Catch errors in `run()` and print message-only**

Replace `run()` in `packages/cli/src/index.ts`:

```typescript
import { buildProgram } from './program.js'

export { buildProgram }

export async function run(argv: Array<string>): Promise<void> {
  const program = buildProgram()
  // With subcommands but no root action, commander prints help to stderr and
  // exits 1 when invoked with no command. Treat the no-arg case as success:
  // print help to stdout and exit 0. (A root action would instead break
  // `mokei help` / `mokei bogus` under enablePositionalOptions.)
  if (argv.slice(2).length === 0) {
    program.outputHelp()
    return
  }
  try {
    await program.parseAsync(argv)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`✘ ${message}\n`)
    if (process.env.MOKEI_DEBUG === '1' && error instanceof Error && error.stack != null) {
      process.stderr.write(`${error.stack}\n`)
    }
    process.exitCode = 1
  }
}
```

- [ ] **Step 2: Add a last-resort `unhandledRejection` handler to both binaries**

Replace `packages/cli/bin/run.js`:

```javascript
#!/usr/bin/env node

import { run } from '../dist/index.js'

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  process.stderr.write(`✘ ${message}\n`)
  if (process.env.MOKEI_DEBUG === '1' && reason instanceof Error && reason.stack != null) {
    process.stderr.write(`${reason.stack}\n`)
  }
  process.exitCode = 1
})

await run(process.argv)
```

Replace `packages/cli/bin/dev.js` (keep its existing shebang with the `--disable-warning` flag):

```javascript
#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

import { run } from '../dist/index.js'

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  process.stderr.write(`✘ ${message}\n`)
  if (process.env.MOKEI_DEBUG === '1' && reason instanceof Error && reason.stack != null) {
    process.stderr.write(`${reason.stack}\n`)
  }
  process.exitCode = 1
})

await run(process.argv)
```

- [ ] **Step 3: Exit (with code 1) when the chat launcher fails to build**

In `ChatLauncher.tsx`, add an effect that exits after rendering the error. Insert after the existing `useEffect` (after line 48):

```typescript
  useEffect(() => {
    if (error != null) {
      process.exitCode = 1
      exit()
    }
  }, [error, exit])
```

(`exit` is already destructured from `useApp()` at line 21. The error element still renders first; the effect runs after, so the message is shown before unmount.)

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @mokei/cli test:types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/bin/run.js packages/cli/bin/dev.js packages/cli/src/chat/ChatLauncher.tsx
git commit -m "fix(cli): top-level error handling, unhandledRejection net, launcher exit code"
```

---

## Task 10: File the enkaku upstream ask (deferred item 6)

Stdio framing limits (`maxBufferSize`/`maxMessageSize`/`onInvalidJSON`) require threading `FromJSONLinesOptions` through `NodeStreamsTransport`, which today hardcodes `fromJSONLines()`. Per project convention, enkaku asks are filed as docs in the `../enkaku` checkout, not GitHub issues.

**Files:**
- Create: `../enkaku/docs/agents/plans/backlog/node-streams-framing-limits.md`

- [ ] **Step 1: Write the ask doc**

Create `/Users/paul/dev/yulsi/enkaku/docs/agents/plans/backlog/node-streams-framing-limits.md`:

```markdown
# NodeStreamsTransport — expose fromJSONLines framing limits

**Origin:** mokei hang/crash-core audit (2026-06-12). Downstream plan:
`mokei/docs/superpowers/plans/2026-06-12-hang-crash-core.md` item 6.

## Gap

`NodeStreamsTransport` (`packages/node-streams-transport/src/index.ts`) constructs the
inbound stream with a bare `fromJSONLines()` — no options. `@enkaku/stream`'s
`FromJSONLinesOptions` already supports `maxBufferSize`, `maxMessageSize`, and
`onInvalidJSON`, but they cannot be set through the transport.

Impact downstream (mokei host): a spawned MCP child that prints non-JSON to stdout
grows the framing buffer unboundedly, and a single stray line with an unbalanced
`{`/`[` leaves the parser's nesting depth > 0 forever — every later JSON-RPC frame is
silently swallowed and all requests hang.

## Ask

Add an optional `streamOptions?: FromJSONLinesOptions` to `NodeStreamsTransportParams`,
threaded into `createTransportStream` → `fromJSONLines(streamOptions)`. Additive,
non-breaking (defaults to current behavior when omitted).

## Downstream follow-up (mokei)

Once released, mokei wires `maxBufferSize` / `maxMessageSize` / `onInvalidJSON` in
`spawnHostedContext` (`packages/host/src/host.ts`) so a poisoned/oversized stdio
stream surfaces an error and reaps the context instead of hanging.
```

- [ ] **Step 2: Commit (in the enkaku repo)**

```bash
cd /Users/paul/dev/yulsi/enkaku
git add docs/agents/plans/backlog/node-streams-framing-limits.md
git commit -m "docs: ask for NodeStreamsTransport framing limits (mokei hang/crash audit)"
cd /Users/paul/dev/yulsi/mokei
```

---

## Task 11: Full verification

- [ ] **Step 1: Build everything (types + JS), so dist is current for the real-binary check**

Run: `pnpm build`
Expected: all packages build, no type errors.

- [ ] **Step 2: Run the whole test suite**

Run: `pnpm test`
Expected: PASS across packages (context-rpc, context-client, host now run unit tests; rest unchanged).

- [ ] **Step 3: Lint (via the rtk proxy — required)**

Run: `rtk proxy pnpm run lint`
Expected: clean (no errors).

- [ ] **Step 4: Real-binary QA over a PTY for the three crash scenarios**

The CLI binary loads `dist/`; Step 1 rebuilt it. Drive the real binary (per the `cli-real-stdio-qa` convention) and confirm each scenario now degrades gracefully — a friendly message, no raw stack dump, correct exit code:

1. **Spawn failure:** `node packages/cli/bin/run.js inspect nonexistent-command-xyz`
   Expected: `✘`-prefixed friendly "Command failed" message, exit code 1, NO `SubprocessError` stack dump after it.
2. **Failing `/context add` inside chat:** start `node packages/cli/bin/run.js chat -p ollama` (or any provider with a reachable model list), then `/context add bad sh -c 'exit 1'`.
   Expected: an error notice in the transcript ("context bad failed: …" and/or the add error), chat stays alive and responsive — no freeze, no crash.
3. **Unreachable provider on first message:** with no/blocked provider endpoint, `node packages/cli/bin/run.js chat -p openai`, send "hi".
   Expected: an error notice ("failed to list models: …"), the TUI stays up, retrying after fixing the endpoint works — NO ky/undici stack dump, no exit 1.

Note any scenario that still misbehaves and fix before proceeding.

- [ ] **Step 5: Final commit if Step 1-4 produced any incidental fixes**

```bash
git add -A
git commit -m "chore: hang/crash-core verification fixes"
```

(Skip if there is nothing to commit.)

---

## Self-Review notes (already reconciled)

- **Spec item 1 (spawn rethrow)** → Task 5. **Item 2 (read loop)** → Task 3. **Item 3 (sentRequests leak)** → Task 3 Step 4/5. **Item 4 (timeout + dispose rejection)** → Task 3. **Item 5 (initialize hardening)** → Task 4. **Item 6 (stdio framing)** → Task 10 (deferred upstream, by decision). **Item 7 (CLI model-list crash)** → Tasks 7-8. **Item 8 (top-level handler)** → Task 9. **Item 9 (launcher exit)** → Task 9 Step 3.
- **Type consistency:** `_onTransportClosed(reason?: Error)` defined in Task 3, overridden identically in Task 4. `onExit: (error: Error | null) => void` defined in `SpawnHostedContextParams` (Task 6) and called with that exact shape in `addLocalContext`. `HostEvents` keys (`context:added`/`removed`/`failed`) match between emit sites and the CLI subscriber.
- **`context:removed` deliberately not surfaced in the CLI** to avoid double notices with the existing `/context remove` success path (design left this to the implementer; failed-only chosen).
```
