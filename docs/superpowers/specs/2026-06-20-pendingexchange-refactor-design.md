# Design: `PendingExchange` correlation refactor (`@mokei/context-rpc`)

**Date:** 2026-06-20
**Status:** design — approved, pending spec review
**Relates to:** `docs/agents/plans/milestones/2026-06-20-u1-correlation-coexist-spike.md` (ADR)

## Goal

Generalize `@mokei/context-rpc`'s single-deferred request correlation into an abstraction
that supports both **resolve-once** (today's request/response) and **streaming** exchanges
(a request answered by interleaved frames), plus a **continuation-token store** for input
sub-requests correlated independently of the outer request id.

This lays the full correlation seam the future MCP-draft tool-call path (MRTR, SEP-2322)
plugs into. It is **behavior-preserving on the current `2025-11-25` protocol**: the
streaming arm + continuation store are built and unit-tested with synthetic frames, but no
wire path produces streaming frames yet, so existing behavior is unchanged.

## Non-goals

- No public API change. `request()`, `requestValue()`, `SentRequest`, `notify()`, and all
  `index.ts` exports stay identical.
- No streaming public entry point. The streaming arm is package-internal and test-only; the
  public streaming API is deferred to the draft-wiring spec.
- No version selector / draft method names / draft frame schemas. Token type is an opaque
  `string`, not draft-bound.
- No change to `@enkaku/transport`.

## Architecture

Two new focused units beside the existing orchestrator, so each is understandable and
testable in isolation:

```
packages/context-rpc/src/
  rpc.ts          # ContextRPC orchestrator — delegates correlation to the registry
  exchange.ts     # NEW — PendingExchange types + ExchangeRegistry
  continuation.ts # NEW — ContinuationStore
  error.ts        # unchanged
  index.ts        # public exports UNCHANGED (registry/store not exported)
```

`ExchangeRegistry` and `ContinuationStore` are zero-dependency (no constructor params).
`ContextRPC` owns one of each and wires them; the registry stays decoupled from the store —
the `onInputRequest` callback supplied at `registerStream` is what performs continuation
registration, so neither unit imports the other.

### `exchange.ts`

```ts
type OnceExchange = {
  kind: 'once'
  controller: Deferred<unknown> & AbortController
}

type StreamExchange = {
  kind: 'stream'
  controller: Deferred<unknown> & AbortController
  onProgress?: (value: unknown) => void
  onInputRequest?: (token: string, value: unknown) => void
}

type PendingExchange = OnceExchange | StreamExchange

type StreamFrame =
  | { type: 'progress'; value: unknown }
  | { type: 'input-request'; token: string; value: unknown }
  | { type: 'result'; value: unknown } // terminal
  | { type: 'error'; error: Error } // terminal

class ExchangeRegistry {
  registerOnce(id: RequestID, controller: Deferred<unknown> & AbortController): void
  registerStream(
    id: RequestID,
    controller: Deferred<unknown> & AbortController,
    handlers?: { onProgress?: ...; onInputRequest?: ... },
  ): void
  has(id: RequestID): boolean
  // Inbound JSON-RPC Response (method == null): settle a `once`, or terminate a `stream`.
  routeResponse(id: RequestID, response: Response): void
  // Inbound streaming frame for a `stream` exchange (no wire trigger yet; test-driven).
  routeStreamFrame(id: RequestID, frame: StreamFrame): void
  cancel(id: RequestID, reason: Error): void
  endAll(reason: Error): void
}
```

Routing semantics:

- `routeResponse` on a `once` exchange replicates today's logic exactly: `result` →
  `controller.resolve(result)`; `error` → `controller.reject(RPCError.fromResponse(...))`;
  delete the entry. Unknown id → no-op (as today).
- `routeResponse` on a `stream` exchange treats the Response as the terminal frame.
- `routeStreamFrame`: `progress` → `onProgress?.(value)`; `input-request` →
  `onInputRequest?.(token, value)`; `result` → resolve outer + delete; `error` → reject
  outer + delete. A terminal frame deletes the exchange.
- `cancel` / `endAll` reject the outer controller(s) and clear, mirroring
  `#endPendingRequests` today.

### `continuation.ts`

```ts
type ContinuationEntry = {
  exchangeID: RequestID
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

class ContinuationStore {
  register(token: string, entry: ContinuationEntry): void
  route(token: string, result: { value: unknown } | { error: Error }): void // settle + delete
  clearForExchange(exchangeID: RequestID): void // teardown when the outer exchange settles/aborts
  clearAll(reason: Error): void
}
```

The store correlates input sub-requests by opaque token, independent of the outer request
id's slot. `clearForExchange` is called when an outer streaming exchange settles or aborts,
so no continuation outlives its parent.

## ContextRPC integration

- `#sentRequests` is removed; `#exchanges: ExchangeRegistry` and
  `#continuations: ContinuationStore` are added.
- `request()`: registers a `once` exchange via `#exchanges.registerOnce(id, controller)`.
  The abort listener, optional timeout, and write-failure rejection are unchanged in logic;
  they route state changes through the registry (`#exchanges.has(id)`,
  `#exchanges.cancel(id, reason)`) instead of mutating `#sentRequests` directly. The
  `notifications/cancelled` emission on abort/timeout is unchanged.
- `_handleMessage` response branch (`method == null`) calls
  `#exchanges.routeResponse(id, response)`.
- `#endPendingRequests(reason)` calls `#exchanges.endAll(reason)` and
  `#continuations.clearAll(reason)`.
- A new `_`-prefixed internal method (e.g. `_registerStreamExchange`) exposes the streaming
  seam for tests, following the existing `_read` / `_write` / `_handleMessage` internal
  convention. It is not exported from `index.ts`.

All `once`-path wire output is identical to today, so the existing suite is the
behavior-preservation gate.

## Conventions

`type` not `interface`; `Array<T>`; no `any` (`unknown` / specific types); ES `#` private
fields (no `private` / `readonly`); single-object `…Params` constructor types where a
constructor takes arguments; capital `ID`. No plan/task labels in code, comments, or
`describe`/`test` names — reference the durable concept (MRTR, SEP-2322) instead.

## Testing

1. **Behavior-preservation gate.** The existing `context-rpc`, `context-client`,
   `context-server`, and `host` suites must stay 100% green after the refactor (the `once`
   arm is a 1:1 move).
2. **`exchange.test.ts`** (unit):
   - once: resolve on result, reject on error, cancel rejects + clears, `endAll` rejects all,
     unknown id is a no-op.
   - stream: `progress` invokes `onProgress`; `input-request` invokes `onInputRequest`;
     `result` resolves the outer promise and deletes; `error` rejects and deletes; a terminal
     frame after settle is a no-op.
3. **`continuation.test.ts`** (unit): register/route resolve + reject, `route` deletes,
   `clearForExchange` removes only that exchange's tokens, `clearAll` rejects + clears.
4. **Characterization tests** for any thin `once` edges not already covered before
   refactoring: cancel emits `notifications/cancelled`, timeout rejects with
   `RequestTimeoutError`, transport close rejects pending with `TransportClosedError`.

TDD: write/confirm characterization tests first (lock current behavior), then refactor to
keep them green, then add the new-unit tests for the streaming + continuation arms.

## Risks

- **Hidden behavioral drift in the `once` move.** Mitigated by the characterization tests +
  the full existing suite as the gate.
- **Speculative streaming shape.** The `StreamFrame` union and continuation token are mokei
  internal abstractions, not draft wire types; if the draft reshapes MRTR, only the
  (internal, test-only) frame adapter changes, not the registry contract.
- **`rpc.ts` churn.** Delegation keeps `rpc.ts` from growing; the net line count should drop
  as correlation logic moves into the two units.

## Rollout

Single behavior-preserving change on `2025-11-25`, own branch, full suite green before
merge. No consumer migration. Unblocks the draft tool-call wiring (MRTR/SEP-2322) once the
spec finalizes.
