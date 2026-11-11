# Per-call Elicitation Routing Implementation Plan

**Stage:** qa
**Mode:** tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A caller passes an elicitation handler with one request and receives only that request's `2026-07-28` (MRTR) elicitations.

**Architecture:** `ContextClient` threads an optional per-request `elicit` handler through `request()` options into the MRTR dispatch (`#fulfilInputRequest`) and into `TaskWaiter` for task-backed calls. `ContextHost` accepts a per-call `HostElicitOverride` on `callTool` / `callNamespacedTool` / `getPrompt`, adapts it to a client `ElicitHandler` with a `fallback` to the host-wide path, and passes it down.

**Tech Stack:** TypeScript, vitest, `@mokei/context-client`, `@mokei/host`, `@mokei/context-server` (tests).

**Spec:** `docs/superpowers/specs/2026-11-11-per-call-elicitation-design.md`

## Global Constraints

- Exact routing only on `2026-07-28`. On `2025-11-25` the per-call handler is ignored; server-initiated `elicitation/create` keeps going to the client-wide handler.
- A per-call handler never enables elicitation: if the client has no client-wide `elicit` (context added with `elicit: false`, or host without elicitation), the per-call handler is not used and behaviour is unchanged.
- Per-call handler takes precedence over the host's `handleElicitation` override.
- `elicit` never reaches the wire: strip it before `splitRequestOptions`.
- Conventions: `kigu:conventions` (kebab-case files, `#private`, TSDoc). Run lint as `rtk proxy pnpm run lint`.
- Cross-package tests resolve built `lib/`: run `pnpm --filter @mokei/context-client build` before host tests.
- Release: one patch changeset for `@mokei/context-client` and `@mokei/host`.

## Review Focus

- Two concurrent calls whose elicitations interleave: each handler sees only its own (Task 3 test).
- A handler that throws: the call fails as it does today with the client-wide handler, the sibling call is unaffected (Task 3 test).
- Abort mid-elicitation: the handler's `signal` aborts and the call rejects (Task 1 test).
- `fallback` called after the caller's own signal is aborted: it receives the aborted signal and the host-wide handler sees it (Task 2 test).
- Retry legs of one MRTR flow keep the same per-call handler across rounds (Task 1 test).

The spec lists `ContextHost.readResource`; `ContextHost` has no `readResource` today, so it is out of scope (the client's `readResource` still gets the option).

---

### Task 1: Per-request `elicit` in `ContextClient`

**Files:**
- Modify: `packages/context-client/src/client.ts` (`request()` options ~line 627; MRTR `dispatch` ~line 760; `#fulfilInputRequest` ~line 1460; `getPrompt` / `readResource` ~lines 1777-1860; `waitForTask` ~line 1880; `callTool` ~line 1924-1980)
- Modify: `packages/context-client/src/task-waiter.ts` (`WaitForTaskParams` line 23, `TaskWaiterParams.fulfil` line 37, `#dispatchInputs` line 387)
- Modify: `packages/context-client/src/types.ts`, `packages/context-client/src/index.ts`
- Test: `packages/context-client/test/per-call-elicit.test.ts` (new; harness pattern from `test/tasks-client.test.ts`, server from `../../context-server/lib/index.js`)

**Interfaces:**
- Produces: `export type PerRequestElicit = { elicit?: ElicitHandler }` in `types.ts`, exported from the index. `callTool`, `getPrompt`, `readResource` params become `WithRequestOptions<…> & PerRequestElicit` on every overload. `WaitForTaskParams` gains `elicit?: ElicitHandler`. `TaskWaiterParams.fulfil` becomes `(key: string, request: InputRequest, signal: AbortSignal, elicit?: ElicitHandler) => Promise<InputResponse>`.
- Internal: `request()` options type is `RequestOptions & PerRequestElicit`; retry legs spread `options`, so later rounds keep it.

- [ ] **Step 1: Write failing tests** in `per-call-elicit.test.ts`. A `2026-07-28` `ContextServer` with tool `ask` whose handler calls `client.elicit({ message: args.who, requestedSchema: { type: 'object', properties: {} } })` and returns the result as text; a client with a client-wide `elicit` returning `{ action: 'decline' }`.
  - `per-request elicit answers that call` — `callTool({ name: 'ask', arguments: { who: 'a' }, elicit })` → `elicit` called once with `params.message === 'a'`; client-wide not called; content text is `JSON.stringify(<elicit result>)`.
  - `keeps the handler across rounds` — tool elicits twice (two suspensions); per-request handler called twice, client-wide never.
  - `abort reaches the pending handler` — handler awaits a never-settling promise and records `signal`; abort the call's `AbortController` → recorded `signal.aborted === true` and `callTool` rejects.
  - `ignored without a client-wide handler` — client built without `elicit`; per-request `elicit` passed → never called (call fails as today without elicitation).
  - `2025-11-25 ignores the per-request handler` — same server on `2025-11-25`; client-wide handler answers, per-request not called.
  - `waitForTask routes task input` — task-backed tool (`createTaskManager`, `requestInput` with an `elicitation/create` request, as in `tasks-client.test.ts`); `callTool({ …, elicit })` → per-request handler answers the task's input.
  - `getPrompt routes its elicitation` — prompt handler that elicits; `getPrompt({ name, elicit })` → per-request handler called.
- [ ] **Step 2: Run, expect FAIL:** `pnpm --filter @mokei/context-server build && cd packages/context-client && pnpm exec vitest run test/per-call-elicit.test.ts`.
- [ ] **Step 3: Implement.** Strip `elicit` from params before `splitRequestOptions` in `callTool` / `getPrompt` / `readResource` and pass it in `request()` options (and to `waitForTask` from `callTool`). In MRTR dispatch call `this.#fulfilInputRequest(key, inputRequest, signal, options?.elicit)`. In `#fulfilInputRequest(key, request, signal, elicit?: ElicitHandler)`, for `elicitation/create` use `this.#elicit != null ? (elicit ?? this.#elicit) : undefined`. `TaskWaiter`: store `params.elicit` on the task entry on first `wait` (`entry.elicit ??= params.elicit`) and pass it to `fulfil`. TSDoc on `PerRequestElicit` states the `2026-07-28`-only scope and the no-enable rule.
- [ ] **Step 4: Run, expect PASS:** same command, plus `pnpm exec vitest run` and `rtk proxy pnpm run test:types` in `packages/context-client`.
- [ ] **Step 5: Commit** `feat(context-client): per-request elicitation handler for MRTR`.

### Task 2: Per-call `elicit` in `ContextHost`

**Files:**
- Modify: `packages/host/src/host.ts` (param types lines 117-131; `createElicitHandler` lines 350-370; `getPrompt` / `callTool` / `callNamespacedTool` lines 863-890)
- Test: `packages/host/test/per-call-elicit.test.ts` (new; copy the `directConfig` fixture from `test/elicitation-contexts.test.ts`, with the tool reading `args.who` into the elicitation message)

**Interfaces:**
- Consumes: `PerRequestElicit` / `ElicitHandler` from Task 1.
- Produces: `ContextToolParams`, `ContextPromptParams` and `NamespacedToolParams` gain `elicit?: HostElicitOverride`. Private `#hostElicit(request: HostElicitRequest): Promise<ElicitResult>`: the current override-then-dispatch body of `createElicitHandler`, which now calls it.

- [ ] **Step 1: Write failing tests** (`2026-07-28` direct context, host `elicit` returning `{ action: 'decline' }`):
  - `per-call handler answers its call` — `host.callTool({ key, name: 'ask', arguments: { who: 'a' }, elicit })` → `elicit` gets `request.key === key`, `request.params.message === 'a'`; host-wide not called.
  - `wins over handleElicitation` — with an override installed, per-call handler called, override not.
  - `fallback reaches the host-wide path` — per-call handler returns `fallback()`; override (if installed) else host `elicit` answers; result reaches the tool.
  - `fallback keeps an aborted signal` — per-call handler aborts its own controller, then `fallback({ signal })`; host-wide handler receives `signal.aborted === true`.
  - `callNamespacedTool passes it through` — `callNamespacedTool({ id: `${key}:ask`, arguments: { who: 'b' }, elicit })` routes to `elicit`.
  - `getPrompt passes it through` — prompt that elicits.
  - `elicit: false context ignores it` — context added with `elicit: false`; per-call handler never called.
- [ ] **Step 2: Run, expect FAIL:** `pnpm --filter @mokei/context-client build && cd packages/host && pnpm exec vitest run test/per-call-elicit.test.ts`.
- [ ] **Step 3: Implement.** Extract `#hostElicit`. In `callTool` / `getPrompt`, when `elicit` is set, pass the client `elicit: ({ params, signal }) => elicit({ key, params, signal }, (options) => this.#hostElicit({ key, params, signal: options?.signal ?? signal }))`; `callNamespacedTool` forwards `elicit` to `callTool` (local tools ignore it). TSDoc on each param type: `2026-07-28` only, precedence, and the no-enable rule.
- [ ] **Step 4: Run, expect PASS:** same command, plus `pnpm exec vitest run` and `rtk proxy pnpm run test:types` in `packages/host`.
- [ ] **Step 5: Commit** `feat(host): per-call elicitation handler on callTool and getPrompt`.

### Task 3: Concurrency, docs and changeset

**Files:**
- Modify: `packages/host/test/per-call-elicit.test.ts`
- Modify: `packages/host/README.md` (elicitation section), `docs/agents/architecture.md` (elicitation routing paragraph)
- Create: `.changeset/per-call-elicitation.md`

- [ ] **Step 1: Write tests:**
  - `concurrent calls each get their own elicitation` — two `callTool` calls on one context started together (`who: 'a'` / `'b'`), handlers `ha` / `hb` answering `{ action: 'accept', content: { by: 'a' } }` / `'b'`; tool results carry their own `by`; `ha` saw only `'a'`, `hb` only `'b'`; host-wide never called. Make `ha` wait until `hb` has been called, so the two flows interleave.
  - `a throwing handler fails only its call` — `ha` throws; call A resolves or rejects as with a throwing client-wide handler today (assert against the same setup without per-call); call B succeeds.
- [ ] **Step 2: Run, expect PASS:** `cd packages/host && pnpm exec vitest run test/per-call-elicit.test.ts`. If either fails, fix in `host.ts` / `client.ts` before going on.
- [ ] **Step 3: Docs and changeset.** README: one short subsection with a `callTool({ …, elicit })` example and the `2026-07-28` limit. Architecture: one sentence on per-call routing. Changeset: `"@mokei/context-client": patch`, `"@mokei/host": patch`, summary "Route `2026-07-28` elicitations to a per-call handler (`callTool`, `getPrompt`, `readResource`, `waitForTask`; host `callTool`, `callNamespacedTool`, `getPrompt`)." Validate with `pnpm change status`.
- [ ] **Step 4: Full check:** `rtk proxy pnpm run build && rtk proxy pnpm test && rtk proxy pnpm run lint`. Under full-suite load, integration daemon-startup timeouts are a known flake; rerun failing files alone before suspecting the change.
- [ ] **Step 5: Commit** `docs: per-call elicitation routing`.
