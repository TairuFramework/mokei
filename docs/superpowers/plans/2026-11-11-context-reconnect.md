# Opt-in Context Reconnect Implementation Plan

**Stage:** executing
**Mode:** tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A context added with `reconnect` comes back on its own after a loss (stdio exit, HTTP network failure or session expiry, idle stream failure), keeping its tools listed and gating calls meanwhile, and fails cleanly when it cannot.

**Architecture:** `ContextHost` keeps, per opted-in registration, a `ReconnectController` (state, generation, factory, gate, backoff loop). Loss signals come from typed sources: the client `closed` event, stdio callbacks, and `HTTPTransport` `connection` events backed by a symbol-branded failure on error frames. Reconnect attempts run non-interactive so OAuth never opens a sign-in.

**Tech Stack:** TypeScript, vitest, `@sozai/async` (`getRetryDelay`), existing `ContextClient` / `HTTPTransport` / `createOAuthMiddleware`.

**Spec:** `docs/superpowers/specs/2026-11-11-context-reconnect-design.md`

## Global Constraints

- `reconnect?: boolean | ReconnectOptions`; `true` = defaults. Defaults: `maxAttempts` 5, `initialDelayMs` 250, `maxDelayMs` 5 000 (doubling, full jitter), `gateTimeoutMs` 10 000.
- Off by default; off keeps today's behaviour except HTTP and direct contexts now emit `context:added`.
- Controller arms only when `setup()` commits tools on a still-current registration.
- Every async step re-checks ownership (registration current, captured client current, generation unchanged) after each await; a step that lost ownership disposes what it built and publishes nothing.
- Never classify loss from message text or string-keyed `data`; only the `TRANSPORT_FAILURE` symbol brand, `TransportClosedError`, and transport/stdio events.
- Reconnect attempts, restoration requests and lost-generation teardown are non-interactive: no `handler.authorize`, no scope step-up.
- Terminal ending: `context:failed` once, then `context:removed` once.
- No new package. Packages touched: `@mokei/context-client`, `@mokei/http-client`, `@mokei/host`, `@mokei/host-node`, `@mokei/session`, `@mokei/session-node`, `@mokei/cli`. Patch changeset.
- Conventions: `kigu:conventions`; lint `rtk proxy pnpm run lint`; rebuild a package (`rtk proxy pnpm run build` in it) before testing its dependants.
- Ruling (planning): the failure brand (`TRANSPORT_FAILURE`, `transportFailureOf`) lives in `@mokei/context-client` (its subscription driver must read it, and http-client depends on context-client); `@mokei/http-client` re-exports both. The spec names http-client as the exporter; both hold.

## Review Focus

- A key removed and re-added while a reconnect attempt is mid-`listTools`: the old attempt must not swap into, or remove, the new registration (Task 4 test `a late attempt never touches a re-added key`).
- An HTTP server answering a call with a JSON-RPC error whose `data` imitates a transport marker: no reconnect, no auth ending (Task 2 test `server-sent data never reads as a transport failure`).
- A caller abort arriving at the same moment the gate opens: the call rejects with the abort reason and is not dispatched (Task 5 test `abort wins over a gate opening`).
- An OAuth `403 insufficient_scope` during subscription restoration: the URI is dropped with `resource:subscription-lost`, no sign-in (Task 7 test `restoration never steps up`).
- A stdio server that keeps dying immediately after respawn: exactly `maxAttempts` spawns, then `context:failed` then `context:removed` (Task 8 test `a server that keeps dying fails after maxAttempts`).

---

### Task 1: context-client failure brand, task interruption, retryable network listen errors

**Files:**
- Create: `packages/context-client/src/transport-failure.ts`
- Modify: `packages/context-client/src/errors.ts` (`TaskInterruptedError`), `packages/context-client/src/client.ts` (`callTool` task wait ~1964-2000), `packages/context-client/src/subscriptions.ts` (retryable decision ~479), `packages/context-client/src/index.ts`
- Test: `packages/context-client/test/transport-failure.test.ts` (new), additions to `test/subscriptions.test.ts` and `test/lib.test.ts` (task case)

**Interfaces:**
- Produces:
  - `export const TRANSPORT_FAILURE: unique symbol`
  - `export type TransportFailureKind = 'network' | 'timeout' | 'auth-required' | 'http' | 'session-expired'`
  - `export type TransportFailure = { kind: TransportFailureKind; status?: number }`
  - `export function brandTransportFailure<T extends Record<PropertyKey, unknown>>(data: T, failure: TransportFailure): T` (sets the symbol key, returns `data`)
  - `export function transportFailureOf(error: unknown): TransportFailure | undefined` (reads `(error as RPCError).data?.[TRANSPORT_FAILURE]` when `data` is an object; also unwraps `cause` one level)
  - `export class TaskInterruptedError extends Error` with getters `taskID: string`, and `cause` = the transport error; name `'TaskInterruptedError'`.

- [ ] **Step 1: Failing tests**
  - `transportFailureOf reads a branded RPCError` — `new RPCError({ code: -32603, message: 'x', data: brandTransportFailure({}, { kind: 'network' }) })` → `{ kind: 'network' }`.
  - `server-shaped data is not a failure` — `data: { 'dev.mokei/transport': { kind: 'network' }, kind: 'network' }` → `undefined`; `JSON.parse(JSON.stringify(branded))` → `undefined`.
  - `a loss after the server returned a task rejects with TaskInterruptedError` — scripted server answers `tools/call` with a task result, then the client transport closes: rejection `instanceof TaskInterruptedError`, `taskID` equals the task's id, `cause` is a `TransportClosedError`.
  - `a branded network error on listen is retried` — driver whose `listen` request fails with a branded `network` error frame reopens (emits `subscriptionRetry`) instead of stopping; an unbranded `-32603` still stops as today.
- [ ] **Step 2:** `cd packages/context-client && pnpm exec vitest run test/transport-failure.test.ts test/subscriptions.test.ts test/lib.test.ts` → the new cases FAIL.
- [ ] **Step 3: Implement** as in Interfaces; the driver treats `transportFailureOf(error)?.kind === 'network'` as retryable.
- [ ] **Step 4:** same command PASS; full `pnpm exec vitest run` and `rtk proxy pnpm run test:types` in the package; build it.
- [ ] **Step 5: Commit** `feat(context-client): typed transport failures and interrupted tasks`.

### Task 2: http-client loss classification and `connection` events

**Files:**
- Modify: `packages/http-client/src/transport.ts` (base fetch ~465, POST catch ~689-702, error-response path ~711-760, GET loop ~935-990, params, events), `packages/http-client/src/errors.ts` (`NetworkError`), `packages/http-client/src/index.ts`
- Test: `packages/http-client/test/loss-detection.test.ts` (new)

**Interfaces:**
- Consumes: Task 1 `brandTransportFailure`, `TRANSPORT_FAILURE`, `transportFailureOf` (re-export both from `@mokei/http-client`).
- Produces:
  - `export class NetworkError extends Error` (getter `url: string`, `cause` kept), name `'NetworkError'`.
  - `HTTPTransport.connectionEvents: EventEmitter<{ connection: { type: 'failed'; error: NetworkError } | { type: 'session-expired' } }>` (same `EventEmitter` from `@sozai/event` the transport already uses for `streamEvents`).
  - Every locally failed request's error frame `data` is branded: fetch threw at the raw boundary on the MCP URL → `network`; `RequestTimeoutError` → `timeout`; `AuthRequiredError` (Task 3) → `auth-required`; non-ok response not carried as JSON-RPC → `http` with `status`; session `404` → `session-expired`. JSON-RPC errors the server sent are never branded.

- [ ] **Step 1: Failing tests** (runtime fetch stubbed via `createRuntime({ fetch })`):
  - `a network failure on the MCP URL brands the frame and emits failed` — fetch rejects `TypeError('fetch failed')`: frame `transportFailureOf` → `{ kind: 'network' }`; one `connection` `{ type: 'failed' }`.
  - `an OAuth subrequest failure is not loss` — middleware whose own `next('https://as.example/token')` rejects: no `connection` event; frame not branded `network`.
  - `a middleware throw is not loss` — middleware throws `Error('store broken')`: no `connection` event.
  - `caller abort, timeout and dispose are not loss` — three cases: abort signal, `timeout: 20` with a hanging fetch (brand `timeout`), `dispose()` mid-request: no `connection` event.
  - `5xx is http, not loss` — 503 response: brand `{ kind: 'http', status: 503 }`, no event.
  - `session 404 brands session-expired and emits` — after a session id is set, POST 404: brand `session-expired`, one `connection` `{ type: 'session-expired' }`.
  - `server-sent data never reads as a transport failure` — HTTP 400 with a JSON-RPC error whose `data` is `{ "dev.mokei/transport": { "kind": "network" } }`: `transportFailureOf` → `undefined`, no event.
  - `listen reports after two consecutive network failures` — two `subscriptions/listen` POSTs reject at the network: no event after the first, one after the second; a success between them resets the count. Any other method reports on the first.
  - `GET stream reports after two consecutive network failures` — GET re-open rejects twice: one `failed` event; GET `404` without a session: no event.
- [ ] **Step 2:** `cd packages/http-client && pnpm exec vitest run test/loss-detection.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Raw-fetch wrapper (innermost, under `withCredentialRedirectGuard`) rethrows a rejection as `NetworkError` only when `url === this.#url` (string compare after `new URL().href`), the init signal is not aborted, and the transport is not disposed. Consecutive-failure counters for `subscriptions/listen` and the GET stream, reset on any response.
- [ ] **Step 4:** PASS; full http-client suite, types; build.
- [ ] **Step 5: Commit** `feat(http-client): classify connection loss and emit connection events`.

### Task 3: Non-interactive interaction mode and OAuth policy

**Files:**
- Create: `packages/http-client/src/interaction.ts`
- Modify: `packages/http-client/src/transport.ts` (stamp mode on every request incl. `DELETE`), `packages/http-client/src/oauth/middleware.ts` (401 path ~495, step-up ~529, joined flights), `packages/http-client/src/errors.ts` (`AuthRequiredError`), `packages/http-client/src/index.ts`
- Test: `packages/http-client/test/oauth-non-interactive.test.ts` (new)

**Interfaces:**
- Produces:
  - `export const REQUEST_INTERACTION: unique symbol` (internal `RequestInit` tag, value `'never' | 'allowed'`), `export function interactionOf(init?: RequestInit): 'never' | 'allowed'` (default `'allowed'`).
  - `HTTPTransportParams.interactive?: boolean` (default `true`) and `HTTPTransport.setInteractive(value: boolean): void`. Each request is stamped with the mode current at send time.
  - Background requests are always stamped `'never'`, whatever the mode: the GET stream and `subscriptions/listen` (the wire request behind `subscribeResource` and its restoration). A background stream never opens a sign-in. (Ruling, planning: this replaces a per-request scope API for restoration; if `subscribeResource` sends another method on the wire, add it to the background set.)
  - `export class AuthRequiredError extends Error`, name `'AuthRequiredError'`.
- Middleware rules under `'never'`: attach and refresh stored tokens as today; may join an in-flight authorisation flight; on a `401` that needs authorisation throw `AuthRequiredError` before entering `serialiseAuthorize`; on `403 insufficient_scope` return the response unchanged (no step-up).

- [ ] **Step 1: Failing tests:**
  - `non-interactive 401 throws AuthRequiredError without calling the handler` — handler spy never called; through a transport with `interactive: false` the frame is branded `auth-required`.
  - `non-interactive still refreshes` — stored expiring token with refresh token: refresh happens, request succeeds.
  - `non-interactive 403 insufficient_scope is returned as-is` — handler not called; frame branded `{ kind: 'http', status: 403 }`.
  - `non-interactive may join an in-flight sign-in` — interactive request A starts a sign-in; non-interactive B on the same key resolves with A's token, handler called once.
  - `dispose DELETE of a non-interactive transport never authorises` — `setInteractive(false)`, `dispose()`, server answers DELETE 401: handler not called.
  - `listen is never interactive` — interactive transport, `subscriptions/listen` gets a 401 needing sign-in: handler not called, frame branded `auth-required`.
  - `setInteractive(true) restores sign-in` — after the switch, a 401 calls the handler.
- [ ] **Step 2:** `pnpm exec vitest run test/oauth-non-interactive.test.ts` → FAIL.
- [ ] **Step 3: Implement** as above; the transport brands an `AuthRequiredError` rejection `auth-required` (Task 2's mapping).
- [ ] **Step 4:** PASS; full suite, types; build.
- [ ] **Step 5: Commit** `feat(http-client): non-interactive requests never open a sign-in`.

### Task 4: Host reconnect controller (direct contexts)

**Files:**
- Create: `packages/host/src/reconnect.ts`, `packages/host/src/errors.ts`
- Modify: `packages/host/src/host.ts` (`HostedContext`, `createHostedContext`, `addDirectContext` ~591, `setup` ~854, `#refreshContextTools` ~830, `#onListChanged` ~803, `remove` ~878, closed handler ~769, `#wireContextSubscriptions` ~695, events ~223, `ContextHostParams`), `packages/host/src/index.ts`
- Test: `packages/host/test/reconnect.test.ts` (new)

**Interfaces:**
- Produces:
  - `export type ReconnectOptions = { maxAttempts?: number; initialDelayMs?: number; maxDelayMs?: number; gateTimeoutMs?: number }`
  - `export type ContextConnectivity = { isOnline(): boolean | Promise<boolean>; subscribe?(listener: (online: boolean) => void): () => void }`; `ContextHostParams.connectivity?: ContextConnectivity`.
  - `reconnect?: boolean | ReconnectOptions` on `DirectContextParams` and `HTTPContextParams`.
  - Events: `'context:reconnecting': { key: string; attempt: number; error: Error }`, `'context:reconnected': { key: string; attempts: number }`, `'resource:subscription-lost': { key: string; uri: string; error: Error }` (emitted by Task 7).
  - Errors in `packages/host/src/errors.ts`: `ContextUnavailableError` (getter `key`, `cause`), `ReconnectExhaustedError` (getters `key`, `attempts`, `cause` = last error).
  - `type HostedContextParts = { client: ContextClient; disposer: Disposer; transport?: HTTPTransport }`; `type ContextFactory = () => Promise<HostedContextParts>`.
  - `class ReconnectController` in `reconnect.ts`: `state: 'connected' | 'reconnecting'`, `generation: number`, `armed: boolean`, `arm(): void`, `lose(generation: number, error: Error): void`, `waitForGate(params: { signal?: AbortSignal; deadline: number }): Promise<void>`, `abort(reason: Error): void`. Constructed with `{ key, options, factory, connectivity, host hooks: { commit(parts, tools, generation), fail(error), emit } }`.
  - Protected on `ContextHost` for Task 8: `registerHostedContext(key, context, params?: { reconnect?: { options: ReconnectOptions; factory: ContextFactory } })` and `protected reportLoss(key: string, client: ContextClient, error: Error): void`.
- Behaviour (spec sections "Ownership and generations", "When reconnect applies", "On loss", "Reconnect loop", "Swap commit", "Events", "Tracing"): loop uses `getRetryDelay` from `@sozai/async` with `{ maxAttempts, backoff: { initialMs, multiplier: 2, maxMs, jitter: true } }`; `addDirectContext`'s factory rebuilds `DirectTransports` + `ContextServer` from the same `config`; `addHTTPContext` and `addDirectContext` emit `context:added`.

- [ ] **Step 1: Failing tests** (direct contexts; loss simulated by disposing the server side of the current generation via a test helper reading `host.getContext(key)`; fake timers for backoff):
  - `reconnect off keeps today's removal` — no `reconnect`: loss → `context:removed`, no `context:reconnecting`.
  - `a loss before setup is not reconnected` — `reconnect: true`, loss before `setup()`: removed as today.
  - `reconnects and keeps enabled and allow by name` — tool `b` disabled before loss; after `context:reconnected { attempts: 1 }`, `b` still disabled, `getContext(key).client` is a new client, a new tool `c` is enabled, removed tool `a2` gone, `tools:changed` emitted once.
  - `events are ordered` — `context:reconnecting { attempt: 1 }` before `context:reconnected`.
  - `exhausted attempts fail then remove` — factory always throws: exactly 5 attempts, then `context:failed` (error `instanceof ReconnectExhaustedError`, `attempts` 5, cause = last factory error) then `context:removed`.
  - `the lost client is disposed at once` — after loss, before any attempt resolves, the old server transport is closed.
  - `remove during reconnect stops the loop` — `remove(key)` mid-backoff: no further factory calls, no `context:failed`.
  - `a late attempt never touches a re-added key` — attempt's `listTools` blocked; `remove(key)` then `addDirectContext` same key; unblock: new registration's client unchanged, old candidate disposed, no events for the old loop.
  - `offline pauses without spending attempts` — connectivity offline then `subscribe` listener called with `true` after 3 delays: attempt counter in events starts at 1 after coming online; a throwing `isOnline` counts as online.
  - `setup during reconnect waits and setup after a swap returns current tools`.
  - `HTTP and direct contexts emit context:added`.
- [ ] **Step 2:** `cd packages/host && pnpm exec vitest run test/reconnect.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Ownership check helper `#owns(registration, client, generation?)`; `#refreshContextTools`, `#onListChanged`, `setup` capture registration + client before awaits and re-check after. Context span: new span per client linked (`links`) to the lost one, attribute `mokei.context.reconnect.attempt`.
- [ ] **Step 4:** PASS; full host suite (existing `setup-identity`, `context-tracing` tests stay green), types; build.
- [ ] **Step 5: Commit** `feat(host): opt-in context reconnect controller`.

### Task 5: Call gate, single deadline, read-only retry

**Files:**
- Modify: `packages/host/src/host.ts` (`callTool` ~909, `callNamespacedTool` ~919, `getPrompt` ~899), `packages/host/src/reconnect.ts`
- Test: `packages/host/test/reconnect-gate.test.ts` (new)

**Interfaces:**
- Consumes: Task 4 `ReconnectController.waitForGate`, `ContextUnavailableError`; Task 1 `transportFailureOf`, `TaskInterruptedError`.
- Behaviour: deadline = entry time + (`timeout` ?? `DEFAULT_REQUEST_TIMEOUT` the client uses); gate wait `min(gateTimeoutMs, remaining)`; dispatch with `timeout: remaining`; registration re-read before dispatch must be the one captured at entry; abort checked before wait, on wake, before dispatch. `callNamespacedTool` converts only `ContextUnavailableError` to `{ isError: true, content: [{ type: 'text', text: error.message }] }`.
- Retry once when all hold (spec "Read-only retry"): tool on the lost generation has `annotations.readOnlyHint === true`; error is `TransportClosedError` from that generation's client or `transportFailureOf(error)?.kind` in `network` / `session-expired`; the call's generation is the lost one; not `TaskInterruptedError`; not aborted; time left.

- [ ] **Step 1: Failing tests:**
  - `a call during reconnect waits and runs on the new client`.
  - `gate timeout fails with ContextUnavailableError` (`gateTimeoutMs: 50`); `callNamespacedTool` returns it as an `isError` result; `callTool` rejects.
  - `the deadline covers the wait` — `timeout: 100`, gate opens at 80: dispatched call has ≤ 20 ms left (spy on client `callTool` params).
  - `abort wins over a gate opening` — abort and gate open in the same tick: rejects with the abort reason, client `callTool` not called; `callNamespacedTool` rejects too (not an `isError` result).
  - `a removed and re-added key fails the waiting call`.
  - `a read-only call lost in flight is retried once` — `readOnlyHint: true`, loss mid-call: one retry on the new client, result returned.
  - `non-read-only, timeouts, aborts and interrupted tasks are not retried` — four cases, each rejects with its original error and the new client sees no call.
- [ ] **Step 2:** `pnpm exec vitest run test/reconnect-gate.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS; full host suite, types; build.
- [ ] **Step 5: Commit** `feat(host): gate calls during a reconnect`.

### Task 6: HTTP contexts reconnect

**Files:**
- Modify: `packages/host/src/host.ts` (`addHTTPContext` ~639)
- Test: `packages/host/test/reconnect-http.test.ts` (new)

**Interfaces:**
- Consumes: Task 2 `connectionEvents`; Task 3 `interactive`, `setInteractive`; Task 4 controller.
- Factory: new `HTTPTransport({ ...same params, interactive: false })` + client; commit calls `transport.setInteractive(true)`; on loss call `setInteractive(false)` before disposing; a `session-expired` loss disposes without the `DELETE` (new `HTTPTransport.dispose({ terminateSession?: boolean })`, default `true`). `connection` events of the current generation call `reportLoss`. A candidate failing with brand `auth-required` or `{ kind: 'http', status: 401 }` ends the loop: `context:failed` with `AuthRequiredError`.

- [ ] **Step 1: Failing tests** (runtime fetch stub driving an in-memory MCP responder):
  - `a network failure reconnects an HTTP context` — after setup, one call's fetch rejects: `context:reconnected`, next call succeeds on a new transport.
  - `session expiry re-initialises` (`2025-11-25`) — POST 404 with session: new transport sends `initialize`, old transport sends no `DELETE`.
  - `auth required ends the loop` — candidate gets 401 that needs sign-in (OAuth middleware with a handler spy): handler never called, `context:failed` error `instanceof AuthRequiredError`, then removed.
  - `5xx does not reconnect`.
  - `idle stream loss reconnects` — two GET re-open network failures with no calls: `context:reconnecting` fires.
- [ ] **Step 2:** `pnpm exec vitest run test/reconnect-http.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS; host suite, types; build host and http-client.
- [ ] **Step 5: Commit** `feat(host): reconnect HTTP contexts`.

### Task 7: Resource subscriptions through the host

**Files:**
- Modify: `packages/host/src/host.ts`, `packages/host/src/reconnect.ts`
- Test: `packages/host/test/reconnect-subscriptions.test.ts` (new)

**Interfaces:**
- Produces: `ContextHost.subscribeResource(params: { key: string; uri: string; signal?: AbortSignal }): Promise<void>`, `ContextHost.unsubscribeResource(params: { key: string; uri: string; signal?: AbortSignal }): Promise<void>`; per-key desired set and one serial queue (`@sozai/async` or a promise chain).
- Rules (spec "Subscriptions"): subscribe records the URI after acknowledgement; unsubscribe removes first, restores on failure; restoration after commit runs in the queue from a snapshot, skips URIs no longer desired, stops on lost ownership, does not block the gate, relies on Task 3's always-non-interactive `subscriptions/listen` for HTTP; a failure or a server without resource subscriptions drops the URI and emits `resource:subscription-lost`.

- [ ] **Step 1: Failing tests** (`2026-07-28` direct context with resource subscriptions):
  - `subscriptions are restored after a reconnect` — two URIs subscribed; after reconnect the new server receives both.
  - `an unsubscribe during restoration is honoured` — restoration of URI A blocked; unsubscribe B; B never re-subscribed.
  - `a failed unsubscribe keeps the URI` — server rejects unsubscribe: URI restored after the next reconnect.
  - `a failed re-subscribe drops the URI with resource:subscription-lost`.
  - `restoration never steps up` (HTTP + OAuth) — re-subscribe gets `403 insufficient_scope`: handler not called, `resource:subscription-lost` for that URI.
  - `calls are not blocked by restoration`.
- [ ] **Step 2:** `pnpm exec vitest run test/reconnect-subscriptions.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS; host suite, types; build.
- [ ] **Step 5: Commit** `feat(host): restore resource subscriptions after a reconnect`.

### Task 8: Stdio reconnect (`NodeContextHost`)

**Files:**
- Modify: `packages/host-node/src/node-host.ts` (`AddLocalContextParams` ~116, `addLocalContext`, `spawnHostedContext` ~41-114 callbacks ~143-188)
- Test: `packages/host-node/test/reconnect.test.ts` (new) with fixture `packages/host-node/test/fixtures/flaky-server.js` (a stdio MCP server that exits on a `crash` tool call or after `--die-after-ms`)

**Interfaces:**
- Consumes: Task 4 `registerHostedContext(..., { reconnect })`, `reportLoss`.
- Produces: `AddLocalContextParams.reconnect?: boolean | (ReconnectOptions & { respawn?: (previous: SpawnContextServerParams) => SpawnContextServerParams | false | Promise<SpawnContextServerParams | false> })`.
- Rules: per-candidate `isCurrent` / `framingError` / `onExit` closures; with an armed controller, `onStreamError` and `onExit` call `reportLoss` instead of emitting `context:failed` and removing; `respawn` is called once per loss before the first attempt, its params reused for all attempts and kept as `previous`; `false` → `context:failed` (`ReconnectExhaustedError` with `attempts: 0`, cause `Error('respawn declined')`) then removed.

- [ ] **Step 1: Failing tests:**
  - `a crashed server is respawned` — call `crash`: `context:reconnected`, next call answered by a new pid.
  - `respawn is asked once per loss and its params are reused` — `respawn` spy called once across 3 failing attempts; returned args used by each spawn.
  - `respawn false fails the context`.
  - `a server that keeps dying fails after maxAttempts` — `--die-after-ms 10`: exactly 5 spawns, then `context:failed` then `context:removed`.
  - `without reconnect, exit behaves as today` (existing node-host tests stay green).
- [ ] **Step 2:** `cd packages/host-node && pnpm exec vitest run test/reconnect.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS; host-node suite (known SIGKILL timing flake: rerun alone), types; build.
- [ ] **Step 5: Commit** `feat(host-node): reconnect stdio contexts by respawning`.

### Task 9: Session and NodeSession pass-through

**Files:**
- Modify: `packages/session/src/session.ts` (`#setupHTTPContext` destructure ~264, cleanup ~298), `packages/session-node/src/node-session.ts` (`AddContextParams` ~8, `addContext` ~56, `#removeIfOurs` ~43)
- Test: `packages/session/test/reconnect.test.ts`, `packages/session-node/test/reconnect.test.ts` (new)

**Interfaces:**
- Consumes: Task 4/8 `reconnect` params.
- Rules: both pass `reconnect` through; cleanup compares the registration (`host.contexts[key]` object captured after add) instead of the client.

- [ ] **Step 1: Failing tests:**
  - `Session.addHTTPContext passes reconnect` — host spy receives `reconnect: true`.
  - `NodeSession.addContext passes reconnect`.
  - `abort after setup does not remove a reconnected context` — reconnect swaps the client after setup; a late abort cleanup leaves the context.
- [ ] **Step 2:** run each package's new test → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** PASS; both suites, types; build.
- [ ] **Step 5: Commit** `feat(session): pass reconnect through and own registrations`.

### Task 10: CLI chat

**Files:**
- Modify: `packages/cli/src/chat/hooks/useSlashCommands.ts` (~132, ~224), `packages/cli/src/chat/ChatApp.tsx` (~137-151), `packages/cli/src/chat/hooks/useSession.ts` (~15-26)
- Test: extend the existing CLI chat tests for slash commands and `ChatApp` notices

- [ ] **Step 1: Failing tests:**
  - `/context add and /context add-http enable reconnect`.
  - `reconnecting, reconnected and subscription-lost show notices` (text: `Reconnecting <key> (attempt <n>)…`, `Reconnected <key>`, `Lost subscription <uri> on <key>`).
  - `a context removed by the host leaves the list`.
- [ ] **Step 2–4:** run the CLI test files → FAIL, implement, PASS; build the CLI (`./bin/dev.js` runs from `lib/`).
- [ ] **Step 5: Commit** `feat(cli): reconnect chat contexts and show reconnect notices`.

### Task 11: Docs and changeset

**Files:**
- Modify: `docs/agents/architecture.md` (context lifecycle: reconnect, events, gate, stale clients), `packages/host/README.md` (or the host section that documents `add*Context`), `packages/http-client/README.md` (`connection` events, `transportFailureOf`, interaction mode)
- Create: `.changeset/context-reconnect.md` (patch: the seven packages in Global Constraints)

- [ ] **Step 1:** Write docs and changeset; `pnpm change status`.
- [ ] **Step 2:** Full check: `rtk proxy pnpm run build && pnpm -r --no-bail run test && rtk proxy pnpm run lint` (known flakes: host-node SIGKILL timing, integration daemon start under load -- rerun alone).
- [ ] **Step 3: Commit** `docs: context reconnect`.
