# MCP 2025-11-25 Feature Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Stage:** executing

**Goal:** Replace `SentRequest` with `AbortSignal` injection, make `ContextClient` follow `nextCursor` when listing, give tools an `outputSchema` with validated `structuredContent` on both sides, and fix the `UnsubscribeRequest` type alias.

**Architecture:** `ContextRPC.request` takes an `AbortSignal` and returns a plain `Promise`, so cancellation uses one idiom everywhere. On top of that, a private `#listPaged` helper on `ContextClient` performs the cursor walk and the four public list methods become thin wrappers naming their result key. `createTool`/`createPrompt` convert from positional arguments to a single parameters object, which makes `outputSchema` an optional field; the server validates handler output against it and the client validates received `structuredContent` against a cache populated by `listTools`.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, `@sozai/schema` (`createValidator`), `@sozai/async` (`defer`, `Disposer`), `@enkaku/transport` (`DirectTransports`), biome.

**Spec:** `docs/superpowers/specs/2026-07-09-mcp-feature-gaps-design.md`

**Branch:** `feat/mcp-feature-gaps` (already created, spec already committed)

## Global Constraints

- Never use `interface` — use `type`.
- Never use `T[]` — use `Array<T>`.
- Never use `any` — use `unknown`, `Record<string, unknown>`, or a specific type.
- Never use lowercase abbreviations in names: `ID` not `Id`, `HTTP` not `Http`.
- Use `pnpm`, never `npm`/`npx`.
- Never edit generated files (`lib/`, `.gen.ts`, `__generated__/`).
- Lint with `rtk proxy pnpm run lint` (a shim hijacks bare `pnpm lint`), or `pnpm exec biome check --write <paths>`.
- Cross-package vitest resolves `@mokei/*` to the dependency's built `lib/`, **not** its `src/`. After changing a package that a later task's tests import, rebuild it (`pnpm --filter @mokei/<pkg> build`) before running those tests. Each task states when this is required.
- No test typechecking is configured: `test:types` runs `tsc --noEmit` over `src/**` only, and vitest does not typecheck. Type-level behaviour is therefore verified with a temporary file under `src/`, deleted in the same task.
- Do not `git commit` until the step that says to.

## Task Order

Task 2 lands the `SentRequest` → `AbortSignal` refactor before anything else
touches a request method. Written the other way round, Tasks 3 and 4 would each
be authored against `SentRequest` and then rewritten.

---

### Task 1: Protocol — export `OutputSchema`, fix `UnsubscribeRequest`

`UnsubscribeRequest` is aliased to the wrong schema, so it types as a
`resources/subscribe` request. Nothing references it today (gap 3 is
unimplemented), which is why the bug is invisible. Task 6 needs `OutputSchema`
exported from the package root, which it currently is not — only the
`outputSchema` schema constant is exported.

**Files:**
- Modify: `packages/context-protocol/src/resource.ts:312`
- Modify: `packages/context-protocol/src/index.ts`
- Test: `packages/context-protocol/test/lib.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `OutputSchema` type exported from `@mokei/context-protocol` (`FromSchema<typeof outputSchema>`). Consumed by Tasks 5 and 6.
- Produces: `UnsubscribeRequest` typed as `{ method: 'resources/unsubscribe'; params: { uri: string } }`.

- [ ] **Step 1: Write the failing type check**

The typo is type-only, so no runtime test can see it. Assert assignability in a
temporary file under `src/`, the only directory `test:types` typechecks. Create
`packages/context-protocol/src/__unsubscribe-check.ts`:

```ts
import type { UnsubscribeRequest } from './resource.js'

const request: UnsubscribeRequest = {
  method: 'resources/unsubscribe',
  params: { uri: 'file:///tmp/example.txt' },
}
void request
```

This file is temporary and gets deleted in Step 4.

- [ ] **Step 2: Run the type check to verify it fails**

Run: `pnpm --filter @mokei/context-protocol run test:types`

Expected: FAIL. `Type '"resources/unsubscribe"' is not assignable to type '"resources/subscribe"'` in `__unsubscribe-check.ts`.

If it passes, the typo has already been fixed — stop and confirm before continuing.

- [ ] **Step 3: Fix the alias**

In `packages/context-protocol/src/resource.ts:312`, change:

```ts
export type UnsubscribeRequest = FromSchema<typeof subscribeRequest>
```

to:

```ts
export type UnsubscribeRequest = FromSchema<typeof unsubscribeRequest>
```

- [ ] **Step 4: Run the type check to verify it passes, then delete the temporary file**

Run: `pnpm --filter @mokei/context-protocol run test:types`
Expected: PASS (no output, exit 0).

Then: `rm packages/context-protocol/src/__unsubscribe-check.ts`

- [ ] **Step 5: Write the failing test for the new exports**

Add to `packages/context-protocol/test/lib.test.ts`, in the existing top-level
`describe` that holds the `listToolsRequest` assertions:

```ts
test('unsubscribeRequest declares the resources/unsubscribe method', () => {
  expect(unsubscribeRequest.allOf[1].properties.method.const).toBe('resources/unsubscribe')
})

test('outputSchema requires an object type', () => {
  expect(outputSchema.properties.type.const).toBe('object')
  expect(outputSchema.required).toEqual(['type'])
})
```

Add `outputSchema` and `unsubscribeRequest` to the existing import from
`../src/index.js`, keeping the import list alphabetised.

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @mokei/context-protocol run test:unit`

Expected: FAIL. `unsubscribeRequest` is not exported from `../src/index.js`, so the import is `undefined` and the test throws `TypeError: Cannot read properties of undefined (reading 'allOf')`.

- [ ] **Step 7: Add the exports**

In `packages/context-protocol/src/index.ts`, extend the `./tool.js` export block
with the `OutputSchema` type, keeping alphabetical order:

```ts
export {
  type CallToolRequest,
  type CallToolResult,
  type InputSchema,
  inputSchema,
  type ListToolsRequest,
  type ListToolsResult,
  type OutputSchema,
  outputSchema,
  type Tool,
  type ToolAnnotations,
  type ToolListChangedNotification,
} from './tool.js'
```

In the `./resource.js` export block, add the subscribe/unsubscribe schemas and
types, alphabetised within that block:

```ts
  subscribeRequest,
  type SubscribeRequest,
  unsubscribeRequest,
  type UnsubscribeRequest,
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @mokei/context-protocol run test`
Expected: PASS. Both `test:types` and `test:unit` green.

- [ ] **Step 9: Rebuild and lint**

Downstream packages resolve `@mokei/context-protocol` from `lib/`, so rebuild it
now — later tasks depend on the new exports.

```bash
pnpm --filter @mokei/context-protocol build
pnpm exec biome check --write ./packages/context-protocol
```

- [ ] **Step 10: Commit**

```bash
git add packages/context-protocol
git commit -m "fix(context-protocol): alias UnsubscribeRequest to its own schema

Also export the OutputSchema type and the subscribe/unsubscribe request
schemas, which the tool outputSchema work needs."
```

---

### Task 2: RPC — replace `SentRequest` with `AbortSignal` injection

`SentRequest<Result> = Promise<Result> & { id: number; cancel: () => void }` is
the only cancellation idiom in the request path, and it is a bad one:

- `.id` is read nowhere outside `context-rpc`. `ContextHost.callLocalTool`
  (`host/src/host.ts:588`) casts a bare promise to `SentRequest` and attaches
  only `cancel`, so `.id` is `undefined` there.
- `.cancel()` wraps a signal. Every layer beneath is already signal-based, and
  `Session.executeToolCall` converts the signal straight back into a `cancel()`
  call.
- `SentRequest` does not survive `.then()`, which is why `requestValue`
  re-attaches `id`/`cancel` with `Object.assign`. Nothing calls `requestValue`.

This task deletes `SentRequest` and `requestValue`, threads `options.signal`
through every request method, and returns plain promises. It spans five packages
because the type crosses all of them; splitting it leaves the build red.

**Files:**
- Modify: `packages/context-rpc/src/rpc.ts:28-31,231-320`
- Modify: `packages/context-rpc/src/index.ts:14`
- Modify: `packages/context-client/src/client.ts:200-219,366-402`
- Modify: `packages/context-server/src/types.ts:27,36-41`
- Modify: `packages/context-server/src/server.ts:36,176-186`
- Modify: `packages/host/src/host.ts:19,533-592`
- Modify: `packages/session/src/session.ts:2,373-389`
- Test: `packages/context-rpc/test/rpc.test.ts:40-95`
- Test: `packages/host/test/local-tools.test.ts:540-595`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `export type RequestOptions = { signal?: AbortSignal; timeout?: number }` from `@mokei/context-rpc`
  - `ContextRPC.request(method, params, options?: RequestOptions): Promise<Result>`
  - `SentRequest` and `requestValue` no longer exist
  - `ContextClient.getPrompt(params, options?)`, `.readResource(params, options?)`, `.callTool(params, options?)` — all `Promise`
  - `ServerClient.elicit(params, options?)`, `.listRoots(params?, options?)`, `.createMessage(params, options?)` — all `Promise`
  - `ContextHost.getPrompt(key, params, options?)`, `.callTool(key, params, options?)`, `.callNamespacedTool(id, args?, metadata?, options?)`, `.callLocalTool(name, args?, options?)` — all `Promise<CallToolResult>` (or `GetPromptResult`)
  - `Session.executeToolCall(toolCall, signal?): Promise<CallToolResult>`

- [ ] **Step 1: Rewrite the RPC cancellation tests to use signals**

In `packages/context-rpc/test/rpc.test.ts`, replace the three tests at lines
40–95 that call `.cancel()`. Assertions are preserved; only the cancellation
mechanism changes.

```ts
test('aborting an already-settled request does not notify cancellation', async () => {
  const transports = new DirectTransports<AnyMessage, AnyMessage>()
  const rpc = makeRPC(transports.client)
  rpc._handle()
  const notifySpy = vi.spyOn(rpc, 'notify')
  const controller = new AbortController()

  const pending = rpc.request('tools/list', {}, { signal: controller.signal })
  await transports.server.write({ jsonrpc: '2.0', id: 0, result: { tools: [] } } as AnyMessage)
  await expect(pending).resolves.toEqual({ tools: [] })

  controller.abort()
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

test('aborting a pending request rejects it and notifies cancellation', async () => {
  const transports = new DirectTransports<AnyMessage, AnyMessage>()
  const rpc = makeRPC(transports.client)
  rpc._handle()
  const notifySpy = vi.spyOn(rpc, 'notify')
  const controller = new AbortController()

  const pending = rpc.request('tools/list', {}, { signal: controller.signal })
  controller.abort()
  await expect(pending).rejects.toThrow('Cancelled')
  expect(notifySpy).toHaveBeenCalledWith('cancelled', { requestId: 0 })

  await rpc.dispose()
  await transports.dispose()
})

test('a signal aborted before the call rejects and writes nothing', async () => {
  const transports = new DirectTransports<AnyMessage, AnyMessage>()
  const rpc = makeRPC(transports.client)
  rpc._handle()
  const writeSpy = vi.spyOn(rpc, '_write')

  const reason = new Error('too late')
  const pending = rpc.request('tools/list', {}, { signal: AbortSignal.abort(reason) })

  await expect(pending).rejects.toBe(reason)
  expect(writeSpy).not.toHaveBeenCalled()

  await rpc.dispose()
  await transports.dispose()
})

test('a settled request removes its abort listener from the caller signal', async () => {
  const transports = new DirectTransports<AnyMessage, AnyMessage>()
  const rpc = makeRPC(transports.client)
  rpc._handle()
  const controller = new AbortController()
  const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

  const pending = rpc.request('tools/list', {}, { signal: controller.signal })
  await transports.server.write({ jsonrpc: '2.0', id: 0, result: { tools: [] } } as AnyMessage)
  await pending
  // Give the settle callback a turn.
  await Promise.resolve()

  expect(removeSpy).toHaveBeenCalled()

  await rpc.dispose()
  await transports.dispose()
})
```

The last test matters: a caller's signal can outlive the request — a
session-scoped signal reused across many tool calls — so a listener left behind
on every call accumulates for the life of the session. `SentRequest` never had
this hazard, because the listener lived on an `AbortController` the request
owned.

Update the `_registerStreamExchange` test at line 88 to await the returned
promise directly; it no longer has `.cancel`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @mokei/context-rpc exec vitest run test/rpc.test.ts`

Expected: FAIL. `request()` ignores `options.signal`, so the abort tests hang or resolve rather than rejecting, and `_write` is called even for a pre-aborted signal.

- [ ] **Step 3: Rewrite `request`, `#startExchange`, and `_registerStreamExchange`**

In `packages/context-rpc/src/rpc.ts`, delete the `SentRequest` type at lines
28–31 and add:

```ts
export type RequestOptions = {
  /** Aborts the request, rejecting its promise and notifying the peer. */
  signal?: AbortSignal
  /** Rejects the request with a RequestTimeoutError after this many ms. */
  timeout?: number
}
```

`#startExchange` returns the bare promise:

```ts
  #startExchange(
    id: RequestID,
    controller: ExchangeController,
    method: string,
    params: unknown,
  ): Promise<unknown> {
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

    return controller.promise
  }
```

Add a private helper that links an external signal to the exchange controller and
detaches on settle:

```ts
  /** Aborts `controller` when `signal` fires, detaching once the exchange settles. */
  #linkSignal(controller: ExchangeController, signal: AbortSignal): void {
    const onAbort = () => {
      controller.abort()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const detach = () => {
      signal.removeEventListener('abort', onAbort)
    }
    controller.promise.then(detach, detach)
  }
```

Rewrite `request`:

```ts
  request<Method extends keyof T['SendRequests']>(
    method: Method,
    params: T['SendRequests'][Method]['Params'],
    options?: RequestOptions,
  ): Promise<T['SendRequests'][Method]['Result']> {
    // A signal already aborted at call time sends nothing on the wire.
    if (options?.signal?.aborted) {
      return Promise.reject(options.signal.reason as Error)
    }

    const id = this._getNextRequestID()
    const controller = Object.assign(new AbortController(), defer())
    this.#exchanges.registerOnce(id, controller)

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

    if (options?.signal != null) {
      this.#linkSignal(controller, options.signal)
    }

    return this.#startExchange(id, controller, method as string, params) as Promise<
      T['SendRequests'][Method]['Result']
    >
  }
```

Rewrite `_registerStreamExchange` to return a promise and accept options:

```ts
  /**
   * @internal Register a streaming exchange (MRTR, SEP-2322): a request answered by
   * interleaved frames. No wire path produces stream frames yet; exercised by tests.
   */
  _registerStreamExchange(
    method: string,
    params: unknown,
    handlers?: StreamHandlers,
    options?: RequestOptions,
  ): Promise<unknown> {
    if (options?.signal?.aborted) {
      return Promise.reject(options.signal.reason as Error)
    }
    const id = this._getNextRequestID()
    const controller = Object.assign(new AbortController(), defer())
    this.#exchanges.registerStream(id, controller, {
      ...handlers,
      onSettle: () => {
        this.#continuations.clearForExchange(id, new Error('Exchange settled'))
        handlers?.onSettle?.()
      },
    })
    if (options?.signal != null) {
      this.#linkSignal(controller, options.signal)
    }
    return this.#startExchange(id, controller, method, params)
  }
```

Delete `requestValue` entirely — nothing calls it.

In `packages/context-rpc/src/index.ts:14`, drop `SentRequest` from the exports
and add `RequestOptions`:

```ts
export { ContextRPC, type RPCParams, type RequestOptions, type RPCTypes } from './rpc.js'
```

- [ ] **Step 4: Run the RPC tests to verify they pass**

Run: `pnpm --filter @mokei/context-rpc run test`
Expected: PASS.

Then rebuild — the four downstream packages resolve it from `lib/`:

```bash
pnpm --filter @mokei/context-rpc build
```

- [ ] **Step 5: Propagate to `context-client`**

In `packages/context-client/src/client.ts`, change the `@mokei/context-rpc`
import from `type SentRequest` to `type RequestOptions`.

The `request` override keeps its trace injection, with the new signature:

```ts
  request<Method extends keyof ClientTypes['SendRequests']>(
    method: Method,
    params: ClientTypes['SendRequests'][Method]['Params'],
    options?: RequestOptions,
  ): Promise<ClientTypes['SendRequests'][Method]['Result']> {
    const trace = currentTraceMeta()
    if (trace.traceparent == null) {
      return super.request(method, params, options)
    }
    const base =
      params != null && typeof params === 'object' ? (params as Record<string, unknown>) : {}
    const existingMeta =
      base._meta != null && typeof base._meta === 'object'
        ? (base._meta as Record<string, unknown>)
        : {}
    const merged = { ...base, _meta: { ...existingMeta, ...trace } }
    return super.request(method, merged as typeof params, options)
  }
```

Convert the three non-list request methods (the four list methods are rewritten
wholesale in Task 3, so leave them returning `this.request(...)` — they compile
unchanged, now yielding `Promise`):

```ts
  getPrompt(
    params: PromptParams<T>,
    options?: RequestOptions,
  ): Promise<GetPromptResult> {
    return this.request('prompts/get', params as GetPromptRequest['params'], options)
  }

  readResource(
    params: ReadResourceRequest['params'],
    options?: RequestOptions,
  ): Promise<ReadResourceResult> {
    return this.request('resources/read', params, options)
  }

  callTool(params: ToolParams<T>, options?: RequestOptions): Promise<CallToolResult> {
    return this.request('tools/call', params as CallToolRequest['params'], options)
  }
```

Update the four list methods' declared return types from `SentRequest<X>` to
`Promise<X>` — their bodies already just return `this.request(...)`.

- [ ] **Step 6: Propagate to `context-server`**

In `packages/context-server/src/types.ts`, swap the `SentRequest` type import for
`RequestOptions` and update `ServerClient`:

```ts
export type ServerClient = {
  createMessage: (
    params: CreateMessageRequest['params'],
    options?: RequestOptions,
  ) => Promise<CreateMessageResult>
  elicit: (params: ElicitRequest['params'], options?: RequestOptions) => Promise<ElicitResult>
  listRoots: (
    params?: ListRootsRequest['params'],
    options?: RequestOptions,
  ) => Promise<ListRootsResult>
  log: LogFunction
}
```

In `packages/context-server/src/server.ts`, swap the import and the three
methods:

```ts
  elicit(params: ElicitRequest['params'], options?: RequestOptions): Promise<ElicitResult> {
    return this.request('elicitation/create', params, options)
  }

  listRoots(
    params: ListRootsRequest['params'] = {},
    options?: RequestOptions,
  ): Promise<ListRootsResult> {
    return this.request('roots/list', params, options)
  }

  createMessage(
    params: CreateMessageRequest['params'],
    options?: RequestOptions,
  ): Promise<CreateMessageResult> {
    return this.request('sampling/createMessage', params, options)
  }
```

- [ ] **Step 7: Propagate to `host`, deleting the `callLocalTool` cast**

In `packages/host/src/host.ts`, swap the `SentRequest` type import for
`RequestOptions` and rewrite the four methods:

```ts
  getPrompt<T extends ContextTypes = UnknownContextTypes>(
    key: string,
    params: PromptParams<T>,
    options?: RequestOptions,
  ): Promise<GetPromptResult> {
    return this.getContext<T>(key).client.getPrompt(params, options)
  }

  callTool<T extends ContextTypes = UnknownContextTypes>(
    key: string,
    params: ToolParams<T>,
    options?: RequestOptions,
  ): Promise<CallToolResult> {
    return this.getContext<T>(key).client.callTool(params, options)
  }

  callNamespacedTool(
    id: string,
    args: Record<string, unknown> = {},
    metadata?: Metadata,
    options?: RequestOptions,
  ): Promise<CallToolResult> {
    // Check if this is a local tool
    if (isLocalToolID(id)) {
      return this.callLocalTool(getLocalToolName(id), args, options)
    }

    const [key, name] = getContextToolInfo(id)
    return this.callTool(key, { name, arguments: args, _meta: metadata }, options)
  }

  /** Call a local tool by name. */
  async callLocalTool(
    name: string,
    args: Record<string, unknown> = {},
    options?: RequestOptions,
  ): Promise<CallToolResult> {
    const localTool = this._localTools.get(name)
    if (localTool == null) {
      throw new Error(`Local tool "${name}" does not exist`)
    }
    if (options?.signal?.aborted) {
      throw options.signal.reason
    }

    try {
      return await localTool.execute(args, options?.signal)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: errorMessage }],
        isError: true,
      }
    }
  }
```

The hand-rolled `AbortController`, the `promise as SentRequest<CallToolResult>`
cast, and the manual `request.cancel = ...` assignment all disappear: the
caller's signal goes straight to `localTool.execute`, whose second parameter is
already an optional `AbortSignal`.

Two behaviour notes, both preserved from the original:

- An abort *before* the call throws. The reason is now `signal.reason` rather
  than a hard-coded `Error('Request cancelled')`.
- An abort *during* `execute` surfaces as an `isError: true` result, not a
  rejection, because `execute`'s rejection is caught by the same `catch`.

- [ ] **Step 8: Propagate to `session`, collapsing `executeToolCall`**

In `packages/session/src/session.ts`, drop the `SentRequest` import and replace
`executeToolCall` (lines 373–389) with a passthrough:

```ts
  executeToolCall<P extends T = T>(
    toolCall: FunctionToolCall<P['ToolCall']>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    return this.#contextHost.callNamespacedTool(
      toolCall.name,
      JSON.parse(toolCall.arguments),
      undefined,
      { signal },
    )
  }
```

The old body threw synchronously on an already-aborted signal; the new one
rejects instead. Its only caller, `agent-session.ts:640`, awaits it, so both
behave identically there.

- [ ] **Step 9: Update the host local-tool cancellation tests**

In `packages/host/test/local-tools.test.ts`, the two tests around lines 540–595
call `request.cancel()`. Convert both to signals. The `createTool` calls in this
file stay positional for now — Task 5 migrates them.

```ts
    const controller = new AbortController()
    const request = host.callLocalTool('waiter', {}, { signal: controller.signal })
    // Let execute start and subscribe to the signal.
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await request

    expect(observedAbort).toBe(true)
```

The assertion is unchanged: `execute` observes the abort, resolves `'done'`, and
`await request` resolves.

- [ ] **Step 10: Build the chain and run every affected suite**

```bash
pnpm --filter @mokei/context-rpc build
pnpm --filter @mokei/context-client build
pnpm --filter @mokei/context-server build
pnpm --filter @mokei/host build
pnpm --filter @mokei/context-rpc run test
pnpm --filter @mokei/context-client run test
pnpm --filter @mokei/context-server run test
pnpm --filter @mokei/host run test
pnpm --filter @mokei/session run test
```

Expected: PASS for all five. `packages/context-client/test/trace.test.ts:95`
holds a pending `callTool` — it now yields a plain promise and should still
resolve. If `session` or `cli` fails to typecheck, a `SentRequest` import
survives somewhere: `grep -rn "SentRequest" packages --include=*.ts | grep -v /lib/`
must return nothing.

- [ ] **Step 11: Lint**

```bash
pnpm exec biome check --write ./packages
```

- [ ] **Step 12: Commit**

```bash
git add packages
git commit -m "refactor(context-rpc)!: replace SentRequest with AbortSignal injection

request() takes options.signal and returns a plain Promise. The abort
listener is detached when the exchange settles, so a caller signal reused
across many requests no longer accumulates listeners.

Drops the SentRequest cast in ContextHost.callLocalTool (whose .id was
always undefined) and collapses Session.executeToolCall to a passthrough.
Deletes requestValue, which nothing called.

BREAKING: SentRequest and requestValue are removed. Every request method
returns Promise and accepts an optional signal instead of exposing cancel()."
```

---

### Task 3: Client — `ListMaxPagesError` and the `#listPaged` walk

The four list methods issue one request and drop `nextCursor`, so a paginating
server is silently truncated to its first page. `ContextHost.setup()` then builds
its tool set from that first page. This is the interop bug the whole cycle exists
to fix.

**Files:**
- Modify: `packages/context-client/src/client.ts`
- Modify: `packages/context-client/src/index.ts`
- Test: `packages/context-client/test/lib.test.ts`

**Interfaces:**
- Consumes: `RequestOptions` and the `Promise`-returning `request()` from Task 2.
- Produces:
  - `export type ListOptions = { maxPages?: number; signal?: AbortSignal; timeout?: number }`
  - `export class ListMaxPagesError extends Error { method: string; pages: number; cursor: string; results: Array<unknown> }`
  - `export const DEFAULT_LIST_MAX_PAGES = 100`
  - `ClientParams.listMaxPages?: number`
  - `listTools(params?, options?): Promise<ListToolsResult>`, same shape for `listPrompts`, `listResources`, `listResourceTemplates`
  - protected `this._cacheToolOutputSchemas(tools)` — a no-op stub here, implemented in Task 4

- [ ] **Step 1: Write the failing tests**

The existing `executeClientRequest` helper answers exactly one request, so it
cannot script a walk. Add a multi-page helper beside it in
`packages/context-client/test/lib.test.ts`:

```ts
type Page = { result: Record<string, unknown> }

/**
 * Drives a client list call against a server that answers `pages` in order.
 * Returns the pending result plus the params of every request the server saw,
 * so a test can assert the cursor was threaded through.
 */
async function runListWalk<T>(
  runRequest: (client: ContextClient) => Promise<T>,
  pages: Array<Page>,
  clientParams: Omit<ClientParams, 'transport'> = {},
): Promise<{ result: Promise<T>; requests: Array<Record<string, unknown>> }> {
  const transports = new DirectTransports<ServerMessage, ClientMessage>()
  const client = new ContextClient({ ...clientParams, transport: transports.client })

  client.initialize()
  await handleServerInitialize(transports.server, {
    ...DEFAULT_INITIALIZE_RESULT,
    capabilities: { tools: {} },
  })

  const result = runRequest(client)
  const requests: Array<Record<string, unknown>> = []

  for (const page of pages) {
    const incoming = await transports.server.read()
    if (incoming.done) {
      break
    }
    const request = incoming.value as { id: number; params: Record<string, unknown> }
    requests.push(request.params)
    transports.server.write({ jsonrpc: '2.0', id: request.id, result: page.result } as ServerMessage)
  }

  return { result, requests }
}
```

Then the tests:

```ts
describe('list pagination', () => {
  const toolA = { name: 'a', inputSchema: { type: 'object' } }
  const toolB = { name: 'b', inputSchema: { type: 'object' } }
  const toolC = { name: 'c', inputSchema: { type: 'object' } }

  test('walks every page and returns one aggregate without nextCursor', async () => {
    const { result, requests } = await runListWalk((client) => client.listTools(), [
      { result: { tools: [toolA], nextCursor: 'c1' } },
      { result: { tools: [toolB], nextCursor: 'c2' } },
      { result: { tools: [toolC] } },
    ])

    await expect(result).resolves.toEqual({ tools: [toolA, toolB, toolC] })
    expect(requests).toEqual([{}, { cursor: 'c1' }, { cursor: 'c2' }])
  })

  test('an explicit cursor issues one request and preserves nextCursor', async () => {
    const { result, requests } = await runListWalk((client) => client.listTools({ cursor: 'c1' }), [
      { result: { tools: [toolB], nextCursor: 'c2' } },
    ])

    await expect(result).resolves.toEqual({ tools: [toolB], nextCursor: 'c2' })
    expect(requests).toEqual([{ cursor: 'c1' }])
  })

  test('throws ListMaxPagesError with partial results when the cap is exceeded', async () => {
    const { result } = await runListWalk((client) => client.listTools({}, { maxPages: 2 }), [
      { result: { tools: [toolA], nextCursor: 'c1' } },
      { result: { tools: [toolB], nextCursor: 'c2' } },
    ])

    await expect(result).rejects.toThrow(ListMaxPagesError)
    await result.catch((error: unknown) => {
      const listError = error as ListMaxPagesError
      expect(listError.method).toBe('tools/list')
      expect(listError.pages).toBe(2)
      expect(listError.cursor).toBe('c2')
      expect(listError.results).toEqual([toolA, toolB])
    })
  })

  test('a server echoing an unchanging cursor terminates at the cap', async () => {
    const page = { result: { tools: [toolA], nextCursor: 'same' } }
    const { result } = await runListWalk((client) => client.listTools({}, { maxPages: 3 }), [
      page,
      page,
      page,
    ])
    await expect(result).rejects.toThrow(ListMaxPagesError)
  })

  test('listMaxPages on ClientParams supplies the default cap', async () => {
    const page = { result: { tools: [toolA], nextCursor: 'same' } }
    const { result } = await runListWalk((client) => client.listTools(), [page], {
      listMaxPages: 1,
    })
    await expect(result).rejects.toThrow(ListMaxPagesError)
  })

  test('an aborted signal rejects the walk in progress', async () => {
    const controller = new AbortController()
    const { result } = await runListWalk(
      (client) => client.listTools({}, { signal: controller.signal }),
      [{ result: { tools: [], nextCursor: 'c1' } }],
    )
    controller.abort()
    await expect(result).rejects.toThrow()
  })

  test('listPrompts walks pages', async () => {
    const { result } = await runListWalk((client) => client.listPrompts(), [
      { result: { prompts: [{ name: 'a' }], nextCursor: 'c1' } },
      { result: { prompts: [{ name: 'b' }] } },
    ])
    await expect(result).resolves.toEqual({ prompts: [{ name: 'a' }, { name: 'b' }] })
  })

  test('listResources walks pages', async () => {
    const { result } = await runListWalk((client) => client.listResources(), [
      { result: { resources: [{ name: 'a', uri: 'test://a' }], nextCursor: 'c1' } },
      { result: { resources: [{ name: 'b', uri: 'test://b' }] } },
    ])
    await expect(result).resolves.toEqual({
      resources: [
        { name: 'a', uri: 'test://a' },
        { name: 'b', uri: 'test://b' },
      ],
    })
  })

  test('listResourceTemplates walks pages', async () => {
    const { result } = await runListWalk((client) => client.listResourceTemplates(), [
      {
        result: {
          resourceTemplates: [{ name: 'a', uriTemplate: 'test://a/{x}' }],
          nextCursor: 'c1',
        },
      },
      { result: { resourceTemplates: [{ name: 'b', uriTemplate: 'test://b/{x}' }] } },
    ])
    await expect(result).resolves.toEqual({
      resourceTemplates: [
        { name: 'a', uriTemplate: 'test://a/{x}' },
        { name: 'b', uriTemplate: 'test://b/{x}' },
      ],
    })
  })
})
```

Each method gets its own case: a wrapper naming the wrong result key is the
plausible failure here, and a helper-only test cannot catch it.

Add `ListMaxPagesError` to the existing import from `../src/index.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @mokei/context-client exec vitest run test/lib.test.ts -t "list pagination"`

Expected: FAIL. `ListMaxPagesError` is not exported (the import is `undefined`), and the walk tests fail because the client sends one request and resolves with `nextCursor` still set.

- [ ] **Step 3: Add the error, the options type, and the `listMaxPages` param**

In `packages/context-client/src/client.ts`, below `CapabilityNotDeclaredError`:

```ts
/** Thrown when a paginated list walk fetches more pages than its cap allows. */
export class ListMaxPagesError extends Error {
  /** The list method that exceeded the cap, e.g. `tools/list`. */
  method: string
  /** Number of pages fetched before giving up. */
  pages: number
  /** Cursor of the page that would have been fetched next. */
  cursor: string
  /** Items collected across the pages that were fetched. */
  results: Array<unknown>

  constructor(method: string, pages: number, cursor: string, results: Array<unknown>) {
    super(`Listing ${method} exceeded the maximum of ${pages} pages`)
    this.name = 'ListMaxPagesError'
    this.method = method
    this.pages = pages
    this.cursor = cursor
    this.results = results
  }
}

/** Options accepted by the paginated list methods. */
export type ListOptions = {
  /** Overrides `ClientParams.listMaxPages` for this call. */
  maxPages?: number
  /** Aborts the walk, cancelling the request in flight. */
  signal?: AbortSignal
  /** Timeout applied to each page request, not to the walk as a whole. */
  timeout?: number
}
```

Beside `DEFAULT_INITIALIZE_TIMEOUT`:

```ts
/** Default cap on pages fetched by a single list walk. */
export const DEFAULT_LIST_MAX_PAGES = 100
```

Near the other module-level types:

```ts
type PagedResult = { nextCursor?: string } & Record<string, unknown>
```

Extend `ClientParams` with `listMaxPages?: number`, add the private field
`#listMaxPages: number`, and assign it in the constructor next to
`#initializeTimeout`:

```ts
    this.#listMaxPages = params.listMaxPages ?? DEFAULT_LIST_MAX_PAGES
```

- [ ] **Step 4: Implement `#listPaged`**

Add above the public list methods. Task 2 already made `request()` signal-aware,
so a page is one `await` and there is no cancellation plumbing here:

```ts
  /**
   * Walks a paginated list method until the server stops returning a cursor.
   *
   * When `params.cursor` is set the caller is driving pagination: a single
   * request is issued and its page returned verbatim, `nextCursor` intact.
   */
  async #listPaged(
    method: string,
    key: string,
    send: (params: Record<string, unknown>) => Promise<PagedResult>,
    params: Record<string, unknown>,
    options: ListOptions,
  ): Promise<PagedResult> {
    await this.#initialized

    if (params.cursor != null) {
      return await send(params)
    }

    const maxPages = options.maxPages ?? this.#listMaxPages
    const items: Array<unknown> = []
    let cursor: string | undefined
    let pages = 0

    while (true) {
      const page = await send(cursor == null ? params : { ...params, cursor })
      pages += 1

      const pageItems = page[key]
      if (Array.isArray(pageItems)) {
        items.push(...pageItems)
      }

      if (page.nextCursor == null) {
        const { nextCursor: _nextCursor, ...rest } = page
        return { ...rest, [key]: items }
      }
      if (pages >= maxPages) {
        throw new ListMaxPagesError(method, pages, page.nextCursor, items)
      }
      cursor = page.nextCursor
    }
  }
```

The cap check runs *after* a page arrives and *only* when that page advertises
another, so `maxPages: 2` against a two-page server succeeds and against a
three-page server throws with `pages === 2`. A server echoing an unchanging
cursor terminates at the cap rather than spinning.

- [ ] **Step 5: Rewrite the four public list methods**

```ts
  async listPrompts(
    params: ListPromptsRequest['params'] = {},
    options: ListOptions = {},
  ): Promise<ListPromptsResult> {
    const result = await this.#listPaged(
      'prompts/list',
      'prompts',
      (pageParams) =>
        this.request('prompts/list', pageParams as ListPromptsRequest['params'], {
          signal: options.signal,
          timeout: options.timeout,
        }) as Promise<PagedResult>,
      params,
      options,
    )
    return result as ListPromptsResult
  }

  async listResources(
    params: ListResourcesRequest['params'] = {},
    options: ListOptions = {},
  ): Promise<ListResourcesResult> {
    const result = await this.#listPaged(
      'resources/list',
      'resources',
      (pageParams) =>
        this.request('resources/list', pageParams as ListResourcesRequest['params'], {
          signal: options.signal,
          timeout: options.timeout,
        }) as Promise<PagedResult>,
      params,
      options,
    )
    return result as ListResourcesResult
  }

  async listResourceTemplates(
    params: ListResourceTemplatesRequest['params'] = {},
    options: ListOptions = {},
  ): Promise<ListResourceTemplatesResult> {
    const result = await this.#listPaged(
      'resources/templates/list',
      'resourceTemplates',
      (pageParams) =>
        this.request(
          'resources/templates/list',
          pageParams as ListResourceTemplatesRequest['params'],
          { signal: options.signal, timeout: options.timeout },
        ) as Promise<PagedResult>,
      params,
      options,
    )
    return result as ListResourceTemplatesResult
  }

  async listTools(
    params: ListToolsRequest['params'] = {},
    options: ListOptions = {},
  ): Promise<ListToolsResult> {
    await this.#initialized
    this.#requireServerCapability('tools')
    const result = (await this.#listPaged(
      'tools/list',
      'tools',
      (pageParams) =>
        this.request('tools/list', pageParams as ListToolsRequest['params'], {
          signal: options.signal,
          timeout: options.timeout,
        }) as Promise<PagedResult>,
      params,
      options,
    )) as ListToolsResult
    this._cacheToolOutputSchemas(result.tools)
    return result
  }
```

`listTools` awaits `#initialized` before the capability check, as it does today;
`#listPaged` awaits it again, which is a no-op on a settled promise. The other
three previously relied on `_write` awaiting initialization — the walk loop must
not depend on that, so `#listPaged` awaits it explicitly.

Add the stub that Task 4 fills in:

```ts
  /** @internal Overridden in Task 4 to memoise tool output schemas. */
  _cacheToolOutputSchemas(_tools: ListToolsResult['tools']): void {}
```

- [ ] **Step 6: Export the new symbols**

In `packages/context-client/src/index.ts`, add `ListOptions` to the type exports
and `DEFAULT_LIST_MAX_PAGES` + `ListMaxPagesError` to the value exports, both
alphabetised.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @mokei/context-client exec vitest run test/lib.test.ts -t "list pagination"`
Expected: PASS, 9 tests.

Run: `pnpm --filter @mokei/context-client run test`

Expected: PASS. The four pre-existing single-page tests (`lists available
prompts`, `lists available resources`, `lists available resource templates`,
`listTools succeeds when server declared tools capability`) return one page with
no `nextCursor`, so the walk returns after one request and they stay green
unmodified.

- [ ] **Step 8: Rebuild and lint**

```bash
pnpm --filter @mokei/context-client build
pnpm --filter @mokei/host run test
pnpm exec biome check --write ./packages/context-client
```

`host`'s suite is the check that `setup()` still works against a
non-paginating server.

- [ ] **Step 9: Commit**

```bash
git add packages/context-client
git commit -m "feat(context-client)!: follow nextCursor in list methods

listTools/listPrompts/listResources/listResourceTemplates now walk every
page and return one aggregate. Against a paginating server they previously
returned only the first page, silently truncating ContextHost's tool set.

Passing an explicit cursor still yields a single page. The walk is bounded
by listMaxPages (default 100) and raises ListMaxPagesError, carrying the
partial results, rather than truncating silently."
```

---

### Task 4: Client — tool output schema cache and `structuredContent` validation

When the server advertised an `outputSchema` for a tool, the client can check the
`structuredContent` it gets back. `callTool` is now a plain `async` method
(Task 2), so validation is a straight `await`.

**Files:**
- Modify: `packages/context-client/src/client.ts`
- Modify: `packages/context-client/src/index.ts`
- Test: `packages/context-client/test/lib.test.ts`

**Interfaces:**
- Consumes: `OutputSchema` from Task 1; the `async callTool(params, options?)` from Task 2; the `_cacheToolOutputSchemas` stub from Task 3.
- Produces: `export class StructuredContentValidationError extends Error { toolName: string; issues: Array<ValidationIssue> }` and `export type ValidationIssue = { message: string; path?: ReadonlyArray<PropertyKey> }`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/context-client/test/lib.test.ts`:

```ts
describe('structuredContent validation', () => {
  const countSchema = {
    type: 'object',
    properties: { count: { type: 'number' } },
    required: ['count'],
  } as const

  async function listThenCall(
    toolResult: Record<string, unknown>,
    outputSchema: Record<string, unknown> | undefined = countSchema,
  ): Promise<Promise<CallToolResult>> {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({ transport: transports.client })

    client.initialize()
    await handleServerInitialize(transports.server, {
      ...DEFAULT_INITIALIZE_RESULT,
      capabilities: { tools: {} },
    })

    const listed = client.listTools()
    const listRequest = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (listRequest.value as { id: number }).id,
      result: {
        tools: [
          {
            name: 'counter',
            inputSchema: { type: 'object' },
            ...(outputSchema == null ? {} : { outputSchema }),
          },
        ],
      },
    } as ServerMessage)
    await listed

    const call = client.callTool({ name: 'counter', arguments: {} })
    const callRequest = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (callRequest.value as { id: number }).id,
      result: toolResult,
    } as ServerMessage)
    return call
  }

  test('passes a conforming structuredContent through', async () => {
    const call = await listThenCall({
      content: [{ type: 'text', text: '{"count":3}' }],
      structuredContent: { count: 3 },
    })
    await expect(call).resolves.toEqual({
      content: [{ type: 'text', text: '{"count":3}' }],
      structuredContent: { count: 3 },
    })
  })

  test('rejects a structuredContent that violates the advertised schema', async () => {
    const call = await listThenCall({ content: [], structuredContent: { count: 'three' } })
    await expect(call).rejects.toThrow(StructuredContentValidationError)
    await call.catch((error: unknown) => {
      const validationError = error as StructuredContentValidationError
      expect(validationError.toolName).toBe('counter')
      expect(validationError.issues.length).toBeGreaterThan(0)
    })
  })

  test('does not validate when the tool advertised no outputSchema', async () => {
    const call = await listThenCall({ content: [], structuredContent: { count: 'three' } }, undefined)
    await expect(call).resolves.toEqual({ content: [], structuredContent: { count: 'three' } })
  })

  test('does not validate when listTools was never called', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({ transport: transports.client })
    client.initialize()
    await handleServerInitialize(transports.server, {
      ...DEFAULT_INITIALIZE_RESULT,
      capabilities: { tools: {} },
    })

    const call = client.callTool({ name: 'counter', arguments: {} })
    const request = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (request.value as { id: number }).id,
      result: { content: [], structuredContent: { count: 'three' } },
    } as ServerMessage)

    await expect(call).resolves.toEqual({ content: [], structuredContent: { count: 'three' } })
    await transports.dispose()
  })

  test('tools/list_changed clears the cache so a re-listed tool uses its new schema', async () => {
    const transports = new DirectTransports<ServerMessage, ClientMessage>()
    const client = new ContextClient({ transport: transports.client })
    client.initialize()
    await handleServerInitialize(transports.server, {
      ...DEFAULT_INITIALIZE_RESULT,
      capabilities: { tools: {} },
    })

    const listed = client.listTools()
    const listRequest = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (listRequest.value as { id: number }).id,
      result: {
        tools: [{ name: 'counter', inputSchema: { type: 'object' }, outputSchema: countSchema }],
      },
    } as ServerMessage)
    await listed

    transports.server.write({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    } as ServerMessage)
    // Give the notification a turn to be handled before calling.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const call = client.callTool({ name: 'counter', arguments: {} })
    const callRequest = await transports.server.read()
    transports.server.write({
      jsonrpc: '2.0',
      id: (callRequest.value as { id: number }).id,
      result: { content: [], structuredContent: { count: 'three' } },
    } as ServerMessage)

    // Cache cleared: the bad structuredContent passes because no schema is known.
    await expect(call).resolves.toEqual({ content: [], structuredContent: { count: 'three' } })
    await transports.dispose()
  })
})
```

Add `StructuredContentValidationError` to the import from `../src/index.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @mokei/context-client exec vitest run test/lib.test.ts -t "structuredContent validation"`

Expected: FAIL. `StructuredContentValidationError` is not exported, and the violating-result test resolves rather than rejecting.

- [ ] **Step 3: Add the error class**

In `packages/context-client/src/client.ts`, below `ListMaxPagesError`:

```ts
/** A validation issue, matching the shape `createTool` produces for input errors. */
export type ValidationIssue = {
  message: string
  path?: ReadonlyArray<PropertyKey>
}

/** Thrown when a tool result's structuredContent violates the tool's advertised outputSchema. */
export class StructuredContentValidationError extends Error {
  toolName: string
  issues: Array<ValidationIssue>

  constructor(toolName: string, issues: Array<ValidationIssue>) {
    super(`Invalid structuredContent returned by tool ${toolName}`)
    this.name = 'StructuredContentValidationError'
    this.toolName = toolName
    this.issues = issues
  }
}
```

- [ ] **Step 4: Implement the cache and validate in `callTool`**

Add `inferSchemaDraft` to the existing value import from
`@mokei/context-protocol`, and a new import:

```ts
import { createValidator, type Schema, type Validator } from '@sozai/schema'
```

Add the field:

```ts
  #toolOutputSchemas: Map<string, Validator<unknown>> = new Map()
```

Replace the Task 3 stub:

```ts
  /** @internal Memoises validators for tools that advertise an outputSchema. */
  _cacheToolOutputSchemas(tools: ListToolsResult['tools']): void {
    for (const tool of tools) {
      if (tool.outputSchema == null) {
        this.#toolOutputSchemas.delete(tool.name)
        continue
      }
      const schema = tool.outputSchema as Schema
      this.#toolOutputSchemas.set(
        tool.name,
        createValidator(schema, { draft: inferSchemaDraft(schema), strict: false }),
      )
    }
  }
```

In `_handleNotification`, before the existing log branch:

```ts
    if (notification.method === 'notifications/tools/list_changed') {
      this.#toolOutputSchemas.clear()
    }
```

Rewrite `callTool`:

```ts
  async callTool(params: ToolParams<T>, options?: RequestOptions): Promise<CallToolResult> {
    const result = await this.request(
      'tools/call',
      params as CallToolRequest['params'],
      options,
    )
    const validate = this.#toolOutputSchemas.get(params.name)
    if (validate == null || result.structuredContent == null) {
      return result
    }
    const outcome = validate(result.structuredContent)
    if (outcome.issues != null) {
      throw new StructuredContentValidationError(
        params.name,
        outcome.issues.map((issue) => ({ message: issue.message, path: issue.path })),
      )
    }
    return result
  }
```

- [ ] **Step 5: Export the new symbols**

Add `ValidationIssue` to the type exports and `StructuredContentValidationError`
to the value exports in `packages/context-client/src/index.ts`, alphabetised.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @mokei/context-client exec vitest run test/lib.test.ts -t "structuredContent validation"`
Expected: PASS, 5 tests.

Run: `pnpm --filter @mokei/context-client run test`
Expected: PASS.

- [ ] **Step 7: Rebuild and lint**

```bash
pnpm --filter @mokei/context-client build
pnpm exec biome check --write ./packages/context-client
```

- [ ] **Step 8: Commit**

```bash
git add packages/context-client
git commit -m "feat(context-client): validate structuredContent against advertised outputSchema

listTools memoises each tool's outputSchema; callTool validates the
structuredContent it receives against it, rejecting with
StructuredContentValidationError on mismatch. The cache is cleared on
notifications/tools/list_changed. A tool with no cached schema is not
validated."
```

---

### Task 5: Server — `createTool` / `createPrompt` take a parameters object

Positional arguments leave no room for `outputSchema` without a fourth positional
or an overload. Convert both factories first, as a pure refactor with no
behaviour change, so Task 6's diff is only about `outputSchema`.

**Files:**
- Modify: `packages/context-server/src/definitions.ts:21-75`
- Modify: `packages/context-server/src/index.ts`
- Modify: `packages/context-server/src/types.ts:137,158` (doc comments)
- Modify: `packages/context-server/README.md:18,54`
- Modify: `packages/host/src/local-tools.ts:138` (doc comment)
- Modify (call sites): `packages/context-server/test/lib.test.ts`, `packages/context-server/test/trace.test.ts`, `packages/host/test/local-tools.test.ts`, `packages/host/test/fixtures/echo-server.mjs`, `mcp-servers/sqlite/src/index.ts`, `mcp-servers/fetch/src/config.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–4.
- Produces:
  - `createTool<InputSchema extends Schema>(params: CreateToolParams<InputSchema>): GenericToolDefinition`
  - `createPrompt<ArgumentsSchema extends Schema>(params: CreatePromptParams<ArgumentsSchema>): GenericPromptDefinition`
  - `CreateToolParams` gains an optional `outputSchema` in Task 6; the object shape is what makes that additive.

- [ ] **Step 1: Write the failing test**

Add to `packages/context-server/test/lib.test.ts`, in a new top-level `describe`:

```ts
describe('factory parameters object', () => {
  const valueSchema = {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
    additionalProperties: false,
  } as const

  test('createTool accepts a parameters object', async () => {
    const definition = createTool({
      description: 'adds one',
      inputSchema: valueSchema,
      handler: ({ arguments: { value } }) => ({
        content: [{ type: 'text', text: String(value + 1) }],
      }),
    })

    expect(definition.description).toBe('adds one')
    expect(definition.inputSchema).toMatchObject({ type: 'object' })

    const result = await definition.handler({
      arguments: { value: 1 },
      client: {} as never,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ content: [{ type: 'text', text: '2' }] })
  })

  test('createTool still rejects invalid input', async () => {
    const definition = createTool({
      description: 'adds one',
      inputSchema: valueSchema,
      handler: () => ({ content: [] }),
    })

    await expect(
      definition.handler({
        arguments: { value: 'not a number' },
        client: {} as never,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: INVALID_PARAMS })
  })

  test('createPrompt accepts a parameters object', async () => {
    const definition = createPrompt({
      description: 'greets',
      argumentsSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      } as const,
      handler: ({ arguments: { name } }) => ({
        messages: [{ role: 'assistant', content: { type: 'text', text: `Hello ${name}` } }],
      }),
    })

    const result = await definition.handler({
      arguments: { name: 'World' },
      client: {} as never,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({
      messages: [{ role: 'assistant', content: { type: 'text', text: 'Hello World' } }],
    })
  })

  test('createPrompt without an argumentsSchema skips validation', async () => {
    const definition = createPrompt({
      description: 'no args',
      handler: () => ({ messages: [] }),
    })

    expect(definition.argumentsSchema).toBeUndefined()
    const result = await definition.handler({
      arguments: { anything: true },
      client: {} as never,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ messages: [] })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @mokei/context-server exec vitest run test/lib.test.ts -t "factory parameters object"`

Expected: FAIL. `createTool` receives the object as its `description` argument, so `definition.description` is an object and `createValidator` throws on `undefined` as its schema.

- [ ] **Step 3: Convert the factories**

Replace `createPrompt` and `createTool` in
`packages/context-server/src/definitions.ts`:

```ts
export type CreatePromptParams<ArgumentsSchema extends Schema> = {
  description: string
  argumentsSchema?: ArgumentsSchema
  handler: TypedPromptHandler<FromSchema<ArgumentsSchema>>
}

export function createPrompt<ArgumentsSchema extends Schema>(
  params: CreatePromptParams<ArgumentsSchema>,
): GenericPromptDefinition {
  const { description, argumentsSchema, handler } = params

  if (argumentsSchema == null) {
    const passthrough = (request: HandlerRequest<{ arguments: unknown }>): PromptHandlerReturn => {
      return handler({
        arguments: request.arguments as FromSchema<ArgumentsSchema>,
        client: request.client,
        signal: request.signal,
      })
    }
    return { description, handler: passthrough }
  }

  const validate = createValidator<ArgumentsSchema, FromSchema<ArgumentsSchema>>(argumentsSchema, {
    draft: inferSchemaDraft(argumentsSchema),
    strict: false,
  })

  const wrappedHandler = (request: HandlerRequest<{ arguments: unknown }>): PromptHandlerReturn => {
    const validated = validate(request.arguments)
    if (validated.issues == null) {
      return handler({ arguments: validated.value, client: request.client, signal: request.signal })
    }
    throw new RPCError(INVALID_PARAMS, 'Invalid prompt arguments', {
      issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
    })
  }

  return { description, argumentsSchema, handler: wrappedHandler }
}

export type CreateToolParams<InputSchema extends Schema> = {
  description: string
  inputSchema: InputSchema
  handler: TypedToolHandler<FromSchema<InputSchema>>
}

export function createTool<InputSchema extends Schema>(
  params: CreateToolParams<InputSchema>,
): GenericToolDefinition {
  const { description, inputSchema, handler } = params

  const validate = createValidator<InputSchema, FromSchema<InputSchema>>(inputSchema, {
    draft: inferSchemaDraft(inputSchema),
    strict: false,
  })

  const wrappedHandler = (
    request: HandlerRequest<{ arguments: Record<string, unknown> }>,
  ): ToolHandlerReturn => {
    const validated = validate(request.arguments)
    if (validated.issues == null) {
      return handler({
        arguments: validated.value,
        client: request.client,
        progress: request.progress,
        signal: request.signal,
      })
    }
    throw new RPCError(INVALID_PARAMS, 'Invalid tool input', {
      issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
    })
  }

  return { description, inputSchema: inputSchema as ToolInputSchema, handler: wrappedHandler }
}
```

Export the param types from `packages/context-server/src/index.ts`:

```ts
export {
  createPrompt,
  type CreatePromptParams,
  createTool,
  type CreateToolParams,
} from './definitions.js'
```

`createPrompt`'s `argumentsSchema` is now optional, matching
`GenericPromptDefinition`. When omitted, no validation runs and the handler sees
the raw arguments.

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm --filter @mokei/context-server exec vitest run test/lib.test.ts -t "factory parameters object"`
Expected: PASS, 4 tests.

The rest of the suite is now red — every other call site still uses positional
arguments. Step 5 fixes them.

- [ ] **Step 5: Migrate every call site**

Mechanical: `createTool('desc', schema, handler)` becomes
`createTool({ description: 'desc', inputSchema: schema, handler })`, and
`createPrompt('desc', schema, handler)` becomes
`createPrompt({ description: 'desc', argumentsSchema: schema, handler })`.

Find them all:

```bash
grep -rn "createTool(\|createPrompt(" packages mcp-servers --include=*.ts --include=*.mjs --include=*.md | grep -v "/lib/" | grep -v "src/definitions.ts"
```

Migrate in this order:

1. `packages/context-server/test/lib.test.ts` — ~20 sites
2. `packages/context-server/test/trace.test.ts:121`
3. `packages/host/test/local-tools.test.ts` — ~12 sites
4. `packages/host/test/fixtures/echo-server.mjs`
5. `mcp-servers/sqlite/src/index.ts`
6. `mcp-servers/fetch/src/config.ts`
7. Doc comments: `packages/context-server/src/types.ts:137` and `:158`, `packages/host/src/local-tools.ts:138`
8. `packages/context-server/README.md:18` and `:54`

For example, `packages/host/test/fixtures/echo-server.mjs` becomes:

```js
import { createTool, serveProcess } from '@mokei/context-server'

// Minimal stdio MCP server exposing one `echo` tool. Used by the framing
// happy-path test to prove valid JSONL frames (including large ones) pass the
// framer untouched. `repeat` lets a test request a big-but-bounded result.
const config = {
  name: 'echo',
  version: '0.0.0',
  tools: {
    echo: createTool({
      description: 'Echo the given text back, optionally repeated',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          repeat: { type: 'integer', minimum: 1 },
        },
        required: ['text'],
        additionalProperties: false,
      },
      handler: (req) => {
        const { text, repeat = 1 } = req.arguments
        return { content: [{ type: 'text', text: text.repeat(repeat) }] }
      },
    }),
  },
}

serveProcess(config)
```

Assertions in the migrated tests do not change. A green suite is the regression
signal: these tests already cover input validation, sorting, cache hints, error
codes, and progress, and none of that behaviour moved.

- [ ] **Step 6: Run the server, host, and mcp-server builds**

Rebuild `context-server` first — `host` tests resolve it from `lib/`:

```bash
pnpm --filter @mokei/context-server build
pnpm --filter @mokei/context-server run test
pnpm --filter @mokei/host run test
```

Expected: PASS for both.

Then build the two production consumers. Read their package names from
`mcp-servers/*/package.json` and build each:

```bash
pnpm --filter ./mcp-servers/sqlite build
pnpm --filter ./mcp-servers/fetch build
```

Expected: both compile.

- [ ] **Step 7: Lint**

```bash
pnpm exec biome check --write ./packages/context-server ./packages/host ./mcp-servers
```

- [ ] **Step 8: Commit**

```bash
git add packages/context-server packages/host mcp-servers
git commit -m "refactor(context-server)!: createTool and createPrompt take a parameters object

Positional arguments leave no room for the optional outputSchema landing
next. Behaviour is unchanged; every call site is migrated.

BREAKING: createTool({description, inputSchema, handler}) and
createPrompt({description, argumentsSchema?, handler}) replace the
positional signatures."
```

---

### Task 6: Server — `outputSchema`, output validation, `content` auto-fill

`ContextServer`'s constructor already spreads `{ handler, ...info }` into its
tools list, so an `outputSchema` on the definition is advertised in `tools/list`
with no server changes. All the work is in `createTool`.

**Files:**
- Modify: `packages/context-server/src/definitions.ts`
- Modify: `packages/context-server/src/types.ts:107-127`
- Modify: `packages/context-server/README.md`
- Test: `packages/context-server/test/lib.test.ts`

**Interfaces:**
- Consumes: `OutputSchema` from Task 1 (imported as `ToolOutputSchema`); `CreateToolParams` from Task 5.
- Produces:
  - `CreateToolParams<InputSchema, OutputSchema extends Schema | undefined = undefined>` with `outputSchema?: OutputSchema`
  - `TypedToolHandler<Arguments, Output = unknown>` — second parameter added
  - `StructuredToolHandlerReturn<Output>` exported from `@mokei/context-server`
  - `GenericToolDefinition` gains `outputSchema?: ToolOutputSchema`

- [ ] **Step 1: Write the failing tests**

Add to `packages/context-server/test/lib.test.ts`:

```ts
describe('tool outputSchema', () => {
  const countSchema = {
    type: 'object',
    properties: { count: { type: 'number' } },
    required: ['count'],
  } as const

  function callHandler(definition: GenericToolDefinition, args: Record<string, unknown> = {}) {
    return definition.handler({
      arguments: args,
      client: {} as never,
      signal: new AbortController().signal,
    })
  }

  test('outputSchema is advertised in tools/list', async () => {
    const { transports } = createTestContext({
      tools: {
        counter: createTool({
          description: 'counts',
          inputSchema: { type: 'object' } as const,
          outputSchema: countSchema,
          handler: () => ({ structuredContent: { count: 1 } }),
        }),
      },
    })
    transports.client.write({ jsonrpc: '2.0', id: 1, method: 'tools/list' } as ClientRequest)
    const response = await transports.client.read()
    expect(response.value).toMatchObject({
      id: 1,
      result: { tools: [{ name: 'counter', outputSchema: countSchema }] },
    })
    await transports.dispose()
  })

  test('a conforming structuredContent passes through', async () => {
    const definition = createTool({
      description: 'counts',
      inputSchema: { type: 'object' } as const,
      outputSchema: countSchema,
      handler: () => ({
        content: [{ type: 'text', text: 'three' }],
        structuredContent: { count: 3 },
      }),
    })
    await expect(callHandler(definition)).resolves.toEqual({
      content: [{ type: 'text', text: 'three' }],
      structuredContent: { count: 3 },
    })
  })

  test('a violating structuredContent raises INTERNAL_ERROR with issues', async () => {
    const definition = createTool({
      description: 'counts',
      inputSchema: { type: 'object' } as const,
      outputSchema: countSchema,
      handler: () => ({ structuredContent: { count: 'three' } }) as never,
    })
    await expect(callHandler(definition)).rejects.toMatchObject({
      code: INTERNAL_ERROR,
      message: 'Invalid tool output',
    })
  })

  test('a missing structuredContent against a declared schema raises INTERNAL_ERROR', async () => {
    const definition = createTool({
      description: 'counts',
      inputSchema: { type: 'object' } as const,
      outputSchema: countSchema,
      handler: () => ({ content: [] }) as never,
    })
    await expect(callHandler(definition)).rejects.toMatchObject({ code: INTERNAL_ERROR })
  })

  test('content is auto-filled from structuredContent when omitted', async () => {
    const definition = createTool({
      description: 'counts',
      inputSchema: { type: 'object' } as const,
      outputSchema: countSchema,
      handler: () => ({ structuredContent: { count: 3 } }),
    })
    await expect(callHandler(definition)).resolves.toEqual({
      content: [{ type: 'text', text: '{"count":3}' }],
      structuredContent: { count: 3 },
    })
  })

  test('a handler-supplied content is preserved', async () => {
    const definition = createTool({
      description: 'counts',
      inputSchema: { type: 'object' } as const,
      outputSchema: countSchema,
      handler: () => ({
        content: [{ type: 'text', text: 'three things' }],
        structuredContent: { count: 3 },
      }),
    })
    await expect(callHandler(definition)).resolves.toEqual({
      content: [{ type: 'text', text: 'three things' }],
      structuredContent: { count: 3 },
    })
  })

  test('a tool without an outputSchema is unaffected', async () => {
    const definition = createTool({
      description: 'plain',
      inputSchema: { type: 'object' } as const,
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] }),
    })
    expect(definition.outputSchema).toBeUndefined()
    await expect(callHandler(definition)).resolves.toEqual({
      content: [{ type: 'text', text: 'ok' }],
    })
  })
})
```

Add `INTERNAL_ERROR` to the `@mokei/context-protocol` import and
`GenericToolDefinition` as a type import from `../src/index.js`.

The `as never` casts on the two failure-case handlers are deliberate: Step 3's
typing makes those returns compile errors, and the test must still reach them at
runtime.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @mokei/context-server exec vitest run test/lib.test.ts -t "tool outputSchema"`

Expected: FAIL. `createTool` ignores the unknown `outputSchema` field, so it never reaches `tools/list`, no validation runs, and `content` is never auto-filled.

- [ ] **Step 3: Type the handler's output**

In `packages/context-server/src/types.ts`, add the output schema type to the
`@mokei/context-protocol` type import:

```ts
  InputSchema as ToolInputSchema,
  OutputSchema as ToolOutputSchema,
```

Replace the tool handler and definition types:

```ts
export type ToolHandlerReturn = CallToolResult | Promise<CallToolResult>

/**
 * Return type of a tool handler declared with an `outputSchema`.
 *
 * `structuredContent` is mandatory; `content` is optional because `createTool`
 * fills it with the serialized `structuredContent` when the handler omits it.
 */
export type StructuredToolHandlerReturn<Output> = Omit<CallToolResult, 'content'> & {
  content?: CallToolResult['content']
  structuredContent: Output
}

export type GenericToolHandler = (
  request: HandlerRequest<{ arguments: Record<string, unknown> }>,
) => ToolHandlerReturn

export type TypedToolHandler<Arguments, Output = unknown> = (
  request: HandlerRequest<{ arguments: Arguments }>,
) => [unknown] extends [Output]
  ? ToolHandlerReturn
  : StructuredToolHandlerReturn<Output> | Promise<StructuredToolHandlerReturn<Output>>

export type GenericToolDefinition = {
  description: string
  inputSchema: ToolInputSchema
  outputSchema?: ToolOutputSchema
  handler: GenericToolHandler
}

export type TypedToolDefinition<InputSchema extends Schema & ToolInputSchema> = {
  description: string
  inputSchema: InputSchema
  outputSchema?: ToolOutputSchema
  handler: TypedToolHandler<FromSchema<InputSchema>>
}
```

The conditional keeps a handler with no `outputSchema` typed exactly as it is
today: `Output` defaults to `unknown`, the branch selects `ToolHandlerReturn`,
and nothing changes for existing tools.

The direction matters. `[unknown] extends [Output]` is true only when `Output`
*is* `unknown`. The reverse, `[Output] extends [unknown]`, is true for *every*
type — `unknown` is the top type — so it would select `ToolHandlerReturn` always
and the narrowing would silently never happen. The tuple wrappers stop the
conditional from distributing over unions. This form was verified against the
repo's TypeScript before the plan was written.

`ExtractToolTypes` is untouched — it extracts input types only.

- [ ] **Step 4: Implement validation and auto-fill in `createTool`**

In `packages/context-server/src/definitions.ts`, extend the imports:

```ts
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  type CallToolResult,
  inferSchemaDraft,
  type InputSchema as ToolInputSchema,
  type OutputSchema as ToolOutputSchema,
} from '@mokei/context-protocol'
```

Replace `CreateToolParams` and `createTool`:

```ts
export type CreateToolParams<
  InputSchema extends Schema,
  OutputSchema extends Schema | undefined = undefined,
> = {
  description: string
  inputSchema: InputSchema
  outputSchema?: OutputSchema
  handler: TypedToolHandler<
    FromSchema<InputSchema>,
    OutputSchema extends Schema ? FromSchema<OutputSchema> : unknown
  >
}

export function createTool<
  InputSchema extends Schema,
  OutputSchema extends Schema | undefined = undefined,
>(params: CreateToolParams<InputSchema, OutputSchema>): GenericToolDefinition {
  const { description, inputSchema, outputSchema, handler } = params

  const validateInput = createValidator<InputSchema, FromSchema<InputSchema>>(inputSchema, {
    draft: inferSchemaDraft(inputSchema),
    strict: false,
  })
  const validateOutput =
    outputSchema == null
      ? undefined
      : createValidator(outputSchema as Schema, {
          draft: inferSchemaDraft(outputSchema as Schema),
          strict: false,
        })

  const finalizeResult = (result: CallToolResult): CallToolResult => {
    if (validateOutput == null) {
      return result
    }
    if (result.structuredContent == null) {
      throw new RPCError(INTERNAL_ERROR, 'Invalid tool output', {
        issues: [{ message: 'Tool declares an outputSchema but returned no structuredContent' }],
      })
    }
    const validated = validateOutput(result.structuredContent)
    if (validated.issues != null) {
      throw new RPCError(INTERNAL_ERROR, 'Invalid tool output', {
        issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
      })
    }
    if (result.content == null) {
      return {
        ...result,
        content: [{ type: 'text', text: JSON.stringify(result.structuredContent) }],
      }
    }
    return result
  }

  const wrappedHandler = async (
    request: HandlerRequest<{ arguments: Record<string, unknown> }>,
  ): Promise<CallToolResult> => {
    const validated = validateInput(request.arguments)
    if (validated.issues != null) {
      throw new RPCError(INVALID_PARAMS, 'Invalid tool input', {
        issues: validated.issues.map((issue) => ({ message: issue.message, path: issue.path })),
      })
    }
    const result = await handler({
      arguments: validated.value,
      client: request.client,
      progress: request.progress,
      signal: request.signal,
    })
    return finalizeResult(result as CallToolResult)
  }

  const definition: GenericToolDefinition = {
    description,
    inputSchema: inputSchema as ToolInputSchema,
    handler: wrappedHandler,
  }
  if (outputSchema != null) {
    definition.outputSchema = outputSchema as ToolOutputSchema
  }
  return definition
}
```

Two details worth naming. The wrapper is now `async` — it was sync-or-promise —
because `finalizeResult` must run after the handler settles. And `outputSchema`
is only assigned when present, so `definition.outputSchema` is absent rather than
an explicit `undefined` key, keeping it out of the `tools/list` JSON.

A schema violation is `INTERNAL_ERROR`, not an `isError: true` result: the tool
did not fail, the server author's handler broke its own contract. `isError` is
the channel for a tool telling the model it failed.

Export `StructuredToolHandlerReturn` from `packages/context-server/src/index.ts`
alongside the other types.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @mokei/context-server exec vitest run test/lib.test.ts -t "tool outputSchema"`
Expected: PASS, 7 tests.

Run: `pnpm --filter @mokei/context-server run test`
Expected: PASS. The `async` wrapper changes nothing observable — `#callTool` already awaits the handler.

- [ ] **Step 6: Verify the handler return type actually narrows**

The suite cannot catch this: no test typechecking is configured. Check it
explicitly. Create `packages/context-server/src/__output-check.ts`:

```ts
import { createTool } from './definitions.js'

createTool({
  description: 'counts',
  inputSchema: { type: 'object' } as const,
  outputSchema: {
    type: 'object',
    properties: { count: { type: 'number' } },
    required: ['count'],
  } as const,
  // @ts-expect-error structuredContent is mandatory when an outputSchema is declared
  handler: () => ({ content: [] }),
})

createTool({
  description: 'plain',
  inputSchema: { type: 'object' } as const,
  handler: () => ({ content: [] }),
})
```

Run: `pnpm --filter @mokei/context-server run test:types`

Expected: PASS. The `@ts-expect-error` is consumed by the first call, proving the
narrowing works; the second compiles, proving unschema'd tools are unaffected. If
the narrowing is broken, `tsc` reports `Unused '@ts-expect-error' directive`.

Then: `rm packages/context-server/src/__output-check.ts`

- [ ] **Step 7: Document it in the README**

In `packages/context-server/README.md`, after the existing `createTool` example:

````markdown
### Structured tool output

Declare an `outputSchema` and the tool advertises it in `tools/list`, validates
its own `structuredContent`, and serializes that into a text `content` block for
clients that don't read structured results:

```ts
const tools = {
  count: createTool({
    description: 'Count the matching rows',
    inputSchema: { type: 'object', properties: { table: { type: 'string' } } } as const,
    outputSchema: {
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
    } as const,
    handler: ({ arguments: { table } }) => ({ structuredContent: { count: rowsIn(table) } }),
  }),
}
```

A handler that returns `structuredContent` violating its `outputSchema` — or
omits it entirely — raises an `INTERNAL_ERROR` back to the client.
````

- [ ] **Step 8: Rebuild and lint**

```bash
pnpm --filter @mokei/context-server build
pnpm exec biome check --write ./packages/context-server
```

- [ ] **Step 9: Commit**

```bash
git add packages/context-server
git commit -m "feat(context-server): tool outputSchema with validated structuredContent

createTool accepts an optional outputSchema. The server advertises it in
tools/list, validates the handler's structuredContent against it, and fills
content with the serialized JSON when the handler omits it. A violation
raises INTERNAL_ERROR."
```

---

### Task 7: End-to-end — host over stdio

Unit tests prove the client walks and the server validates. Neither proves the
original bug is fixed where it lived: `ContextHost.setup()` against a real
spawned server. `ContextServer` never paginates, so the pagination fixture is a
hand-written raw JSON-RPC server.

**Files:**
- Create: `packages/host/test/fixtures/paginating-server.mjs`
- Create: `packages/host/test/fixtures/structured-server.mjs`
- Create: `packages/host/test/feature-gaps.test.ts`

**Interfaces:**
- Consumes: the walk from Task 3, the client validation from Task 4, `createTool`'s object form from Task 5, `outputSchema` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Write the paginating fixture server**

Create `packages/host/test/fixtures/paginating-server.mjs`:

```js
// A raw stdio MCP server that paginates `tools/list` across three pages.
// ContextServer never paginates, so the client's cursor walk cannot be
// exercised end to end against it. Hand-rolled on purpose.

function tool(name) {
  return { name, description: name, inputSchema: { type: 'object' } }
}

const PAGES = {
  __first: { tools: [tool('alpha')], nextCursor: 'page-2' },
  'page-2': { tools: [tool('beta')], nextCursor: 'page-3' },
  'page-3': { tools: [tool('gamma')] },
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handle(message) {
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        capabilities: { tools: { listChanged: false } },
        protocolVersion: message.params.protocolVersion,
        serverInfo: { name: 'paginating', version: '0.0.0' },
      },
    })
    return
  }
  if (message.method === 'tools/list') {
    const cursor = message.params?.cursor
    send({ jsonrpc: '2.0', id: message.id, result: PAGES[cursor ?? '__first'] })
    return
  }
  if (message.id != null) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unsupported method: ${message.method}` },
    })
  }
}

let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString()
  let index = buffer.indexOf('\n')
  while (index !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim() !== '') {
      handle(JSON.parse(line))
    }
    index = buffer.indexOf('\n')
  }
})
```

The `initialize` reply echoes the client's `protocolVersion`; returning a
hard-coded one risks `UnsupportedProtocolVersionError` when the constant moves.
It declares the `tools` capability, without which `listTools` throws
`CapabilityNotDeclaredError`.

- [ ] **Step 2: Write the structured fixture server**

Create `packages/host/test/fixtures/structured-server.mjs`:

```js
import { createTool, serveProcess } from '@mokei/context-server'

// Stdio MCP server with one tool that declares an outputSchema, so the host
// exercises the client's structuredContent validation end to end.
const config = {
  name: 'structured',
  version: '0.0.0',
  tools: {
    count: createTool({
      description: 'Count the characters in the given text',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { count: { type: 'number' } },
        required: ['count'],
      },
      handler: (req) => ({ structuredContent: { count: req.arguments.text.length } }),
    }),
  },
}

serveProcess(config)
```

- [ ] **Step 3: Write the end-to-end test**

Create `packages/host/test/feature-gaps.test.ts`. The `addLocalContext` shape is
copied from `packages/host/test/framing.test.ts:74-78`.

```ts
import { describe, expect, test } from 'vitest'

import { ContextHost } from '../src/index.js'

function fixture(name: string): string {
  return new URL(`./fixtures/${name}`, import.meta.url).pathname
}

describe('MCP feature gaps, end to end', () => {
  test('host.setup aggregates every page from a paginating server', async () => {
    const host = new ContextHost()
    await host.addLocalContext({
      key: 'paged',
      command: process.execPath,
      args: [fixture('paginating-server.mjs')],
    })

    const tools = await host.setup('paged')
    expect(tools.map((contextTool) => contextTool.tool.name)).toEqual(['alpha', 'beta', 'gamma'])

    await host.dispose()
  })

  test('a structured tool result survives spawn, setup, and callTool', async () => {
    const host = new ContextHost()
    await host.addLocalContext({
      key: 'structured',
      command: process.execPath,
      args: [fixture('structured-server.mjs')],
    })
    await host.setup('structured')

    const result = await host.callTool('structured', {
      name: 'count',
      arguments: { text: 'hello' },
    })

    expect(result.structuredContent).toEqual({ count: 5 })
    expect(result.content).toEqual([{ type: 'text', text: '{"count":5}' }])

    await host.dispose()
  })
})
```

- [ ] **Step 4: Run the test to verify it passes**

Rebuild the dependency chain first — `host` tests resolve `@mokei/context-client`
and `@mokei/context-server` from their `lib/`:

```bash
pnpm --filter @mokei/context-protocol build
pnpm --filter @mokei/context-rpc build
pnpm --filter @mokei/context-client build
pnpm --filter @mokei/context-server build
pnpm --filter @mokei/host exec vitest run test/feature-gaps.test.ts
```

Expected: PASS, 2 tests. If the pagination test sees only `['alpha']`, the built
`lib/` is stale — rebuild `context-client` and rerun.

To confirm the test would have caught the original bug, temporarily edit
`packages/context-client/src/client.ts` so `#listPaged` returns after its first
page, rebuild, rerun, and watch the first test fail with `['alpha']`. Revert.

- [ ] **Step 5: Run the full workspace suite**

```bash
pnpm build
pnpm test
```

Expected: PASS. This is the first point where every package is built and tested
together against the new signatures.

- [ ] **Step 6: Lint everything**

```bash
rtk proxy pnpm run lint
```

Expected: no diagnostics. If `rtk` is unavailable:
`pnpm exec biome check --write ./integration-tests ./mcp-servers ./monitor ./packages ./website`

- [ ] **Step 7: Commit**

```bash
git add packages/host
git commit -m "test(host): end-to-end coverage for pagination and structured output

A raw stdio fixture paginates tools/list across three pages, proving
ContextHost.setup() aggregates rather than truncating. A ContextServer
fixture with an outputSchema proves structuredContent survives the round
trip and is validated client-side."
```

---

### Task 8: Documentation and stage transition

**Files:**
- Delete: `docs/agents/plans/backlog/2026-07-02-mcp-feature-gaps.md`
- Modify: `docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md`
- Modify: `docs/agents/plans/roadmap.md`
- Modify: `docs/superpowers/plans/2026-07-09-mcp-feature-gaps.md` (this file)

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Retire the backlog item**

Gaps 1 and 2 shipped; gap 3 did not. Delete
`docs/agents/plans/backlog/2026-07-02-mcp-feature-gaps.md` and fold its surviving
content — the `resources/subscribe` section, minus its now-fixed typo note — into
the B4 entry of `docs/agents/plans/backlog/2026-06-20-mcp-draft-remaining.md`.

- [ ] **Step 2: Update the roadmap**

In `docs/agents/plans/roadmap.md`, remove the "MCP 2025-11-25 feature gaps"
bullet from `## Near-term (backlog/)` and add one to the shipped list above it,
matching the surrounding style:

```markdown
- **MCP 2025-11-25 feature gaps** (`completed/2026-07-09-mcp-feature-gaps.complete.md`)
  — shipped on `feat/mcp-feature-gaps`: client-side cursor walk in all four list
  methods (fixes silent first-page truncation of `ContextHost`'s tool set), tool
  `outputSchema` + validated `structuredContent` on both sides, `SentRequest`
  replaced by `AbortSignal` injection across the request path, and the
  `UnsubscribeRequest` alias typo. **BREAKING:** `SentRequest`/`requestValue` removed
  and every request method takes an optional `signal`; `createTool`/`createPrompt`
  take a parameters object. `resources/subscribe` (gap 3) deferred into B4.
```

The `completed/` document itself is written by `/complete` during the completing
stage — do not write it here.

- [ ] **Step 3: Update the plan stage**

Change `**Stage:** planning` at the top of this file to `**Stage:** reviewing`.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: retire the MCP feature-gaps backlog item"
```

- [ ] **Step 5: Hand back to the dev loop**

All tasks are checked. The dev loop moves to the `reviewing` stage:
`superpowers:requesting-code-review`.

---

## Verification Summary

| Spec requirement | Task |
|---|---|
| `UnsubscribeRequest` typo | 1 |
| `OutputSchema` exported | 1 |
| `SentRequest` and `requestValue` deleted | 2 |
| `request()` takes `options.signal`, returns `Promise` | 2 |
| Abort listener detached on settle | 2 |
| Pre-aborted signal rejects and writes nothing | 2 |
| `callLocalTool` cast removed, signal forwarded to `execute` | 2 |
| `Session.executeToolCall` collapses to a passthrough | 2 |
| `#listPaged` walk, four wrappers | 3 |
| `cursor` in params opts out of the walk | 3 |
| `listMaxPages` default 100, per-call `maxPages` | 3 |
| `ListMaxPagesError` with partial results | 3 |
| `signal` / per-page `timeout` on list methods | 3 |
| All four list methods await `#initialized` | 3 |
| Schema cache populated by `listTools` | 4 |
| Cache cleared on `tools/list_changed` | 4 |
| `StructuredContentValidationError` | 4 |
| `createTool` / `createPrompt` parameters object | 5 |
| `outputSchema` advertised in `tools/list` | 6 |
| Handler output validated, `INTERNAL_ERROR` on violation | 6 |
| `content` auto-filled when omitted, preserved when supplied | 6 |
| `structuredContent` mandatory when `outputSchema` declared (type-level) | 6 |
| End-to-end pagination + structured output | 7 |
| READMEs and doc comments updated | 5, 6 |
| Backlog and roadmap updated | 8 |
