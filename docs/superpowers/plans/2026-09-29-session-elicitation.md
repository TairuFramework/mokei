# Session Elicitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sessions answer MCP server elicitation requests through a host handler, and let agents stream, answer, and cancel attributed requests safely.

**Architecture:** A host created with `elicit` gives each host-built client a key-bound dispatcher whose override can be owned by one agent. Agent runs use an ordered event channel and per-call settlement barrier so interactive prompts appear before tool completion, while run and tool cancellation abort pending answers. Existing `ContextClient` reverse-request and MRTR handlers remain the protocol boundary.

**Tech Stack:** TypeScript, MCP `2025-11-25` and `2026-07-28`, `@sozai/async`, `@sozai/event`, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-29-session-elicitation-design.md`

## Global Constraints

- Elicitation is enabled at host construction with `elicit?: HostElicitHandler | true`; without it, host-built clients keep their current undeclared capability.
- `elicit: true` declines with `{ action: 'decline' }` whenever no override is installed, including before installation and after removal.
- `2025-11-25` declares elicitation in `initialize`; `2026-07-28` declares it in each request's `_meta` client capabilities. Do not delay declaration until an agent attaches.
- A context's `elicit: false` opt-out wins over its host setting. Caller-built clients passed to `registerHostedContext` retain their own handler and capabilities.
- URL-mode requests reach the handler; forwarding `notifications/elicitation/complete` is out of scope.
- Sampling, roots, CLI prompts, and UI prompts are out of scope. Do not add a package or a third-party dependency.
- `@mokei/host` and `@mokei/session` are Node-free and React Native / Metro-safe per `docs/agents/architecture.md`; they must not import `node:` built-ins. Keep `@mokei/context-server` Node-free too.
- Follow `kigu:conventions`: `type`, `Array<T>`, `#` private fields, single params objects, kebab-case files. Use pnpm only. Build a changed dependency before testing a dependent package because tests resolve built `lib/`.
- Use `pnpm --filter <pkg> test`, `pnpm --filter <pkg> build`, and `rtk proxy pnpm run lint`.

## File map

- `packages/host/src/host.ts` owns dispatcher state and all host-built client seams; `packages/host/src/index.ts` exposes its public types.
- `packages/host-node/src/node-host.ts` handles standalone and hosted stdio; `packages/host-node/src/proxy.ts` handles daemon construction and strips local-only options from the spawn payload.
- `packages/session/src/session.ts` and `packages/session-node/src/node-session.ts` forward construction and context options; `packages/session/src/agent-types.ts` defines callback and event types.
- `packages/session/src/agent-session.ts` owns agent requests, attribution and aborts; `packages/session/src/agent-event-channel.ts` owns only per-run queue/wakeup mechanics.
- Package tests cover each seam; `integration-tests/support/interop/` holds the two revision fixtures and `integration-tests/suites/session-elicitation.test.ts` proves cross-package behavior. Package READMEs, `docs/agents/architecture.md` and one `.changeset/` intent document the shipped API.

## Review Focus

- A request arriving while a tool's settlement barrier is draining must still be attributed to that tool and finish before its terminal event; pin in Task 7's `keeps attribution through the settlement barrier` test.
- An already-aborted request signal must never start a user callback and must produce one paired error; pin in Task 8's `rejects an already-aborted elicitation before invoking the callback` test.
- Two elicitation responses completing in reverse order must keep distinct request IDs and correct pairs; pin in Task 5's `pairs concurrent elicitation requests by requestID` test.
- An old override's removal function invoked after a replacement is installed must leave the replacement active; pin in Task 1's `stale override removal leaves replacement installed` test.
- Agent disposal while an unattributed callback is pending must abort it and still report one terminal error to `onEvent`; pin in Task 8's `agent disposal aborts an unattributed elicitation` test.

---

### Task 1: Host dispatch and override ownership

**Files:** Modify `packages/host/src/host.ts`, `packages/host/src/index.ts`; create `packages/host/test/elicitation-dispatch.test.ts`.

**Interfaces:** Current `ContextHostParams = { dispose?: () => Promise<void> }`, `ContextHost.constructor(params: ContextHostParams = {})`, and `ElicitHandler = (request: ClientHandlerRequest<ElicitRequest['params']>) => ElicitResult | Promise<ElicitResult>`, with `ClientHandlerRequest<Params> = { params: Params; signal: AbortSignal }`. Produce `HostElicitRequest = { key: string; params: ElicitRequest['params']; signal: AbortSignal }`, `HostElicitHandler = (request: HostElicitRequest) => ElicitResult | Promise<ElicitResult>`, `ElicitFallback = (options?: { signal?: AbortSignal }) => Promise<ElicitResult>`, `HostElicitOverride = (request: HostElicitRequest, fallback: ElicitFallback) => ElicitResult | Promise<ElicitResult>`, `ContextHostParams.elicit?: HostElicitHandler | true`, `host.elicitationEnabled: boolean`, `host.handleElicitation(handler: HostElicitOverride): () => void`, and `protected createElicitHandler(params: { key: string; elicit?: false }): ElicitHandler | undefined`, used by every host-built path and by the `NodeContextHost` subclass (not part of the public API).

- [ ] **Step 1: Write failing dispatch tests.** In `elicitation-dispatch.test.ts`, name tests `routes an override before the base handler`, `fallback uses the base handler and replaces its signal`, `fallback declines when no base handler exists`, `true declines before and after an override`, `rejects a second override and a disabled host`, `removal is idempotent and disposal clears the override`, and `stale override removal leaves replacement installed`. Assert returned actions, key, params and signal identity; in the last test, remove A, install B, call A's remover again, then assert B answers.
- [ ] **Step 2: Run red.** Run `pnpm --filter @mokei/host test`. Expected: the new host API tests fail to compile or assert.
- [ ] **Step 3: Implement the host API.** Add the exact types and methods above to `host.ts`, export the public types from `index.ts`, and use one private override slot. The key-bound closure must read the current override at request time, then run the base handler or decline; `fallback({ signal })` substitutes only the signal passed to the base handler. Reject a second owner and disabled hosts, clear the override during disposal, and preserve exceptions for the client error path.
- [ ] **Step 4: Verify.** Run `pnpm --filter @mokei/host test` and `pnpm --filter @mokei/host build`. Expected: both exit 0.
- [ ] **Step 5: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/host/src packages/host/test/elicitation-dispatch.test.ts && git commit -m "feat: dispatch host elicitation through one override"`.

### Task 2: Host client-building paths and per-context opt-outs

**Files:** Modify `packages/host/src/host.ts`, `packages/host/src/index.ts`, `packages/host/README.md`; create `packages/host/test/elicitation-contexts.test.ts`.

**Interfaces:** Consumes Task 1's `createElicitHandler({ key, elicit })`. Current `createHostedContext<T>(params: CreateHostedContextParams): HostedContext<T>` builds `new ContextClient<T>({ protocolVersion, transport })`; `CreateContextParams = CreateHostedContextParams & { key: string }`; `createContext<T>(params: CreateContextParams): ContextClient<T>`; `addDirectContext<T>(params: AddDirectContextParams): ContextClient<T>`; `addHTTPContext<T>(params: HTTPContextParams): Promise<ContextClient<T>>`; `registerHostedContext(params: { key: string; context: HostedContext }): void`. Produce `CreateHostedContextParams.elicit?: ElicitHandler`, `CreateContextParams = Omit<CreateHostedContextParams, 'elicit'> & { key: string; elicit?: false }`, and `elicit?: false` on `AddDirectContextParams` and `HTTPContextParams`.

- [ ] **Step 1: Write failing client-path tests.** Name tests `direct context answers elicitation with its key`, `createContext false type-checks and declares no capability`, `createContext and addDirectContext opt out independently`, `addHTTPContext false declares no capability`, `caller-built context keeps its own capabilities`, `no host option leaves capability absent`, `removed key reused by a new context routes to the new client`, `host capability is declared on both revisions before an agent exists`, and `URL mode reaches the host handler`. Assert actual tool result and handler request for a direct server; inspect `initialize.capabilities.elicitation` for `2025-11-25` and each request's `_meta['io.modelcontextprotocol/clientCapabilities'].elicitation` for `2026-07-28`; assert absent capability for every opt-out and the disabled default. Include a TypeScript assignment to `CreateContextParams` with `elicit: false`; the URL test asserts the handler receives `mode: 'url'`, `elicitationId` and `url` unchanged.
- [ ] **Step 2: Run red.** Run `pnpm --filter @mokei/host test`. Expected: forwarding, opt-out and type assertions fail.
- [ ] **Step 3: Wire client construction.** Pass `elicit` through `createHostedContext` to `ContextClient`; have each host-built path call `createElicitHandler({ key, elicit })`. Strip `elicit: false` before constructing `ContextClient` or a transport. Leave `registerHostedContext` untouched.
- [ ] **Step 4: Document the host contract.** Update `packages/host/README.md` with `elicit` at construction, fixed capability declaration, per-context opt-out, override/fallback, decline default and URL-mode completion limitation.
- [ ] **Step 5: Verify.** Run `pnpm --filter @mokei/host test` and `pnpm --filter @mokei/host build`. Expected: both exit 0, including the React Native bundle test.
- [ ] **Step 6: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/host && git commit -m "feat: enable elicitation on host-built clients"`.

### Task 3: Node host stdio and daemon paths

**Files:** Modify `packages/host-node/src/node-host.ts`, `packages/host-node/src/proxy.ts`; create `packages/host-node/test/elicitation.test.ts`, `packages/host-node/test/fixtures/elicitation-server.mjs`, `packages/host-node/README.md`.

**Interfaces:** Consumes Task 1's `HostElicitHandler` and `createElicitHandler`, Task 2's `CreateHostedContextParams.elicit`. Current `spawnHostedContext<T>(params: SpawnHostedContextParams): Promise<HostedContext<T>>`, `NodeContextHost.addLocalContext<T>(params: AddLocalContextParams): Promise<ContextClient<T>>`, `ProxyHost.forDaemon(options?: DaemonOptions): Promise<ProxyHost>`, `ProxyHost.constructor(params: ProxyHostParams)`, `ProxyHost.spawn<T>(params: ProxySpawnParams): Promise<ContextClient<T>>`; `ProxyHostParams = { client: HostClient }`, `DaemonOptions = { socketPath?: string }`; daemon `spawn.param` allows `command`, `args`, `env` only. Produce `SpawnHostedContextParams.elicit?: ElicitHandler`, `AddLocalContextParams.elicit?: false`, `ProxySpawnParams.elicit?: false`, `ProxyHostParams = { client: HostClient; elicit?: HostElicitHandler | true }`, and `forDaemon(options?: DaemonOptions & { elicit?: HostElicitHandler | true }): Promise<ProxyHost>`.

- [ ] **Step 1: Write failing Node-path tests.** Name tests `standalone spawnHostedContext uses its own handler`, `standalone spawnHostedContext without handler declares no capability`, `NodeContextHost stdio uses its key-bound handler`, `NodeContextHost stdio opts out`, `ProxyHost forDaemon installs the host handler`, and `ProxyHost spawn false omits capability and daemon payload`. Use `test/fixtures/elicitation-server.mjs` as the pinned 2025 stdio server. Assert the stdio tool receives accepted elicitation content, opt-outs omit capability, `forDaemon` preserves `socketPath`, and the captured `createChannel('spawn', { param })` has no `elicit` field.
- [ ] **Step 2: Run red.** Run `pnpm --filter @mokei/host build` then `pnpm --filter @mokei/host-node test`. Expected: new signatures or assertions fail.
- [ ] **Step 3: Wire stdio construction.** Extract `elicit` from `SpawnHostedContextParams` before `spawnContextServer` and pass it only to `createHostedContext`; `addLocalContext` supplies `createElicitHandler({ key, elicit })` to the standalone spawner.
- [ ] **Step 4: Wire daemon construction.** Extract `elicit` from `forDaemon` options before calling `runDaemon({ socketPath })`, then pass it through the `ProxyHost` constructor to `super`. Extract `ProxySpawnParams.elicit` before building the daemon payload and pass it to `createContext` locally.
- [ ] **Step 5: Document Node usage.** Create `packages/host-node/README.md` with stdio, standalone spawn, daemon, opt-out, decline default and fixed-capability examples. Note the URL-mode completion limitation.
- [ ] **Step 6: Verify.** Run `pnpm --filter @mokei/host-node test` and `pnpm --filter @mokei/host-node build`. Expected: both exit 0.
- [ ] **Step 7: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/host-node && git commit -m "feat: route elicitation through Node hosts"`.

### Task 4: Session and NodeSession options

**Files:** Modify `packages/session/src/session.ts`, `packages/session-node/src/node-session.ts`, `packages/session-node/README.md`; extend `packages/session/test/http-context.test.ts`, `packages/session/test/lifecycle.test.ts`, `packages/session-node/test/add-context.test.ts`, `packages/session-node/test/lifecycle.test.ts`; create `packages/session-node/test/fixtures/elicitation-server.mjs`.

**Interfaces:** Consumes Task 1's `HostElicitHandler` and Task 3's Node host params. Current `SessionParams<T> = { providers?: Record<string, ModelProvider<T>>; contextHost?: ContextHost; localTools?: Array<LocalToolDefinition> }`, `Session.constructor(params: SessionParams<T> = {})`, `Session.addHTTPContext(params: AddHTTPContextParams): Promise<Array<ContextTool>>`, `NodeSessionParams<T> = Omit<SessionParams<T>, 'contextHost'> & { contextHost?: NodeContextHost }`, `NodeSession.constructor(params: NodeSessionParams<T> = {})`, `NodeSession.addContext(params: AddContextParams): Promise<Array<ContextTool>>`. Produce `SessionParams<T>.elicit?: HostElicitHandler | true` and `AddContextParams.elicit?: false`; `AddHTTPContextParams` already inherits Task 2's `HTTPContextParams.elicit?: false`.

- [ ] **Step 1: Write failing Session tests.** Name tests `Session forwards elicit to its new host`, `Session rejects contextHost together with elicit`, `Session HTTP entry false leaves capability absent`, `NodeSession builds an elicitation-enabled NodeContextHost`, `NodeSession rejects contextHost together with elicit`, `NodeSession addContext false leaves capability absent`, and `default Session and NodeSession remain disabled`. Assert `elicitationEnabled`, thrown constructor conflict, and absence of `elicitation` in the actual HTTP and Node stdio clients' declarations after adding each context through its session entry point; use the new Node fixture for the latter.
- [ ] **Step 2: Run red.** Run `pnpm --filter @mokei/host-node build`, `pnpm --filter @mokei/session test`, then `pnpm --filter @mokei/session-node test`. Expected: new option tests fail.
- [ ] **Step 3: Implement Session forwarding.** Construct `new DefaultContextHost({ elicit: params.elicit })` when there is no supplied host; reject simultaneous `contextHost` and `elicit`. Preserve the HTTP param when `#setupHTTPContext` rebuilds the host call.
- [ ] **Step 4: Implement NodeSession forwarding.** Reject only a caller-supplied `contextHost` plus `elicit`; otherwise build `new NodeContextHost({ elicit })`, remove `elicit` from the object passed to `super`, and forward `AddContextParams.elicit` to `addLocalContext`.
- [ ] **Step 5: Document NodeSession construction.** Add the handler, conflict, opt-out and fixed-capability examples to `packages/session-node/README.md`.
- [ ] **Step 6: Verify.** Run `pnpm --filter @mokei/session test`, `pnpm --filter @mokei/session build`, `pnpm --filter @mokei/session-node test`, and `pnpm --filter @mokei/session-node build`. Expected: all exit 0.
- [ ] **Step 7: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/session/src/session.ts packages/session/test packages/session-node && git commit -m "feat: configure session elicitation and context opt-outs"`.

### Task 5: Agent ownership and event types

**Files:** Modify `packages/session/src/agent-types.ts`, `packages/session/src/agent-session.ts`, `packages/session/README.md`; create `packages/session/test/agent-elicitation-ownership.test.ts`.

**Interfaces:** Consumes `Session.contextHost: ContextHost`, `handleElicitation(handler: HostElicitOverride): () => void` and `ElicitFallback`. Current `AgentParams<T>` contains `session`, `provider`, `model`, optional approval/timeouts/`onEvent`; `AgentSession.constructor(params: AgentParams<T>)`; `AgentSession` extends `Disposer` with `super()` and `events: EventEmitter<{ event: AgentEvent<T> }>`; `AgentEvent<T>` is the union in `agent-types.ts`. Produce `ElicitationRequest = HostElicitRequest & { toolCall?: FunctionToolCall<unknown> }`, `ElicitationFn = (request: ElicitationRequest) => ElicitResult | Promise<ElicitResult>`, `AgentParams<T>.onElicitation?: ElicitationFn`, `ResolvedAgentParams<T>.onElicitation?: ElicitationFn`, and three exported event types in `AgentEvent<T>`: `elicitation-request` with `requestID,key,params,toolCall?,timestamp`; `elicitation-response` with `requestID,key,action,toolCall?,timestamp`; `elicitation-error` with `requestID,key,error,toolCall?,timestamp`.

- [ ] **Step 1: Write failing ownership tests.** Name tests `default Session agent constructs without an override`, `onElicitation on a disabled host throws`, `second agent on one enabled host throws`, `agent without callback falls back to the base handler`, `agent without callback declines without a base handler`, `agent disposal restores the base handler`, and `pairs concurrent elicitation requests by requestID`. Assert one request and one matching terminal event per invocation, no answer content in the response event, and unique IDs even when two callbacks finish in reverse order.
- [ ] **Step 2: Run red.** Run `pnpm --filter @mokei/session test`. Expected: ownership, callback and event tests fail.
- [ ] **Step 3: Implement ownership and event dispatch.** After provider resolution, install one override only when `session.contextHost.elicitationEnabled`; reject `onElicitation` on a disabled host. Make `Disposer` remove that exact override and abort pending agent-owned requests. Emit request before awaiting callback/fallback, then exactly one response or error; race callback settlement with its signal and ignore late results. Use the same combined signal for `fallback({ signal })` as for `onElicitation`.
- [ ] **Step 4: Document the agent-facing API.** Add `onElicitation`, request/response/error events, pairing, attribution limits, fallback/decline and URL-mode completion limitation to `packages/session/README.md`.
- [ ] **Step 5: Verify.** Run `pnpm --filter @mokei/session test` and `pnpm --filter @mokei/session build`. Expected: both exit 0; its React Native bundle test remains green.
- [ ] **Step 6: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/session && git commit -m "feat: give agents elicitation ownership and events"`.

### Task 6: Per-run event channel and attribution

**Files:** Create `packages/session/src/agent-event-channel.ts`, `packages/session/test/agent-elicitation-stream.test.ts`; modify `packages/session/src/agent-session.ts`.

**Interfaces:** Consumes Task 5's three `AgentEvent` variants and override. Current `AgentSession.stream(params: AgentRunParams<T>): AsyncGenerator<AgentEvent<T>>` and `#executeToolCall(toolCall: FunctionToolCall<unknown>, emitEvent: (event: AgentEvent<T>) => AgentEvent<T>, signal: AbortSignal): Promise<{ result?: CallToolResult; error?: Error; events: Array<AgentEvent<T>> }>` buffer tool events. Produce internal `AgentEventChannel<T>.push(event: AgentEvent<T>): void`, `.takeAll(): Array<AgentEvent<T>>`, `.waitForEvent(): Promise<void>`, `.close(): void`; `#executeToolCall(toolCall: FunctionToolCall<unknown>, emitEvent: (event: AgentEvent<T>) => AgentEvent<T>, run: AgentRunState<T>): Promise<{ result?: CallToolResult; error?: Error }>` emits through the run channel. `AgentRunState<T>` records its channel, signal and at most one active `AgentToolState<T>`.

- [ ] **Step 1: Write failing streaming tests.** Name tests `yields elicitation-request before its callback resolves`, `immediate callback keeps stream and onEvent order`, `matching single tool call supplies toolCall`, `setup and unmatched requests go to onEvent only`, and `two concurrent runs against one context leave requests unattributed`. Assert stream and `onEvent` sequences `tool-call-start`, `elicitation-request`, `elicitation-response`, `tool-call-complete` for immediate resolution; make one callback await a signal from the stream consumer to prove no deadlock.
- [ ] **Step 2: Run red.** Run `pnpm --filter @mokei/session test`. Expected: streamed prompt and attribution assertions fail.
- [ ] **Step 3: Implement the channel.** Keep one ordered channel per run. Register active runs at stream start and remove in `finally`; attribute only with exactly one active run and one matching in-flight context tool (parse its namespaced name using `getContextToolInfo`). Route attributed events to that channel and to `onEvent`; send unattributed ones to `onEvent` only. Emit `tool-call-start` into the channel before executing, and have `stream` yield channel entries while the tool promise is pending. Keep existing non-tool stream events and event history semantics.
- [ ] **Step 4: Verify.** Run `pnpm --filter @mokei/session test` and `pnpm --filter @mokei/session build`. Expected: both exit 0 and the streamed prompt resolves without a timeout.
- [ ] **Step 5: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/session/src packages/session/test/agent-elicitation-stream.test.ts && git commit -m "feat: stream attributed elicitation during tool calls"`.

### Task 7: Tool settlement barrier and terminal ordering

**Files:** Modify `packages/session/src/agent-session.ts`, `packages/session/src/agent-event-channel.ts`; extend `packages/session/test/agent-elicitation-stream.test.ts`.

**Interfaces:** Consumes Task 6's `AgentRunState<T>`, `AgentToolState<T>`, channel and `#executeToolCall(toolCall: FunctionToolCall<unknown>, emitEvent: (event: AgentEvent<T>) => AgentEvent<T>, run: AgentRunState<T>): Promise<{ result?: CallToolResult; error?: Error }>`. Produce a per-tool `Set<Promise<void>>` of attributed request terminal-event settlements and a tool-call completion sequence that aborts remaining request signals, awaits their settlements, drains queued events, then emits exactly one tool terminal event.

- [ ] **Step 1: Write failing settlement tests.** Name tests `response at tool settlement precedes tool terminal`, `several requests in one MRTR round preserve stream and onEvent order`, `2025 tool returning before its elicitation settles aborts the request`, and `keeps attribution through the settlement barrier`. Assert each request has one paired terminal event, both observers see start → all elicitation events → tool terminal, and a callback still pending when the 2025 tool returns gets `elicitation-error` before `tool-call-complete`. In the barrier test, start a second reverse request while the first terminal event is draining and assert it still carries the original `toolCall` and settles before the tool terminal.
- [ ] **Step 2: Run red.** Run `pnpm --filter @mokei/session test`. Expected: at least the early-tool-result and barrier-order tests fail.
- [ ] **Step 3: Implement the barrier.** Register each attributed request's settlement promise before invoking its callback. On either tool result or error, abort pending attributed callback controllers with a tool-settled reason, await all terminal-event promises (including requests arriving during the barrier), drain queued events, then emit the tool terminal to `onEvent` and the channel. Keep the active call registered until the terminal emission. Ensure the stream drains the channel before processing the returned tool outcome.
- [ ] **Step 4: Verify.** Run `pnpm --filter @mokei/session test` and `pnpm --filter @mokei/session build`. Expected: both exit 0; stream and `onEvent` have identical tool-related order.
- [ ] **Step 5: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/session/src packages/session/test/agent-elicitation-stream.test.ts && git commit -m "feat: settle elicitation before tool terminal events"`.

### Task 8: Run, tool and abandoned-stream cancellation

**Files:** Modify `packages/session/src/agent-session.ts`, `packages/session/src/agent-event-channel.ts`; create `packages/session/test/agent-elicitation-abort.test.ts`.

**Interfaces:** Consumes Task 7's settlement barrier. Current `cancelToolCall(): void` aborts one `#activeToolController`; `stream(params: AgentRunParams<T>): AsyncGenerator<AgentEvent<T>>` combines caller and timeout signals but its `finally` only clears the timer and closes `activeChatTurn`. Produce a per-run internal `AbortController` linked to caller signal, a per-tool controller linked to it, and callback signals combining the request signal, tool signal when attributed, and agent-disposal signal. `stream`'s `finally` aborts its run controller before closing the channel.

- [ ] **Step 1: Write failing cancellation tests.** Name tests `stream return aborts pending elicitation`, `caller abort aborts pending elicitation`, `tool timeout aborts pending elicitation`, `cancelToolCall aborts pending elicitation`, `2025 forwarded and unforwarded server signals both abort`, `breaking after request still pairs onEvent with error`, `fallback base handler aborts with the tool`, `late callback result after abort is ignored`, `rejects an already-aborted elicitation before invoking the callback`, and `agent disposal aborts an unattributed elicitation`. Assert one `elicitation-error` per request, no late `elicitation-response`, and the revision-specific tool outcome. Use deterministic deferred callbacks and short fake timers where needed.
- [ ] **Step 2: Run red.** Run `pnpm --filter @mokei/session test`. Expected: abandoned-stream, cancellation and late-result assertions fail.
- [ ] **Step 3: Implement cancellation links.** Create the run controller when `stream` starts and link caller and timeout signals. Abort it first in generator `finally`, then close and wake channel waiters. Link each per-tool controller to the run; combine it with the server request signal for attributed callbacks, and combine only request/disposal for unattributed ones. Race callbacks and fallback against the combined signal; preserve the existing `ToolCallCancelledError` and `ToolCallTimeoutError` outcome paths.
- [ ] **Step 4: Verify.** Run `pnpm --filter @mokei/session test` and `pnpm --filter @mokei/session build`. Expected: both exit 0, including existing approval and provider-stream abort tests.
- [ ] **Step 5: Commit.** Run `rtk proxy pnpm run lint`, then `git add packages/session/src packages/session/test && git commit -m "feat: abort elicitation with agent runs and tools"`.

### Task 9: Both protocol revisions end to end

**Files:** Create `integration-tests/support/interop/session-elicitation-fixture.ts`, `integration-tests/support/interop/mokei-stdio-server-elicitation.ts`, `integration-tests/suites/session-elicitation.test.ts`; modify `integration-tests/support/interop/servers.ts` and `docs/agents/architecture.md`.

**Interfaces:** Consumes Tasks 1–8. Current `ContextServer.elicit(params: WithRequestOptions<ElicitRequest['params']>): Promise<ElicitResult>`, `runInputRequiredFlow(params: RunInputRequiredFlowParams): Promise<unknown>`, `startMokeiMRTRHTTPServer(): Promise<RunningHTTPServer>`, `spawnMokeiStdioClient(serverPath: string, protocolVersion: ProtocolVersion, clientOptions: MokeiClientOptions = {}): Promise<SpawnedMokeiClient>`, and `connectMokeiHTTPClient(url: string, protocolVersion: ProtocolVersion | 'auto', clientOptions?: MokeiClientOptions): ContextClient` provide fixture patterns. Produce one 2025 stdio server that calls `client.elicit` during `tools/call`, and one 2026 server whose tool returns `inputRequired({ inputRequests: { ask: { method: 'elicitation/create', params } }, requestState })` and reads `inputResponses.ask` on retry.

- [ ] **Step 1: Write failing cross-package tests.** Name tests `Session answers 2025 server-initiated elicitation over stdio`, `NodeSession answers 2025 server-initiated elicitation over stdio`, `default NodeSession agent constructs without an override`, `AgentSession streams 2025 elicitation and answer`, `Session answers 2026 MRTR elicitation over HTTP`, `AgentSession streams 2026 MRTR elicitation and answer`, `2025 callback rejection returns reverse RPC error`, and `2026 callback rejection fails MRTR locally without an input response`. Use a supplied `NodeContextHost` for the portable `Session` stdio case. Assert accepted content reaches the server's final tool result, the same handler shape serves both revisions, exact capability location per revision, agent event order and error outcome.
- [ ] **Step 2: Build and run red.** Run `pnpm build` then `pnpm --filter mokei-integration-tests test -- session-elicitation.test.ts`. Expected: new fixture or behavior assertions fail.
- [ ] **Step 3: Implement fixtures and fix integration defects.** Follow `mrtr-fixture.ts`, `mokei-stdio-server-mrtr.ts`, and `servers.ts`; pin the revisions in each fixture. Keep request state and input response assertions observable in the result. Fix only diagnosed cross-package defects.
- [ ] **Step 4: Update architecture.** In `docs/agents/architecture.md`, describe host construction-time capability, override ownership, per-context opt-out, MRTR and reverse RPC paths, run channel/settlement, and Node-free boundaries. State the URL completion limit.
- [ ] **Step 5: Verify.** Run `pnpm build` then `pnpm --filter mokei-integration-tests test -- session-elicitation.test.ts`. Expected: all new revision and transport cases pass.
- [ ] **Step 6: Commit.** Run `rtk proxy pnpm run lint`, then `git add integration-tests docs/agents/architecture.md && git commit -m "test: cover session elicitation across MCP revisions"`.

### Task 10: Minor release intent and full verification

**Files:** Create `.changeset/session-elicitation.md`.

**Interfaces:** Consumes the verified public APIs and docs from Tasks 1–9. Produces one minor release intent for the four changed public packages; it does not apply versions.

- [ ] **Step 1: Create the release intent.** Write `.changeset/session-elicitation.md` with this content:

```markdown
---
'@mokei/host': minor
'@mokei/host-node': minor
'@mokei/session': minor
'@mokei/session-node': minor
---

Enable session elicitation across both MCP revisions with host handlers, context opt-outs, streamed agent events, and cancellation.
```

- [ ] **Step 2: Check the release plan.** Run `pnpm change status`. Expected: this intent requests a minor change for each named package; unrelated pending intents may appear. Do not run `pnpm version -r`.
- [ ] **Step 3: Run final verification.** Run `rtk proxy pnpm run lint`, `pnpm build`, then `pnpm test`. Expected: every command exits 0. Run `git diff --check` and `git status --short`; expected: only intended implementation, tests, docs, changeset and any pre-existing unrelated worktree files.
- [ ] **Step 4: Commit.** Run `git add .changeset/session-elicitation.md && git commit -m "docs: record session elicitation minor release"`.
