# Flow references, input decline and validators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship flow references with `list_flows`, the `input` decline edge, unconstrained `tool` result paths, and isolated recycled validators, as unblocked by `@sozai/flow-graph` 0.2.0 and `@sozai/schema` 0.1.3.

**Architecture:** A new flow registry in `@mokei/decision-flow-server` snapshots registered flows. It is the single source for resolution, checks, plans, recovery, discovery and wiring. `checkFlow` and `createDecisionFlowServer` become async around `graph.checkFlows()`. The driver takes a synchronous definition lookup for decline routing and maps pinned-frame errors. Validator caches in `decision-flow-server` and `host-desktop` compile on a `createValidatorFactory` instance that is recycled after 256 distinct compiles.

**Tech Stack:** TypeScript, `@sozai/flow-graph` 0.2.0, `@sozai/schema` 0.1.3, vitest, pnpm workspaces, turbo.

**Spec:** `docs/superpowers/specs/2026-09-30-flow-references-decline-validators-design.md`

## Global Constraints

- pnpm only (`pnpm`, `pnpm exec`), never npm/npx.
- Run repo scripts as `rtk proxy pnpm run <script>` (`build`, `lint`, `test`).
- Cross-package tests resolve `@mokei/*` from built `lib/`. Rebuild a changed dependency before testing a dependent (`pnpm exec turbo run build:types build:js --filter=<pkg>...`).
- kebab-case file names. Match surrounding code style: no semicolons, single quotes, `Array<T>`.
- Committed docs never reference local paths (`../sozai`, `/Users/`, worktrees). Say "requested upstream".
- Changeset bump level: `patch` only.
- Branch `feat/flow-references-decline-validators`. Commit after every task. Flow work (Tasks 1-9) and validator work (Tasks 10-11) are separate commits.
- Error strings copied exactly from the spec: `Duplicate registered flow id: <id>`, `Invalid registered flow <id>`, `Registered flow <id> requires elicitation`, `Flow definition changed`, `Flow no longer valid`, issue code `flow_id_conflict`.
- Validator cache limits: 256 distinct compiles per factory, 64 LRU entries.

## Review Focus

1. **Malformed `check_flow` input** (no `nodes`, non-object nodes, a reference to a malformed callee): returns issues and never throws. Test in Task 3.
2. **Decline on an `input` node inside a called flow**: routes to that callee's `decline.to`, not the root's. Test in Task 6.
3. **Registered flows referencing a later-registered flow, then the caller mutating its `flows` array**: registration succeeds, and runs and approvals use the snapshot. Tests in Tasks 2 and 5.
4. **Validator recycle while a run is suspended or in flight**: validation keeps working after the factory is disposed. Test in Task 10.
5. **Unversioned `call` reference to a registered flow**: resolves, runs and recovers, because the registry lookup accepts an omitted version. Test in Task 2 (lookup) and Task 7 (recovery).

---

### Task 1: decision-flow flow references (docs and test)

**Files:**
- Test: `packages/decision-flow/test/flow-references.test.ts` (create)
- Modify: `packages/decision-flow/README.md`

**Interfaces:**
- Consumes: `createDecisionFlowGraph({ client, resolver })` (already forwards `resolver` and `maxDepth`), `createMapResolver` from `@sozai/flow-graph`.
- Produces: nothing new.

- [ ] **Step 1: Write the tests.** Follow the fake predictor setup in `test/decision-graph.test.ts`.
  - `call runs a decide callee and exposes its output`: the root `call`s `classify` v1, whose `decide` node routes to an `end` with `output: { label: ... }`. Assert the run ends and `results.<call>.output.label` reaches the root's `end` output.
  - `goto hands over to a registered flow`: the root `goto`s `finish`. Assert the final outcome is `finish`'s outcome.
  - `loop body flow runs until while fails`: a loop with `body: { flow: 'tick', version: 1 }` and `maxIterations: 5`. Assert the iteration count from the output.
  - `resume across a callee suspension`: the callee has an `input` node. Start, persist `getState()`, then `graph.resume({ runState, event: { type: 'value', value } })` on a new graph with the same resolver. Assert it completes.
- [ ] **Step 2: Run** `pnpm --filter @mokei/decision-flow exec vitest run test/flow-references.test.ts`. Expected: PASS. No source change is needed; a failure means forwarding is broken, so fix `src/decision-graph.ts`.
- [ ] **Step 3: README.** Add a "Flow references" section: pass `resolver` (for example `createMapResolver([...])`) to `createDecisionFlowGraph`; `call`, `goto` and `loop.body.flow` need it; `resume` and `recover` require it. Keep the example short.
- [ ] **Step 4: Commit** `test(decision-flow): cover flow references`.

### Task 2: Flow registry and reachable-flow walk

**Files:**
- Create: `packages/decision-flow-server/src/registry.ts`
- Test: `packages/decision-flow-server/test/registry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FlowLookup = (id: string, version?: number) => FlowDefinition | undefined
  export type FlowRegistry = {
    flows: ReadonlyArray<FlowDefinition> // snapshots, registration order
    lookup: FlowLookup                   // version omitted or equal to the registered version
    resolver: FlowResolver               // createMapResolver over the snapshots
    digest(id: string): string | undefined
  }
  export function createFlowRegistry(flows: ReadonlyArray<FlowDefinition>): FlowRegistry
  /** Resolution for one checked or running definition: itself first, then the registry. */
  export function definitionResolution(definition: FlowDefinition, registry: FlowRegistry): {
    lookup: FlowLookup
    resolver: FlowResolver
  }
  export type ReferenceEdges = 'all' | 'goto'
  export function reachableFlows(definition: unknown, lookup: FlowLookup, edges: ReferenceEdges): Array<FlowDefinition>
  ```

- [ ] **Step 1: Write the failing tests.**
  - `snapshots definitions`: mutate the source object after `createFlowRegistry`. `lookup(id)` is unchanged, and `digest(id) === digestDefinition(original)`.
  - `rejects duplicate ids`: throws `Duplicate registered flow id: a`.
  - `lookup accepts an omitted or matching version only`: `lookup('a')` and `lookup('a', 1)` return it; `lookup('a', 2)` returns `undefined`.
  - `definitionResolution resolves the definition itself first`: a runtime definition `x` resolves `x` and registered `a`; its resolver throws for `missing`.
  - `reachableFlows follows call, goto and loop body`: `'all'` returns `[root, a, b, c]` for root→call a, a→goto b, root→loop body c. `'goto'` returns only root plus goto targets.
  - `reachableFlows terminates on cycles`: a calls b and b calls a gives two entries.
  - `reachableFlows tolerates malformed input`: `undefined`, `{}`, `{ nodes: 3 }`, and `{ nodes: { x: 5, y: { kind: 'call', flow: 7 } } }` each return an array without throwing. A root without object `nodes` returns `[]`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/decision-flow-server exec vitest run test/registry.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `registry.ts`. Snapshots use `structuredClone`. `resolver` is `createMapResolver(snapshots)`. `definitionResolution`'s resolver returns the definition for its own id (when the version matches or is omitted) and otherwise delegates to `registry.resolver`. Its lookup does the same through `registry.lookup`. The walk reads `node.kind` of `'call'`/`'goto'` with a string `flow`, and `'loop'` with an object `body` that has a string `flow`. It keys visited entries by `${id}@${version ?? ''}` of the resolved definition.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(decision-flow-server): add flow registry`.

### Task 3: Async `checkFlow` with references

**Files:**
- Modify: `packages/decision-flow-server/src/definition-checks.ts`
- Test: `packages/decision-flow-server/test/definition-checks.test.ts`

**Interfaces:**
- Consumes: Task 2 `FlowRegistry`, `definitionResolution`, `reachableFlows`, `FlowLookup`.
- Produces:
  ```ts
  export function checkFlow(params: {
    definition: unknown
    registry: FlowRegistry
    caller: ToolCaller
    predictor: Predictor | PredictorFactory
    elicitation: boolean
  }): Promise<FlowCheckResult>
  // FlowCheckResult gains: lookup: FlowLookup (root-first lookup, for startRun)
  ```

- [ ] **Step 1: Update existing tests** to `await checkFlow({ ..., registry: createFlowRegistry([]) })`. Add these failing tests:
  - `reports flow_id_conflict for a runtime definition reusing a registered id`: issue `{ code: 'flow_id_conflict', path: ['id'], severity: 'error' }`.
  - `accepts a digest-equal copy of a registered flow`: `structuredClone(registered)` gives no issues.
  - `reports missing_flow for an unknown call target`.
  - `reports callee input issues with a flows prefix`: the callee's input node without a schema gives `input_schema_not_elicitable` at `['flows', 'callee', 1, 'nodes', 'ask', 'schema']`.
  - `warns input_without_elicitation for a callee input node`.
  - `does not duplicate root warnings`: a root with one local warning gives exactly one copy.
  - `malformed definitions return issues and never throw`: `{}`, `{ nodes: 3 }`, and `{ id: 'x', version: 1, start: 'c', nodes: { c: { kind: 'call', flow: 'bad' } } }` with registered `bad` lacking `nodes`. Each resolves, `issues` is defined, and nothing rejects.
- [ ] **Step 2: Run** `pnpm --filter @mokei/decision-flow-server exec vitest run test/definition-checks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Build the resolution with `definitionResolution` only when the definition is an object with a string `id`; otherwise use `registry`.
  - `graphFor` passes the resolution's `resolver`.
  - Issue order:
    1. `flow_id_conflict`, when `registry.digest(id)` is defined and differs from `digestDefinition(definition)`.
    2. `graph.check`. If it fails, its issues; if it passes, `(await graph.checkFlows(definition))` issues and warnings.
    3. `checkInputNodes` for each flow from `reachableFlows(..., 'all')`. Callee issues get their path prefixed with `['flows', id, version]`.
    4. `input_without_elicitation` when any reached flow has an `input` node.
  - Return `lookup` on the result.
- [ ] **Step 4: Run** the same command. Expected: PASS. Tests in other files that call `checkFlow` now fail to type-check; Tasks 5-7 fix them.
- [ ] **Step 5: Commit** `feat(decision-flow-server): check flow references`.

### Task 4: Transitive `flowPlan`

**Files:**
- Modify: `packages/decision-flow-server/src/plan.ts`
- Test: `packages/decision-flow-server/test/definition-checks.test.ts` (the existing `flowPlan` test lives here)

**Interfaces:**
- Consumes: `reachableFlows`, `FlowLookup`.
- Produces: `flowPlan(definition: FlowDefinition, predictor: Predictor | PredictorFactory, lookup: FlowLookup): Array<string>`

- [ ] **Step 1: Write the failing tests.** Update the existing test to pass `createFlowRegistry([]).lookup`. Add:
  - `flowPlan includes callee tools and a callee decide predictor`: the root calls `sub`, and `sub` has tool `b:x` and a `decide` node. The result is `['a:tool', 'b:x', 'm:predict']`.
  - `flowPlan terminates on reference cycles`.
- [ ] **Step 2: Run** the definition-checks test file. Expected: FAIL.
- [ ] **Step 3: Implement.** Iterate the nodes of every flow in `reachableFlows(definition, lookup, 'all')`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(decision-flow-server): plan tools across referenced flows`.

### Task 5: Async server, `list_flows`, wiring on the registry

**Files:**
- Modify: `packages/decision-flow-server/src/server.ts`, `src/flow-tools.ts`, `src/wiring.ts`, `src/index.ts`
- Test: `packages/decision-flow-server/test/server.test.ts`, `test/wiring.test.ts`

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces:
  ```ts
  // server.ts
  export type DecisionFlowServerParams = { ...; flows?: Array<FlowDefinition>; registry?: FlowRegistry }
  export function createDecisionFlowServer(params): Promise<{ config; tools; recoveryTools; recover }>
  // flow-tools.ts
  export type FlowSummary = { id: string; name: string; version: number; input: Schema; outputs: Array<string>; outcomes: Array<string> }
  export function flowSummaries(registry: FlowRegistry): Array<FlowSummary>
  // index.ts also exports createFlowRegistry, FlowRegistry, FlowSummary
  ```
  When both are given, `registry` wins over `flows`.

- [ ] **Step 1: Write the failing tests** in `server.test.ts`. Convert the existing ones to `await` and `rejects`. Add:
  - `rejects duplicate registered ids` with `Duplicate registered flow id: a`.
  - `registered flows can reference a later-registered flow`: `flows: [caller, callee]`, with `caller` calling `callee`. It resolves.
  - `rejects a registered flow calling a missing flow`: the error message starts with `Invalid registered flow caller`.
  - `list_flows returns sorted summaries`: `outputs` and `outcomes` include the `end` nodes of a flow reached by `goto` but not by `call`. `content[0].text` has one line per flow, `<id> v<version>: <name>`.
  - `run_flow runs a definition that calls a registered flow`.

  In `wiring.test.ts`, add:
  - `elicitation guard covers callee input nodes`: registration with elicitation disabled rejects with `Registered flow root requires elicitation` when the callee has an `input` node.
  - `approval uses registry snapshots`: after `addDecisionFlow`, mutate the caller's flow tool id. The approval `flow.tools` still lists the original tool.
- [ ] **Step 2: Run** `pnpm --filter @mokei/decision-flow-server exec vitest run test/server.test.ts test/wiring.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `createDecisionFlowServer`: registry `params.registry ?? createFlowRegistry(params.flows ?? [])`. Registered-flow tools, handlers and recovery iterate `registry.flows`. Every `checkFlow` is awaited. `runFlow` becomes async.
  - Add the `list_flows` tool (input `{ type: 'object' }`, not a task tool) returning `structuredContent: { flows: flowSummaries(registry) }`.
  - `flowSummaries`: `outputs` from the `output` keys of `end` nodes over `reachableFlows(flow, registry.lookup, 'goto')`, sorted and unique; `outcomes` the same way; sort the result by `id`.
  - `wiring.ts`: build the registry once from `params.flows`. `registered` maps `flowToolName(flow.id)` over `registry.flows`. The elicitation guard checks `reachableFlows(flow, registry.lookup, 'all')`. `server = await createDecisionFlowServer({ ..., registry })`, and the `recover` guard stays. `wrapApproval` awaits `checkFlow` and calls `flowPlan(definition, predictor, checked.lookup)`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(decision-flow-server): list_flows and registry-backed server`.

### Task 6: Driver decline edge and definition-error mapping

**Files:**
- Modify: `packages/decision-flow-server/src/driver.ts`, `src/server.ts` (pass `lookup`)
- Test: `packages/decision-flow-server/test/driver-input.test.ts`, `test/driver.test.ts`

**Interfaces:**
- Consumes: `FlowCheckResult.lookup`.
- Produces: `startRun(params: { handle; graph; run; resumeData; caller; lookup: FlowLookup }): Promise<CallToolResult>`

- [ ] **Step 1: Write the failing tests.** Add `lookup` to existing `startRun` calls, using `createFlowRegistry([definition]).lookup` or the checked result's `lookup`. Keep `%s cancels the flow task`, whose node has no `decline` edge. Add:
  - `test.each(['decline', 'cancel'])('%s takes the decline edge')`: the node has `decline: { to: 'declined' }`, and `declined` is an `end` with `output: { why: { ref: ['results', 'ask', 'declined'] } }`. Assert `structuredContent.output.why === action`.
  - `a missing response counts as cancel on a decline edge`: the response map lacks the key, so `why === 'cancel'`.
  - `decline inside a callee frame uses the callee decline edge`: the root `call`s `sub`, and `sub`'s input node has the decline edge. Assert the run continues at the root's `next`.
  - `a failed lookup cancels the task`: the lookup returns `undefined` for the frame, so the task is cancelled.
  - In `driver.test.ts`, `a changed callee maps to Flow definition changed`: resume with a resolver whose callee digest differs. `startRun` rejects with an `RPCError` whose message is `Flow definition changed`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/decision-flow-server exec vitest run test/driver-input.test.ts test/driver.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `answered()`, for a response other than accept: `frame = state.frames.at(-1)`; `node = lookup(frame.flow.id, frame.flow.version)?.nodes[pending.node]`. If `node?.kind === 'input' && node.decline?.to`, return `{ type: 'decline', reason: action === 'cancel' || response === undefined ? 'cancel' : 'decline' }`. Otherwise keep today's cleanup, cancel and `stopped`.
  - Widen the event union to include `decline`.
  - Wrap `await run.next()` so that `FlowVersionMismatchError` or `FlowReferenceError` becomes `new RPCError({ code: -32603, message: 'Flow definition changed', cause: error })`.
  - Server call sites pass `lookup: checked.lookup`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(decision-flow-server): route input declines to the decline edge`.

### Task 7: Recovery on the registry with a pinned-frame check

**Files:**
- Modify: `packages/decision-flow-server/src/recovery.ts`, `src/server.ts`
- Test: `packages/decision-flow-server/test/recovery.test.ts`

**Interfaces:**
- Consumes: `FlowRegistry`, `definitionResolution`, async `checkFlow`, `startRun` with `lookup`.
- Produces: `createRecovery(params: { registry: FlowRegistry; caller; predictor; elicitation })`, replacing `flows: ReadonlyMap`.

- [ ] **Step 1: Write the failing tests.** Update the existing tests to pass `registry`. Add:
  - `recovers a run suspended in a callee frame`: a registered root calls a registered `sub` with an `input` node. Persist while suspended, recover on a new server with the same flows, answer, and the run completes.
  - `recovers an unversioned call reference`.
  - `a changed callee reports Flow definition changed`: recover with `sub` changed and the root unchanged.
  - `a removed callee reports Flow definition changed`, not `Flow no longer valid`.
  - `a still-valid root with new blocking issues reports Flow no longer valid`: the existing behaviour is kept.
- [ ] **Step 2: Run** `pnpm --filter @mokei/decision-flow-server exec vitest run test/recovery.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Root lookup: `registry.lookup(data.flow.id)` compared with `registry.digest`, replacing the `Map`.
  - After finding the root definition, run `const { lookup } = definitionResolution(root, registry)`. For every frame in `state.frames` (only when there are any), require `lookup(frame.flow.id, frame.flow.version)` to be defined and `digestDefinition(def) === frame.flow.digest`. Otherwise use the existing `Flow definition changed` path.
  - Then `await checkFlow({ ..., registry })`, and pass `lookup` to `startRun`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(decision-flow-server): recover runs with callee frames`.

### Task 8: Unconstrained `tool` result paths

**Files:**
- Modify: `packages/decision-flow-server/src/tool-node.ts:42-58`
- Test: `packages/decision-flow-server/test/tool-node.test.ts:138-148`

- [ ] **Step 1: Replace the test** with `test.each([33, 64])('accepts unschematized result references at %i segments')`, asserting no `invalid_result_path`.
- [ ] **Step 2: Run** `pnpm --filter @mokei/decision-flow-server exec vitest run test/tool-node.test.ts`. Expected: FAIL for 33 and 64.
- [ ] **Step 3: Implement.** Delete `MAX_RESULT_PATH_DEPTH`, `resultPathSchema` and their comments. `resultSchema` returns `outputSchema ?? {}`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(decision-flow-server): unconstrained tool result paths`.

### Task 9: Flow work verification, docs and integration test

**Files:**
- Modify: `integration-tests/suites/decision-flow-server.test.ts`, `packages/decision-flow-server/README.md`
- Create: `.changeset/decision-flow-references.md`

- [ ] **Step 1: Integration test** `run_flow calls a registered flow and routes a declined input`: through `NodeContextHost` (follow the file's existing setup), register `ask` with an `input` node and `decline: { to: 'declined' }`. `run_flow` a definition that `call`s `ask`. The elicitation handler declines. Assert the task result output shows `declined`.
- [ ] **Step 2: Build and run.** `pnpm exec turbo run build:types build:js --filter=@mokei/decision-flow-server...`, then `pnpm --filter mokei-integration-tests exec vitest run suites/decision-flow-server.test.ts`. Expected: PASS.
- [ ] **Step 3: README.** Document `list_flows`, references to registered flows (including the self-reference rule and `flow_id_conflict`), the `decline` edge behaviour, and that `checkFlow` and `createDecisionFlowServer` are async.
- [ ] **Step 4: Changeset.** Mark `'@mokei/decision-flow-server': patch` and `'@mokei/decision-flow': patch`. The text names the breaking changes: `checkFlow` and `createDecisionFlowServer` return promises.
- [ ] **Step 5: Full check.** Run `rtk proxy pnpm run build`, `rtk proxy pnpm run lint` and `rtk proxy pnpm run test`. Expected: all pass.
- [ ] **Step 6: Commit** `docs(decision-flow-server): flow references and decline edge`.

### Task 10: decision-flow-server validator cache

**Files:**
- Create: `packages/decision-flow-server/src/validators.ts`
- Modify: `src/tool-node.ts`, `src/predictor.ts`
- Test: `packages/decision-flow-server/test/validators.test.ts`, `test/tool-node.test.ts`

**Interfaces:**
- Produces (internal, not exported from `index.ts`):
  ```ts
  export const MAX_COMPILES = 256
  export const MAX_ENTRIES = 64
  export function canonicalJSON(value: unknown): string
  export function validatorFor(schema: Schema): Validator<unknown>
  export function validatorCacheStats(): { generation: number; compiles: number; entries: number }
  export function resetValidatorCache(): void // tests only
  ```

- [ ] **Step 1: Write the failing tests.**
  - `canonicalJSON is independent of key order`: nested objects give equal strings, and array order is kept.
  - `identical schemas reuse one validator`: `validatorFor(a) === validatorFor(structuredClone(a))` and `compiles === 1`.
  - `the 257th distinct compile recycles the factory`: after 256 distinct schemas, `generation === 0`; after the next, `generation === 1`, `compiles === 1` and `entries === 1`.
  - `a validator from a disposed factory still validates`.
  - `LRU keeps at most 64 entries`.
  - In `tool-node.test.ts`, `validation keeps working across a recycle mid-run`: start a run that suspends on a sibling task, force 256 distinct compiles, resume, and the node validates its result.
- [ ] **Step 2: Run** `pnpm --filter @mokei/decision-flow-server exec vitest run test/validators.test.ts test/tool-node.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Create the factory lazily with `createValidatorFactory()` (default options, matching today's `createValidator(schema)`).
  - `validatorFor`: on a key hit, move the entry to the most recent position. On a miss, if `compiles >= MAX_COMPILES`, then `dispose()`, create a new factory, clear the map, reset `compiles` and increment `generation`. Compile, count, and evict the oldest entry above `MAX_ENTRIES`.
  - `toolKind`: remove `validatorCache` and the three eager maps. `check` and `execute` call `validatorFor(entry.inputSchema)`, `validatorFor({ ...entry.inputSchema, required: [] })` or `validatorFor(entry.outputSchema)` at use.
  - `predictor.ts`: `validatorFor(outputSchema)`.
- [ ] **Step 4: Run** the same command, then the whole package: `pnpm --filter @mokei/decision-flow-server exec vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(decision-flow-server): recycle runtime schema validators`.

### Task 11: host-desktop validator factory, backlog and final checks

**Files:**
- Modify: `packages/host-desktop/src/form.ts:200-225`
- Test: `packages/host-desktop/test/form.test.ts`
- Modify: `docs/agents/plans/backlog/2026-09-28-decision-flow-follow-ons.md`, `2026-09-29-decision-flow-server-follow-ons.md`, `2026-09-30-host-desktop-follow-ons.md`
- Create: `.changeset/runtime-validator-recycling.md`

**Interfaces:**
- Produces (internal to `form.ts`, exported for tests): `canonicalJSON(value: unknown): string`, `formValidatorStats(): { generation: number; compiles: number; entries: number }`, `resetFormValidators(): void`.

- [ ] **Step 1: Write the failing tests** in `form.test.ts`:
  - `schemas differing only in key order share one compile`.
  - `the 257th distinct compile recycles the factory and clears the cache`.
  - `a compile error is cached and rethrown`: the existing behaviour is kept.
- [ ] **Step 2: Run** `pnpm --filter @mokei/host-desktop exec vitest run test/form.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The factory comes from `createValidatorFactory({ draft: '2020-12', strict: false })`. The key is `canonicalJSON(schema)`, and the recycle rule is the one from Task 10 (`256` / `CACHE_LIMIT`). Rewrite the comment block to describe the isolated instance and the recycling.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Backlog and changeset.**
  - Move the flow-references, input-decline, unconstrained-result-paths and AJV-scope items to their files' done sections.
  - Add two items marked requested upstream: `createValidatorCache({ maxCompiles, maxEntries })` in `@sozai/schema`, and a validator-factory option in `FlowGraphOptions` for `@sozai/flow-graph`.
  - Changeset: `'@mokei/host-desktop': patch` and `'@mokei/decision-flow-server': patch`, covering validator recycling and the per-run recompile fix.
- [ ] **Step 6: Full check.** Run `rtk proxy pnpm run build`, `rtk proxy pnpm run lint` and `rtk proxy pnpm run test`. Expected: all pass.
- [ ] **Step 7: Commit** `fix(host-desktop): recycle form validators on an isolated instance`.
