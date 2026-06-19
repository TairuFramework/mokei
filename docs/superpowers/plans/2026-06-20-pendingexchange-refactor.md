# PendingExchange Correlation Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize `@mokei/context-rpc`'s single-deferred request correlation into a `PendingExchange` abstraction (resolve-once + streaming) plus a continuation-token store, behavior-preserving on the current protocol.

**Architecture:** Two new zero-dependency units — `ExchangeRegistry` (`exchange.ts`) owns the `id → exchange` map and routing; `ContinuationStore` (`continuation.ts`) correlates input sub-requests by opaque token. `ContextRPC` keeps one of each and delegates correlation to them. The `once` path is a 1:1 move of today's logic; the streaming arm + store are built and unit-tested with synthetic frames but have no wire trigger yet.

**Tech Stack:** TypeScript, vitest, `@enkaku/async` (`defer`/`Deferred`), `@enkaku/transport` (`DirectTransports` in tests), `@mokei/context-protocol` types.

## Global Constraints

- **Behavior-preserving:** the existing `context-rpc`, `context-client`, `context-server`, and `host` test suites MUST stay 100% green. The `once` arm is a 1:1 move.
- **No public API change:** `request()`, `requestValue()`, `SentRequest`, `notify()`, and all `src/index.ts` exports stay identical. `ExchangeRegistry` / `ContinuationStore` are NOT exported from `index.ts`.
- **Conventions:** `type` not `interface`; `Array<T>` not `T[]`; never `any` (use `unknown`); ES `#` private fields (no `private` / `readonly`); single-object `…Params` type for any constructor that takes args; capital `ID` (`exchangeID`, `requestID`). NO plan/task labels (`U1`, `B7`, `G5`) in code, comments, or `describe`/`test` names — reference the durable concept (MRTR, SEP-2322) instead.
- **Token type:** opaque `string`. No draft method names or draft frame schemas.
- Use `pnpm`, not npm/npx. Lint via `rtk proxy pnpm run lint`.

## File Structure

```
packages/context-rpc/src/
  exchange.ts        # CREATE — PendingExchange types, StreamFrame, ExchangeRegistry
  continuation.ts    # CREATE — ContinuationEntry, ContinuationStore
  rpc.ts             # MODIFY — delegate correlation to the registry + store
  error.ts           # unchanged
  index.ts           # unchanged
packages/context-rpc/test/
  continuation.test.ts  # CREATE
  exchange.test.ts      # CREATE
  rpc.test.ts           # MODIFY — add one stream-seam integration test (existing 4 stay green)
```

---

### Task 1: ContinuationStore

**Files:**
- Create: `packages/context-rpc/src/continuation.ts`
- Test: `packages/context-rpc/test/continuation.test.ts`

**Interfaces:**
- Consumes: `RequestID` from `@mokei/context-protocol`.
- Produces:
  - `type ContinuationEntry = { exchangeID: RequestID; resolve: (value: unknown) => void; reject: (error: Error) => void }`
  - `class ContinuationStore` with `register(token: string, entry: ContinuationEntry): void`, `route(token: string, result: { value: unknown } | { error: Error }): void`, `clearForExchange(exchangeID: RequestID, reason: Error): void`, `clearAll(reason: Error): void`.

- [ ] **Step 1: Write the failing test**

Create `packages/context-rpc/test/continuation.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest'

import { ContinuationStore } from '../src/continuation.js'

describe('ContinuationStore', () => {
  test('route resolves a registered token then removes it', () => {
    const store = new ContinuationStore()
    const resolve = vi.fn()
    store.register('t1', { exchangeID: 1, resolve, reject: () => {} })
    store.route('t1', { value: 'ok' })
    expect(resolve).toHaveBeenCalledWith('ok')
    // token removed: a second route is a no-op
    store.route('t1', { value: 'again' })
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  test('route rejects on an error result', () => {
    const store = new ContinuationStore()
    const reject = vi.fn()
    store.register('t1', { exchangeID: 1, resolve: () => {}, reject })
    const error = new Error('boom')
    store.route('t1', { error })
    expect(reject).toHaveBeenCalledWith(error)
  })

  test('route on an unknown token is a no-op', () => {
    const store = new ContinuationStore()
    expect(() => store.route('missing', { value: 1 })).not.toThrow()
  })

  test('clearForExchange rejects only the matching exchange tokens', () => {
    const store = new ContinuationStore()
    const rejectA = vi.fn()
    const rejectB = vi.fn()
    store.register('a', { exchangeID: 1, resolve: () => {}, reject: rejectA })
    store.register('b', { exchangeID: 2, resolve: () => {}, reject: rejectB })
    const reason = new Error('settled')
    store.clearForExchange(1, reason)
    expect(rejectA).toHaveBeenCalledWith(reason)
    expect(rejectB).not.toHaveBeenCalled()
  })

  test('clearAll rejects every entry', () => {
    const store = new ContinuationStore()
    const rejectA = vi.fn()
    const rejectB = vi.fn()
    store.register('a', { exchangeID: 1, resolve: () => {}, reject: rejectA })
    store.register('b', { exchangeID: 2, resolve: () => {}, reject: rejectB })
    const reason = new Error('closed')
    store.clearAll(reason)
    expect(rejectA).toHaveBeenCalledWith(reason)
    expect(rejectB).toHaveBeenCalledWith(reason)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/context-rpc exec vitest run test/continuation.test.ts`
Expected: FAIL — `Cannot find module '../src/continuation.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/context-rpc/src/continuation.ts`:

```ts
import type { RequestID } from '@mokei/context-protocol'

export type ContinuationEntry = {
  exchangeID: RequestID
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Correlates input sub-requests by opaque token, decoupled from the outer
 * request id. Each entry is settled at most once and removed on settle.
 */
export class ContinuationStore {
  #entries: Map<string, ContinuationEntry> = new Map()

  register(token: string, entry: ContinuationEntry): void {
    this.#entries.set(token, entry)
  }

  route(token: string, result: { value: unknown } | { error: Error }): void {
    const entry = this.#entries.get(token)
    if (entry == null) {
      return
    }
    this.#entries.delete(token)
    if ('error' in result) {
      entry.reject(result.error)
    } else {
      entry.resolve(result.value)
    }
  }

  clearForExchange(exchangeID: RequestID, reason: Error): void {
    for (const [token, entry] of this.#entries) {
      if (entry.exchangeID === exchangeID) {
        this.#entries.delete(token)
        entry.reject(reason)
      }
    }
  }

  clearAll(reason: Error): void {
    const entries = Array.from(this.#entries.values())
    this.#entries.clear()
    for (const entry of entries) {
      entry.reject(reason)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/context-rpc exec vitest run test/continuation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/context-rpc/src/continuation.ts packages/context-rpc/test/continuation.test.ts
git commit -m "feat(context-rpc): add ContinuationStore for token-correlated sub-requests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: ExchangeRegistry

**Files:**
- Create: `packages/context-rpc/src/exchange.ts`
- Test: `packages/context-rpc/test/exchange.test.ts`

**Interfaces:**
- Consumes: `Deferred` from `@enkaku/async`; `ErrorResponse`, `RequestID`, `Response` from `@mokei/context-protocol`; `RPCError` from `./error.js`.
- Produces:
  - `type StreamHandlers = { onProgress?: (value: unknown) => void; onInputRequest?: (token: string, value: unknown) => void; onSettle?: () => void }`
  - `type StreamFrame = { type: 'progress'; value: unknown } | { type: 'input-request'; token: string; value: unknown } | { type: 'result'; value: unknown } | { type: 'error'; error: Error }`
  - `type ExchangeController = Deferred<unknown> & AbortController`
  - `class ExchangeRegistry` with `has(id): boolean`, `registerOnce(id, controller): void`, `registerStream(id, controller, handlers?): void`, `routeResponse(id, response: Response): void`, `routeStreamFrame(id, frame: StreamFrame): void`, `cancel(id, reason: Error): void`, `endAll(reason: Error): void`.

- [ ] **Step 1: Write the failing test**

Create `packages/context-rpc/test/exchange.test.ts`:

```ts
import { defer } from '@enkaku/async'
import { describe, expect, test, vi } from 'vitest'

import { RPCError } from '../src/error.js'
import { ExchangeRegistry } from '../src/exchange.js'

function makeController() {
  return Object.assign(new AbortController(), defer())
}

describe('ExchangeRegistry once', () => {
  test('routeResponse resolves a once exchange on result then removes it', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    registry.registerOnce(1, controller)
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1, result: { ok: true } })
    await expect(controller.promise).resolves.toEqual({ ok: true })
    expect(registry.has(1)).toBe(false)
  })

  test('routeResponse rejects a once exchange on error', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    registry.registerOnce(1, controller)
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'nope' } })
    await expect(controller.promise).rejects.toBeInstanceOf(RPCError)
  })

  test('routeResponse on an unknown id is a no-op', () => {
    const registry = new ExchangeRegistry()
    expect(() => registry.routeResponse(99, { jsonrpc: '2.0', id: 99, result: {} })).not.toThrow()
  })

  test('cancel rejects and removes a once exchange', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    registry.registerOnce(1, controller)
    const reason = new Error('Cancelled')
    registry.cancel(1, reason)
    await expect(controller.promise).rejects.toBe(reason)
    expect(registry.has(1)).toBe(false)
  })

  test('endAll rejects every pending exchange', async () => {
    const registry = new ExchangeRegistry()
    const a = makeController()
    const b = makeController()
    registry.registerOnce(1, a)
    registry.registerOnce(2, b)
    const reason = new Error('closed')
    registry.endAll(reason)
    await expect(a.promise).rejects.toBe(reason)
    await expect(b.promise).rejects.toBe(reason)
  })
})

describe('ExchangeRegistry stream', () => {
  test('progress and input-request invoke handlers without settling', () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onProgress = vi.fn()
    const onInputRequest = vi.fn()
    registry.registerStream(1, controller, { onProgress, onInputRequest })
    registry.routeStreamFrame(1, { type: 'progress', value: 50 })
    registry.routeStreamFrame(1, { type: 'input-request', token: 'tok', value: { q: 1 } })
    expect(onProgress).toHaveBeenCalledWith(50)
    expect(onInputRequest).toHaveBeenCalledWith('tok', { q: 1 })
    expect(registry.has(1)).toBe(true)
  })

  test('result frame resolves the outer promise, settles, and removes it', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    registry.routeStreamFrame(1, { type: 'result', value: 'done' })
    await expect(controller.promise).resolves.toBe('done')
    expect(onSettle).toHaveBeenCalledTimes(1)
    expect(registry.has(1)).toBe(false)
  })

  test('error frame rejects the outer promise and settles', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    const error = new Error('stream boom')
    registry.routeStreamFrame(1, { type: 'error', error })
    await expect(controller.promise).rejects.toBe(error)
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  test('routeResponse terminates a stream exchange and calls onSettle', async () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onSettle = vi.fn()
    registry.registerStream(1, controller, { onSettle })
    registry.routeResponse(1, { jsonrpc: '2.0', id: 1, result: 'r' })
    await expect(controller.promise).resolves.toBe('r')
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  test('frames after a terminal frame are no-ops', () => {
    const registry = new ExchangeRegistry()
    const controller = makeController()
    const onProgress = vi.fn()
    registry.registerStream(1, controller, { onProgress })
    registry.routeStreamFrame(1, { type: 'result', value: 1 })
    registry.routeStreamFrame(1, { type: 'progress', value: 2 })
    expect(onProgress).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/context-rpc exec vitest run test/exchange.test.ts`
Expected: FAIL — `Cannot find module '../src/exchange.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/context-rpc/src/exchange.ts`:

```ts
import type { Deferred } from '@enkaku/async'
import type { ErrorResponse, RequestID, Response } from '@mokei/context-protocol'

import { RPCError } from './error.js'

export type ExchangeController = Deferred<unknown> & AbortController

export type StreamHandlers = {
  onProgress?: (value: unknown) => void
  onInputRequest?: (token: string, value: unknown) => void
  onSettle?: () => void
}

export type StreamFrame =
  | { type: 'progress'; value: unknown }
  | { type: 'input-request'; token: string; value: unknown }
  | { type: 'result'; value: unknown }
  | { type: 'error'; error: Error }

type OnceExchange = { kind: 'once'; controller: ExchangeController }
type StreamExchange = { kind: 'stream'; controller: ExchangeController; handlers: StreamHandlers }
type PendingExchange = OnceExchange | StreamExchange

/**
 * Owns the outbound id → pending-exchange map and routes inbound frames to it.
 * A `once` exchange settles on the first matching response (current behavior); a
 * `stream` exchange accepts interleaved frames and settles on a terminal one.
 */
export class ExchangeRegistry {
  #exchanges: Map<RequestID, PendingExchange> = new Map()

  has(id: RequestID): boolean {
    return this.#exchanges.has(id)
  }

  registerOnce(id: RequestID, controller: ExchangeController): void {
    this.#exchanges.set(id, { kind: 'once', controller })
  }

  registerStream(id: RequestID, controller: ExchangeController, handlers: StreamHandlers = {}): void {
    this.#exchanges.set(id, { kind: 'stream', controller, handlers })
  }

  routeResponse(id: RequestID, response: Response): void {
    const exchange = this.#exchanges.get(id)
    if (exchange == null) {
      return
    }
    this.#exchanges.delete(id)
    if ('error' in response) {
      exchange.controller.reject(RPCError.fromResponse(response as ErrorResponse))
    } else if ('result' in response) {
      exchange.controller.resolve(response.result)
    }
    if (exchange.kind === 'stream') {
      exchange.handlers.onSettle?.()
    }
  }

  routeStreamFrame(id: RequestID, frame: StreamFrame): void {
    const exchange = this.#exchanges.get(id)
    if (exchange == null || exchange.kind !== 'stream') {
      return
    }
    switch (frame.type) {
      case 'progress':
        exchange.handlers.onProgress?.(frame.value)
        break
      case 'input-request':
        exchange.handlers.onInputRequest?.(frame.token, frame.value)
        break
      case 'result':
        this.#exchanges.delete(id)
        exchange.controller.resolve(frame.value)
        exchange.handlers.onSettle?.()
        break
      case 'error':
        this.#exchanges.delete(id)
        exchange.controller.reject(frame.error)
        exchange.handlers.onSettle?.()
        break
    }
  }

  cancel(id: RequestID, reason: Error): void {
    const exchange = this.#exchanges.get(id)
    if (exchange == null) {
      return
    }
    this.#exchanges.delete(id)
    exchange.controller.reject(reason)
    if (exchange.kind === 'stream') {
      exchange.handlers.onSettle?.()
    }
  }

  endAll(reason: Error): void {
    const exchanges = Array.from(this.#exchanges.values())
    this.#exchanges.clear()
    for (const exchange of exchanges) {
      exchange.controller.reject(reason)
      if (exchange.kind === 'stream') {
        exchange.handlers.onSettle?.()
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/context-rpc exec vitest run test/exchange.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/context-rpc/src/exchange.ts packages/context-rpc/test/exchange.test.ts
git commit -m "feat(context-rpc): add ExchangeRegistry (resolve-once + streaming)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Integrate the registry + store into ContextRPC

**Files:**
- Modify: `packages/context-rpc/src/rpc.ts`
- Test: `packages/context-rpc/test/rpc.test.ts` (add one test; existing four stay green)

**Interfaces:**
- Consumes: `ExchangeRegistry`, `type StreamHandlers` from `./exchange.js`; `ContinuationStore` from `./continuation.js` (Tasks 1–2).
- Produces: `ContextRPC` gains a package-internal `_registerStreamExchange(method: string, params: unknown, handlers?: StreamHandlers): SentRequest<unknown>`. Public surface (`request`, `requestValue`, `SentRequest`, `notify`) and `index.ts` exports are unchanged.

- [ ] **Step 1: Confirm the existing suite is green (behavior-preservation baseline)**

Run: `pnpm --filter @mokei/context-rpc exec vitest run test/rpc.test.ts`
Expected: PASS (4 tests) — this is the behavior-preservation gate before refactoring.

- [ ] **Step 2: Write the failing test for the stream seam**

Add this test inside the existing `describe('ContextRPC transport lifecycle', ...)` block in `packages/context-rpc/test/rpc.test.ts` (after the last test, before the closing `})`):

```ts
  test('_registerStreamExchange resolves on an inbound response', async () => {
    const transports = new DirectTransports<AnyMessage, AnyMessage>()
    const rpc = makeRPC(transports.client)
    rpc._handle()

    const pending = rpc._registerStreamExchange('tools/call', {})
    // Reply from the server side; request id starts at 0.
    await transports.server.write({ jsonrpc: '2.0', id: 0, result: { done: true } } as AnyMessage)
    await expect(pending).resolves.toEqual({ done: true })

    await rpc.dispose()
    await transports.dispose()
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @mokei/context-rpc exec vitest run test/rpc.test.ts`
Expected: FAIL — `rpc._registerStreamExchange is not a function`.

- [ ] **Step 4: Update imports in `rpc.ts`**

In `packages/context-rpc/src/rpc.ts`, the import of `ErrorResponse` is no longer used after Step 6 (response routing moves to the registry). Change the protocol type import (current lines 5–14) from:

```ts
import type {
  AnyMessage,
  CancelledNotification,
  ErrorResponse,
  Notification,
  ProgressNotification,
  Request,
  RequestID,
  Response,
} from '@mokei/context-protocol'
```

to (drop `ErrorResponse`):

```ts
import type {
  AnyMessage,
  CancelledNotification,
  Notification,
  ProgressNotification,
  Request,
  RequestID,
  Response,
} from '@mokei/context-protocol'
```

Then add these two imports after the `./error.js` import line (current line 17):

```ts
import { ContinuationStore } from './continuation.js'
import { ExchangeRegistry, type StreamHandlers } from './exchange.js'
```

- [ ] **Step 5: Replace the `#sentRequests` field with the registry + store**

In `rpc.ts`, replace the field declaration (current line 56):

```ts
  #sentRequests: Record<RequestID, RequestController<unknown>> = {}
```

with:

```ts
  #exchanges: ExchangeRegistry = new ExchangeRegistry()
  #continuations: ContinuationStore = new ContinuationStore()
```

- [ ] **Step 6: Route responses + transport-close through the registry**

Replace `#endPendingRequests` (current lines 128–134):

```ts
  #endPendingRequests(reason: Error): void {
    const pending = Object.values(this.#sentRequests)
    this.#sentRequests = {}
    for (const controller of pending) {
      controller.reject(reason)
    }
  }
```

with:

```ts
  #endPendingRequests(reason: Error): void {
    this.#exchanges.endAll(reason)
    this.#continuations.clearAll(reason)
  }
```

Then replace the response branch inside `_handleMessage` (current lines 178–193):

```ts
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
        // TODO: error invalid response (neither error nor result)
      }
      // TODO: error unknown sent request (controller == null)
      return null
    }
```

with:

```ts
    if (validated.value.method == null) {
      // Message is a response — route to its pending exchange.
      this.#exchanges.routeResponse(id, validated.value as Response)
      return null
    }
```

- [ ] **Step 7: Route `request()` cancellation/timeout/write-failure through the registry**

Replace the body of `request()` (current lines 246–293) — keep the signature line as-is — so the local `#sentRequests[id]` reads/writes become registry calls:

```ts
  request<Method extends keyof T['SendRequests']>(
    method: Method,
    params: T['SendRequests'][Method]['Params'],
    options?: { timeout?: number },
  ): SentRequest<T['SendRequests'][Method]['Result']> {
    const id = this._getNextRequestID()
    const controller = Object.assign(new AbortController(), defer())
    this.#exchanges.registerOnce(id, controller)

    controller.signal.addEventListener('abort', () => {
      if (!this.#exchanges.has(id)) {
        return
      }
      this.#exchanges.cancel(id, new Error('Cancelled'))
      this.notify('cancelled', { requestId: id }).catch(() => {})
    })

    if (options?.timeout != null) {
      const timer = setTimeout(() => {
        if (!this.#exchanges.has(id)) {
          return
        }
        this.#exchanges.cancel(
          id,
          new RequestTimeoutError(`Request timed out after ${options.timeout}ms`),
        )
        this.notify('cancelled', { requestId: id }).catch(() => {})
      }, options.timeout)
      controller.promise.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer),
      )
    }

    this._write({ jsonrpc: '2.0', id, method, params } as T['MessageOut']).catch((error) => {
      if (!this.#exchanges.has(id)) {
        return
      }
      this.#exchanges.cancel(id, error)
    })

    return Object.assign(controller.promise, {
      id,
      cancel: () => {
        controller.abort()
      },
    }) as SentRequest<T['SendRequests'][Method]['Result']>
  }
```

- [ ] **Step 8: Add the package-internal `_registerStreamExchange` method**

In `rpc.ts`, add this method immediately after `request()` and before `requestValue()` (the streaming seam; not exported from `index.ts`):

```ts
  /**
   * @internal Register a streaming exchange (MRTR, SEP-2322): a request answered by
   * interleaved frames. No wire path produces stream frames yet; exercised by tests.
   */
  _registerStreamExchange(
    method: string,
    params: unknown,
    handlers?: StreamHandlers,
  ): SentRequest<unknown> {
    const id = this._getNextRequestID()
    const controller = Object.assign(new AbortController(), defer())
    this.#exchanges.registerStream(id, controller, {
      ...handlers,
      onSettle: () => {
        this.#continuations.clearForExchange(id, new Error('Exchange settled'))
        handlers?.onSettle?.()
      },
    })

    controller.signal.addEventListener('abort', () => {
      if (!this.#exchanges.has(id)) {
        return
      }
      this.#exchanges.cancel(id, new Error('Cancelled'))
      this.notify('cancelled', { requestId: id }).catch(() => {})
    })

    this._write({ jsonrpc: '2.0', id, method, params } as T['MessageOut']).catch((error) => {
      if (!this.#exchanges.has(id)) {
        return
      }
      this.#exchanges.cancel(id, error)
    })

    return Object.assign(controller.promise, {
      id,
      cancel: () => {
        controller.abort()
      },
    }) as SentRequest<unknown>
  }
```

- [ ] **Step 9: Remove the now-unused `RequestController` type alias if unreferenced**

The `type RequestController<Result> = AbortController & Deferred<Result>` (current line 23) is no longer referenced after Step 5. Delete that line. (Leave `SentRequest`, `RequestDefinition`, and all other types untouched.)

- [ ] **Step 10: Run the context-rpc suite**

Run: `pnpm --filter @mokei/context-rpc exec vitest run`
Expected: PASS — existing 4 rpc tests + new stream test + Tasks 1–2 unit tests all green.

- [ ] **Step 11: Run the dependent suites (behavior-preservation gate)**

Run: `pnpm --filter @mokei/context-client --filter @mokei/context-server --filter @mokei/host exec vitest run`
Expected: PASS — no behavior change for any consumer.

Note: cross-package suites resolve the built `lib/` of `@mokei/context-rpc`, so rebuild it first:
Run: `pnpm --filter @mokei/context-rpc run build` then re-run the suites above.
Expected: PASS.

- [ ] **Step 12: Typecheck + lint**

Run: `pnpm --filter @mokei/context-rpc run test:types`
Expected: no errors (no output).
Run: `rtk proxy pnpm run lint`
Expected: `No fixes applied.`

- [ ] **Step 13: Commit**

```bash
git add packages/context-rpc/src/rpc.ts packages/context-rpc/test/rpc.test.ts
git commit -m "refactor(context-rpc): route correlation through ExchangeRegistry + ContinuationStore

Replace the single-deferred #sentRequests with the PendingExchange abstraction
(resolve-once arm = behavior-preserving move of current request/response logic)
and wire the streaming seam + continuation store for MRTR (SEP-2322). No public
API or wire-behavior change on the current protocol.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Two-unit architecture (`ExchangeRegistry` + `ContinuationStore`) → Tasks 1–2. ✓
- ContextRPC integration, behavior-preserving `once` move → Task 3 (Steps 5–9). ✓
- Streaming arm + continuation store, internal/test-only, no `index.ts` export → Tasks 1–2 are relative-imported by tests only; `_registerStreamExchange` is `_`-internal. ✓
- Token = opaque `string`; no draft method names/shapes → `StreamFrame` + token are mokei-internal. ✓
- Behavior-preservation gate → Task 3 Steps 1, 11. ✓
- Conventions (ID casing, `type`, `Array`, `#` fields, no plan labels) → applied throughout; comments reference MRTR/SEP-2322. ✓
- `onSettle` clears continuations on terminal → Task 2 (registry invokes `onSettle`) + Task 3 Step 8 (wires `clearForExchange`). ✓

**Placeholder scan:** No TBD/TODO introduced. The two `// TODO:` comments in the current response branch are intentionally REMOVED by Step 6 (the registry handles unknown-id as a no-op, matching prior behavior). ✓

**Type consistency:** `ExchangeController = Deferred<unknown> & AbortController` used in both `exchange.ts` and constructed in `rpc.ts` via `Object.assign(new AbortController(), defer())` (assignable). `StreamHandlers` consumed in Task 3 matches Task 2's export. `ContinuationEntry.exchangeID` / `clearForExchange(exchangeID, reason)` consistent across Tasks 1 and 3. `routeResponse(id, response: Response)` signature consistent. ✓
