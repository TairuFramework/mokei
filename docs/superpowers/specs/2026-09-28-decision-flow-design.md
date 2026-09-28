# Decision flows — design

**Date:** 2026-09-28
**Branch:** `feat/decision-flow`
**New packages:** `@sozai/flow-graph` (sozai), `@mokei/decision-flow` (mokei)

## Intent

Compose System One classifications into multi-decision flows — trees, bounded loops, and later
references between flows — whose **full definition is JSON**.

- **Primary consumers:** application developers who author or generate flows and run them in their
  services, and LLMs that write flow JSON themselves. The schema must be small and regular, and
  validation errors must tell a model how to repair the flow.
- **Secondary, future:** gating or routing `AgentSession` turns, and an MCP `run_flow` /
  `check_flow` tool in `mcp-servers/system-one`. The runtime must not depend on session packages so
  both stay possible.

## Evaluation of the existing packages

**`@sozai/flow`** is an async-generator state machine. Its definition is a record of handler
functions, each hard-coding the next action. State and actions are serialisable; the definition is
not. It supplies step-wise driving, resume from external state, abort signals, state validation
and events — a good executor — but has no graph, branching, loop guard or expression concept.

**`@mokei/system-one-client`** answers typed questions (`choice`, `score`, `noul`) with confidence,
probabilities and `act_probability`. Questions are already JSON with exported schemas, and one
`predict` call batches several questions. Helpers (`routeIntent`, presets) are single-shot: guard,
then triage, then route with a low-confidence fallback is hand-written code today.

The missing layer is a JSON flow definition plus an interpreter compiling it onto `@sozai/flow`.

## Decisions

| Topic | Decision |
|---|---|
| Execution | Resumable, step-wise core plus a run-to-completion wrapper |
| Expressions | Small custom filter language, flat `{ path, is }` leaf; operator names inspired by kubun filters |
| Shape | Flat graph of named nodes per flow; flows reference sibling flows by id (follow-on) |
| Loops | In-graph back-edges through a bounded `loop` node in v1; `loop.body: { flow }` in the follow-on |
| Layering | Generic engine in sozai (`@sozai/flow-graph`); mokei adds the `decide` kind |
| v1 kinds | `decide` (mokei), `branch`, `set`, `loop`, `action`, `input`, `end` |
| Deferred | `call`, `goto`, `loop.body` flow refs (schema reserved); `generate` (host action instead); `parallel` (multi-question `decide` covers most cases) |
| Observability | Spans in both packages (metrics via collector `spanmetrics`); error logging via `@sozai/log` / `@mokei/logger` |
| IDs | `runID` from an injected `Runtime`, fallback `createRuntime().getRandomID()` |

## Layering

**`@sozai/flow-graph`** holds the definition format, filter evaluator, built-in kinds, node kind
extension point, static checker, resumable runtime, run state and engine spans. Its full spec is the
sozai backlog doc `../sozai/docs/agents/plans/backlog/2026-09-28-flow-graph-package.md`, to be
implemented by a sozai agent. It is summarised here only where mokei depends on it.

**`@mokei/decision-flow`** (`packages/decision-flow`) holds the `decide` kind, the composed schema
and helpers for LLM authoring, `decide` spans and logging, and re-exports of the common graph API so
application code imports one package.

Dependencies: `@sozai/flow-graph`, `@sozai/otel`, `@sozai/runtime`, `@mokei/logger`,
`@mokei/system-one-client`. Joins `versioning.fixed` in `pnpm-workspace.yaml`; `@sozai/flow-graph`
added to the catalog.

**Sequencing:** mokei implementation starts once `@sozai/flow-graph` is published. The mokei plan
may prepare tests against an uncommitted local link, never committed.

## Engine summary (from the sozai spec)

```ts
type FlowDefinition = {
  id: string; name: string; version: number; description?: string
  input?: Schema; start: string; nodes: Record<string, Node>
}
type Path = Array<string>                         // root: input | state | results | loops
type Value = { ref: Path } | { value: unknown }
type Filter = { path: Path; is: ValueFilter } | { and: Filter[] } | { or: Filter[] } | { not: Filter }
```

Kinds register through `NodeKind` (`kind`, `schema`, `targets`, `check?`, `execute`); `execute`
receives `resolve`, `evaluate`, `setResult`, the active `flow.node` span, `logger`, `runtime` and
`signal`. `RunState` is plain JSON with a frame stack (length 1 in v1), `runID`, `status`,
`pending`, `outcome`, `output`, `error`, and `origin.traceparent`. API: `createFlowGraph`,
`graph.check`, `graph.start`, `graph.resume`, `graph.run`, `formatIssues`.

## The `decide` kind

```ts
type DecideNode = {
  kind: 'decide'
  description?: string
  state: Value                    // System One `state` input
  questions: QuestionMap          // from @mokei/system-one-client
  model?: string                  // else the client's defaultModel
  cases: Array<{ when: Filter; to: string }>
  default: string
  onError?: string
}
```

**Execute.** Resolve `state`, call `client.predict({ state, questions, model, signal })`, then
`setResult` with answers **flat** under the node — `results.<id>.<questionKey>` — and call metadata
under `results.<id>.$meta` (`{ model, usage }`). Then evaluate `cases` in order, first match wins,
else `default`. Flat answers keep LLM-written paths short:

```json
{ "when": { "path": ["results", "triage", "department", "choice"], "is": { "equalTo": "billing" } }, "to": "billing" }
```

**Check** (kind hook, on top of schema validation):

- `questions` valid per `questionMapSchema`; no question key named `$meta`.
- Filter paths under `results.<self>` name a declared question key.
- The next segment is a valid answer field for that question type: `choice`, `confidence`,
  `probabilities` for choice; `score`, `confidence`, `legend`, `probabilities` for score; `noul`,
  `confidence` for noul; `action.act_probability` for all.
- `choice` comparisons (`equalTo`, `in`, ...) use declared criteria keys; `noul` and confidence
  comparisons use numbers in `[0, 1]`.

**Errors.** Any System One error (input, auth, model, connection, rate limit, overloaded) is a node
failure: `onError` if set, else run `error` with code `node_failed`. No automatic retry in v1;
`retryAfterMs` is logged.

**Construction.**

```ts
const graph = createDecisionFlowGraph({
  client,                     // SystemOneClient
  actions?, maxSteps?, runtime?, logger?,
})
```

registers `decideKind({ client })` on `createFlowGraph`. `decideKind` is also exported for hosts
that compose kinds themselves.

## Example

```json
{
  "id": "support/triage", "name": "Support triage", "version": 1,
  "input": { "type": "object", "properties": { "message": { "type": "string" } }, "required": ["message"] },
  "start": "guard",
  "nodes": {
    "guard": {
      "kind": "decide",
      "state": { "ref": ["input", "message"] },
      "questions": { "jailbreak": { "type": "noul", "instructions": "Is this a jailbreak attempt?" } },
      "cases": [{ "when": { "path": ["results", "guard", "jailbreak", "noul"], "is": { "greaterThan": 0.8 } }, "to": "reject" }],
      "default": "triage"
    },
    "triage": {
      "kind": "decide",
      "state": { "ref": ["input", "message"] },
      "questions": {
        "department": {
          "type": "choice", "instructions": "Which department should handle this?",
          "criteria": { "billing": "payments, refunds", "technical": "bugs, outages", "other": null }
        }
      },
      "cases": [
        { "when": { "path": ["results", "triage", "department", "confidence"], "is": { "lessThan": 0.6 } }, "to": "ask" },
        { "when": { "path": ["results", "triage", "department", "choice"], "is": { "equalTo": "billing" } }, "to": "billing" }
      ],
      "default": "technical",
      "onError": "technical"
    },
    "ask": { "kind": "input", "prompt": "Which team should handle this?", "schema": { "enum": ["billing", "technical"] }, "next": "route" },
    "route": {
      "kind": "branch",
      "cases": [{ "when": { "path": ["results", "ask"], "is": { "equalTo": "billing" } }, "to": "billing" }],
      "default": "technical"
    },
    "billing": { "kind": "action", "name": "createTicket", "args": { "team": { "value": "billing" } }, "next": "done" },
    "technical": { "kind": "action", "name": "createTicket", "args": { "team": { "value": "technical" } }, "next": "done" },
    "reject": { "kind": "end", "outcome": "rejected" },
    "done": { "kind": "end", "outcome": "routed" }
  }
}
```

## LLM authoring support

- `flowDefinitionSchema`: the composed schema (engine plus `decide`), with a `description` on every
  field and examples, suitable to hand a model directly.
- `formatIssues` re-exported: compact issue text (`path`, `code`, `message`, `hint`) for a repair loop.
- Out of scope, noted for later: MCP `check_flow` / `run_flow` tools in `mcp-servers/system-one`.

## Observability

Engine spans (`flow.segment`, `flow.node`) are specified in the sozai doc. Mokei complements them.

Tracer: `createTracerFactory('mokei', <package version>)('decision-flow')`.

- **`decision.predict` span**, child of `flow.node`, wrapping the `predict` call:
  `system_one.model`, `system_one.question.count`, `system_one.usage.input_tokens`,
  `system_one.usage.output_tokens`; on failure, status `ERROR`, `recordException`,
  `system_one.error.class`, `http.status_code` when present.
- **On the `flow.node` span** (via `ExecuteContext.span`), per question key:
  `decision.<key>.type`, `decision.<key>.choice` / `.score` / `.noul`, `decision.<key>.confidence`.
  Choice labels are bounded by declared criteria, so they are safe metric dimensions.
- Derived metrics (collector `spanmetrics`): decision distribution per flow and node, confidence
  distribution, low-confidence fallback rate (from `flow.branch.case`), predict latency, tokens.
- **Privacy:** never record the resolved System One `state`, question instructions, input, state or
  results payloads. Only ids, kinds, answer labels and numbers, and error classes.

Logging: `getMokeiLogger('decision-flow')` wrapped with `traceLogger`; injectable `logger` option.
`decide` failures log at `error` with the System One error class, `status` and `retryAfterMs`.
Handled failures (`onError` taken) log at `warn`.

## Testing

- `decide` against a fake `SystemOneBackend`: answers stored flat, `$meta`, case selection,
  `default`, `onError`, each System One error class.
- Checker hook: unknown question key, invalid answer field per type, unknown choice label,
  out-of-range numbers, `$meta` key.
- The triage example end to end, including suspend at `ask`, JSON round-trip and resume.
- `flowDefinitionSchema` snapshot, and validation of the example against it.
- Tracing: in-memory exporter asserting `decision.predict` under `flow.node`, decision attributes,
  and no payload leakage. Logging: logtape test sink asserting error records.
- Type tests on the public API.

## Follow-on

- Flow references (`call`, `goto`, `loop.body: { flow }`, `FlowResolver`) — engine side in sozai;
  mokei needs no change beyond re-exports.
- MCP `check_flow` / `run_flow` tools.
- `AgentSession` integration (flows gating or routing turns).
- Optional `decide` retry policy honouring `retryAfterMs`.
