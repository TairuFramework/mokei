# Flow references, input decline and isolated validators

Date: 2026-09-30
Status: approved design, pending implementation plan

## Goal

`@sozai/flow-graph` 0.2.0 and `@sozai/schema` 0.1.3 unblock four backlog items. This work ships
them in one PR:

1. Flow references (`call`, `goto`, flow-body `loop`) in `@mokei/decision-flow` and
   `@mokei/decision-flow-server`, with a `list_flows` discovery tool.
2. An `input` node `decline` edge in `@mokei/decision-flow-server`.
3. Unconstrained `tool` result paths in `@mokei/decision-flow-server`.
4. Isolated, recycled AJV instances for runtime schemas in `@mokei/host-desktop` and
   `@mokei/decision-flow-server`.

Backlog sources: `docs/agents/plans/backlog/2026-09-28-decision-flow-follow-ons.md` (flow
references), `docs/agents/plans/backlog/2026-09-29-decision-flow-server-follow-ons.md` (decline
edge, unconstrained result paths) and `docs/agents/plans/backlog/2026-09-30-host-desktop-follow-ons.md`
(AJV scope growth).

## Decisions

| Question | Decision |
| --- | --- |
| Which flows can a runtime definition reference? | Registered server flows only. No flows are supplied with a call. |
| Discovery | A new `list_flows` tool returns flow summaries. |
| Versions per registered flow `id` | One. A duplicate `id` throws at registration. |
| Decline on an `input` node without a `decline` edge | Unchanged: the task is cancelled. |
| Depth bound on unschematized `tool` results | Removed. Any depth is accepted. |
| Validator recycling | One factory per process. Recycle after 256 distinct compiles. |

## 1. Flow references

### Registry

`createDecisionFlowServer` builds one registry from `params.flows`:

- A duplicate `id` throws `Error('Duplicate registered flow id: <id>')`. This check runs before the
  existing `flow_<id>` tool-name collision check.
- Each entry stores a JSON snapshot of the definition (`structuredClone`) and its
  `digestDefinition` digest, both taken at registration. Later mutation of the caller's object has
  no effect.
- The registry exposes a synchronous `lookup(id, version?) => FlowDefinition | undefined` and a
  `FlowResolver` built with `createMapResolver` over the snapshots.

### Resolver per definition

`checkFlow` takes the registry. The resolver for a checked or running definition `D` resolves in
this order:

1. `D.id`, with the version matching `D.version` or omitted: return `D`. A runtime definition may
   therefore reference itself. flow-graph reports a `goto`-only self cycle as `unbounded_cycle` and
   a `call` self cycle as a `recursive_call` warning bounded by `maxDepth`.
2. Any other reference: delegate to the registered resolver. A runtime definition never supplies
   other flows.

A runtime definition (`run_flow`, `check_flow`) whose `id` equals a registered flow's `id` is
rejected with the error issue `flow_id_conflict` at path `['id']`, unless its digest equals the
registered digest. A digest-equal copy is the registered flow, so it is accepted.

### Checks

`checkFlow` becomes async, because `graph.checkFlows()` is async:

1. Run `graph.check(definition)`. If it fails, its issues are the graph issues.
2. Otherwise run `graph.checkFlows(definition)` and use its result as the graph issues. It already
   contains the root's local warnings, so the step 1 warnings are dropped. Issues inside a callee
   keep flow-graph's `['flows', id, version, ...]` path prefix.
3. Append the mokei checks once: `checkInputNodes` and the `input_without_elicitation` warning.
   Both apply to every flow reachable from the definition (the walk below), not only the root.
   Callee issues use the same `['flows', id, version, ...]` prefix.

Every caller awaits `checkFlow`: `check_flow`, `run_flow`, registered flow tools, registration,
recovery and `wrapApproval`.

### Reachable flows

One helper, `reachableFlows(definition, lookup)`, returns the definition plus every flow reachable
through `call`, `goto` and `loop.body.flow`, tracking visited `(id, version)` pairs so cycles
terminate. Unresolved references are skipped: `checkFlow` reports them as `missing_flow`, and a
flow with blocking issues never runs. `checkFlow`, `flowPlan`, the elicitation guard and
`list_flows` share it.

### Registration

Registration checks each flow after the whole registry exists, so flows can reference each other
regardless of array order. A flow with blocking issues throws `Invalid registered flow <id>`.

`createDecisionFlowServer` becomes async and returns a promise of the same object. Callers change:

- `wiring.ts` creates the server with `await`. The task manager's `recover` callback, which today
  throws `Flow server unavailable during recovery` while `server` is unset, instead awaits a
  promise of the server, so a recovery that fires during creation waits rather than fails. If
  creation rejects, that promise rejects and recovery rejects with the creation error.
- The `wiring.ts` elicitation guard (`Registered flow <id> requires elicitation`) checks input nodes
  across `reachableFlows`, not only the root.
- Tests that expect a synchronous result or a synchronous throw use `await` and `rejects`.

### Plan and approvals

`flowPlan(definition, predictor, lookup)` collects over `reachableFlows`: the sorted, unique set of
`tool` ids, plus the predictor tool when any reached flow has a `decide` node. `wrapApproval` in
`wiring.ts` and the approval hook therefore see callee tools, and the per-run `approved` set covers
them.

### Run, resume and recovery

- `graphFor` passes the per-definition resolver to `createDecisionFlowGraph`.
  `@mokei/decision-flow` already forwards `resolver` and `maxDepth`; no API change there.
- `resumeData` is unchanged (`v: 1`). Ad-hoc runs still store `{ definition }` and registered runs
  `{ id, digest }`. flow-graph pins callee frames in `runState.frames`.
- `startRun` takes a `lookup(id, version) => FlowDefinition | undefined` (the per-definition
  resolution above, synchronous) for the decline lookup in section 2.
- Frame resolution happens inside the lazy run's `next()` and inside `graph.resume()`. `startRun`
  catches `FlowVersionMismatchError` and `FlowReferenceError` wherever it advances or resumes a run
  and maps both to `RPCError({ code: -32603, message: 'Flow definition changed' })`.
- Recovery (`createRecovery`) takes the registry instead of its `Map<string, FlowDefinition>`. The
  root lookup and digest check stay. Before calling `checkFlow`, recovery checks every frame in
  `state.frames`: the frame's `flow.id` and `flow.version` must resolve, and the digest must equal
  `flow.digest`. A miss or mismatch returns `Flow definition changed`. Only then does `checkFlow`
  run, and its blocking issues still return `Flow no longer valid`. A removed callee therefore
  reports `Flow definition changed`, not a `missing_flow` check failure.

### `list_flows`

A new tool on `createDecisionFlowServer`, so `wiring.ts` exposes it with the other server tools:

- Input schema `{ type: 'object' }`. Not a task tool. `wrapApproval` does not gate it, like
  `check_flow`.
- Output: `{ flows: Array<{ id, name, version, input, outputs, outcomes }> }`, sorted by `id`.
  - `input`: `flowInputSchema(flow)`.
  - `outputs`: sorted union of the `output` keys of every `end` node in the flow and in every flow
    reachable from it through `goto` only. These are the keys a caller can read at
    `results.<call>.output`, matching the flow-graph `invalid_result_path` check.
  - `outcomes`: sorted unique `outcome` values over the same `end` nodes.
- `content` is a short text list, one line per flow: `<id> v<version>: <name>`.

### `@mokei/decision-flow`

No source change. Add a README section on flow references (a resolver passed to
`createDecisionFlowGraph`, `resume` and `recover` requiring it) and a test that runs a `call` into a
flow containing a `decide` node, a `goto`, and a flow-body `loop`.

## 2. Input decline

In `driver.ts`, `answered()` handles a response whose `action` is not `accept`:

1. Resolve the pending node: the last frame in `state.frames` gives `flow.id` and `flow.version`,
   the `lookup` passed to `startRun` gives the definition, and `pending.node` gives the node. The
   active frame can be a callee. If the lookup fails, the run takes step 3 (cancel).
2. If that node has `kind: 'input'` and a `decline.to`, return
   `{ type: 'decline', reason: action === 'cancel' ? 'cancel' : 'decline' }`, and the run resumes
   through `graph.resume`. flow-graph routes to `decline.to` with
   `results.<input> = { declined: reason }`.
3. Otherwise keep today's behaviour: `cleanup()`, `handle.cancel()`, return `stopped`.

A missing response (`responses[key]` undefined) counts as `cancel`.

`checkInputNodes` needs no change: flow-graph's authoring schema and checker validate the
`decline` edge. The `tool` kind's decline guard in `tool-node.ts` stays.

## 3. Unconstrained result paths

In `tool-node.ts`:

- Delete `MAX_RESULT_PATH_DEPTH` and `resultPathSchema` with their comments.
- The result schema for a tool without an `outputSchema` becomes `{}`. flow-graph 0.2.0 treats an
  annotation-only schema as unconstrained and accepts any deeper path.
- Tools with an `outputSchema` are still checked against it.

The test `bounds unschematized result references at %i segments` becomes
`accepts unschematized result references at any depth`, asserting no `invalid_result_path` at 33
and 64 segments.

## 4. Isolated, recycled validators

The shared `createValidator` in `@sozai/schema` compiles on one AJV instance per option set.
AJV's code-gen scope keeps every compiled function for the life of the process (about 7-9 KB per
compile). `createValidatorFactory` (0.1.3) owns an isolated instance, and `dispose()` releases it.
Validators already returned keep working and keep their instance alive until collected.

### Pattern

Each package gets a module-private cache:

- A current factory, created lazily with the package's validator options.
- A `Map` LRU of validators (or compile errors, where the package caches those) keyed by the
  canonical JSON of the schema. Canonical JSON sorts object keys recursively.
- A counter of distinct compiles on the current factory. When it reaches 256, the next compile
  first calls `dispose()`, creates a new factory, clears the LRU and resets the counter.
- LRU capacity: 64 entries, least recently used evicted first.

No shared package is created. The two copies are small. A reusable
`createValidatorCache({ maxCompiles, maxEntries })` in `@sozai/schema` goes in the backlog as
requested upstream.

### `@mokei/host-desktop`

`src/form.ts` replaces `createValidator(schema, { draft: '2020-12', strict: false })` with the
cache above, using a factory created with `{ draft: '2020-12', strict: false }`. The existing
64-entry LRU keyed by canonical JSON stays; the change adds the factory and the recycle step, and
updates the comment block that describes the shared instance.

### `@mokei/decision-flow-server`

A new `src/validators.ts` exports `validatorFor(schema: Schema): Validator<unknown>`, backed by
the cache with the package's current options (the default `createValidator` options).

- `tool-node.ts`: `toolKind` drops its per-run `validatorCache` and calls `validatorFor` for the
  input, mixed-input (`{ ...inputSchema, required: [] }`) and output validators. This also fixes a
  leak: the mixed-input spread is a new object on every run, so today each run recompiles every
  catalogued tool's schema on the shared instance.
- `predictor.ts`: calls `validatorFor(outputSchema)` instead of `createValidator(outputSchema)` for
  every prediction.

flow-graph compiles node and input schemas on its own shared instance, which mokei cannot reach.
A `FlowGraphOptions` validator-factory option goes in the backlog as requested upstream.

## Error handling summary

| Situation | Result |
| --- | --- |
| Duplicate registered `id` | `createDecisionFlowServer` rejects. |
| Registered flow references a missing flow | `Invalid registered flow <id>` with `missing_flow`. |
| Runtime definition reuses a registered `id` | `flow_id_conflict` error issue. |
| Runtime definition references a missing flow | `missing_flow` error issue; `run_flow` returns it as an error result. |
| Callee changed before recovery or resume | `Flow definition changed`. |
| Decline on `input` with `decline.to` | Run continues at `decline.to`. |
| Decline on `input` without `decline.to` | Task cancelled (unchanged). |

## Testing

- `decision-flow`: a flow reference suite (`call` into a `decide` flow, `goto`, flow-body `loop`)
  with `createMapResolver`, plus resume across a callee suspension.
- `decision-flow-server`:
  - `definition-checks`: `flow_id_conflict`, `missing_flow`, callee input-node issues, a registered
    flow referencing a later-registered flow.
  - `plan`: transitive tools, predictor tool from a callee `decide`, cycle termination.
  - `server`: duplicate id rejection, `list_flows` output, `run_flow` calling a registered flow.
  - `driver`: decline and cancel with a `decline` edge resume the run; without the edge the task is
    cancelled; a missing response counts as cancel.
  - `recovery`: a suspended callee frame recovers; a changed callee maps to
    `Flow definition changed`.
  - `tool-node`: unconstrained result paths at any depth.
  - `validators`: identical canonical schemas reuse one validator; the 257th distinct compile
    disposes the factory and clears the cache; a validator from a disposed factory still validates.
- `host-desktop`: the same recycle assertions through `form.ts`.
- `integration-tests`: `run_flow` through `NodeContextHost` calling a registered flow that asks for
  input, declined through the elicitation handler and routed to `decline.to`.

## Delivery

- Branch `feat/flow-references-decline-validators`, one PR.
- One changeset with a patch bump for the fixed group.
- Backlog updates: move the three flow items and the AJV item to done, and add the two upstream
  asks (`createValidatorCache` in `@sozai/schema`, a validator-factory option in
  `@sozai/flow-graph`).
- Package READMEs: `decision-flow` (flow references), `decision-flow-server` (`list_flows`,
  registered flow references, decline edge), `host-desktop` (validator recycling note if the README
  mentions validation).
