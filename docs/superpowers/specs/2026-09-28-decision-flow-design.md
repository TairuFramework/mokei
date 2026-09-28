# Decision flows — design

**Date:** 2026-09-28
**Branch:** `feat/decision-flow`
**New packages:** `@sozai/flow-graph` (sozai), `@mokei/decision-flow` (mokei)
**Changed packages:** `@sozai/async` (sozai), `@mokei/system-one-client` (mokei)

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
not. It supplies step-wise driving, abort signals, state validation and events — a usable executor
— but has no graph, branching, loop guard or expression concept, and its non-terminal `state`
value does not by itself suspend a run.

**`@mokei/system-one-client`** answers typed questions (`choice`, `score`, `noul`) with confidence,
probabilities and `act_probability`. Questions are already JSON with exported schemas, and one
`predict` call batches several questions. Helpers (`routeIntent`, presets) are single-shot: guard,
then triage, then route with a low-confidence fallback is hand-written code today. Its response
validation checks answer shapes but not answer values against the question (a `choice` outside the
declared criteria passes).

The missing layer is a JSON flow definition plus an interpreter driving `@sozai/flow`.

## Decisions

| Topic | Decision |
|---|---|
| Execution | Resumable, step-wise core plus a run-to-completion wrapper; at-least-once node execution |
| Expressions | Small filter language, flat `{ path, is }` leaf with a published truth table; operator names inspired by kubun filters |
| Values | Tagged `ref` / `value` / `object` / `array`; everything stored is a `JsonValue` |
| Shape | Flat graph of named nodes per flow; flows reference sibling flows by id (follow-on) |
| Loops | In-graph back-edges through a bounded `loop` node in v1; `loop.body: { flow }` in the follow-on |
| Suspension | Kinds with a `resume` hook may suspend with continuation data; `input` is one such kind |
| Retries | Per-node JSON `retry` policy (attempts, timeouts, backoff, suspend on long waits); policy type and delay helpers in `@sozai/async` |
| Layering | Generic engine in sozai (`@sozai/flow-graph`); mokei adds the `decide` kind |
| v1 kinds | `decide` (mokei), `branch`, `set`, `loop`, `action`, `input`, `end` |
| Deferred | `call`, `goto`, `loop.body` flow refs (storage schema only); `generate` (host action or kind); `parallel` (multi-question `decide` covers most cases) |
| Schemas | Authoring schema (executable kinds only, for LLMs) and storage schema (adds reserved shapes) |
| Integrity | Definition digest (`@noble/hashes` SHA-256 over canonical JSON) pinned per frame |
| Answer validation | In `system-one-client` `validateResult`, so every consumer benefits |
| Observability | Spans in both packages (metrics via collector connectors); one error log record per event; no payloads or error messages by default |
| IDs | `runID` from an injected `Runtime`, fallback `createRuntime().getRandomID()` |

## Work breakdown

| Piece | Repo | Spec | Order |
|---|---|---|---|
| Retry policy and helpers | sozai `@sozai/async` | `../sozai/docs/agents/plans/backlog/2026-09-28-async-retry.md` | 1 |
| Flow graph engine | sozai `@sozai/flow-graph` | `../sozai/docs/agents/plans/backlog/2026-09-28-flow-graph-package.md` | 2 |
| Answer value validation | mokei `@mokei/system-one-client` | this doc | independent, before 4 |
| `decide` kind and package | mokei `@mokei/decision-flow` | this doc | 4, after 2 is published |

The sozai pieces are implemented by a sozai agent from the backlog docs. The mokei plan may prepare
tests against an uncommitted local link, never committed.

## Engine summary (from the sozai spec)

```ts
type FlowDefinition = {
  id: string; name: string; version: number; description?: string
  input?: Schema; start: string; nodes: Record<string, Node>
}
type Path = Array<string>             // root: input | state | results | loops; missing -> null
type Value = { ref: Path } | { value: JsonValue } | { object: Record<string, Value> } | { array: Value[] }
type Filter = { path: Path; is: ValueFilter } | { and: Filter[] } | { or: Filter[] } | { not: Filter }
```

Kinds register through `NodeKind`: `kind`, `schema`, `targets`, `resultSchema?` (static, closed),
`retries?`, `describeError?`, `check?`, `execute`, `resume?`, `retryable?`. `execute` receives
`resolve` and `evaluate` (both seeing staged writes), staged `setResult`, `invocationID`,
`attempt`, the active `flow.node` span, `logger`, `runtime` and an attempt-scoped `signal`.
Attempts run through `raceAttempt` (`@sozai/async`), so timeouts hold even when a call ignores its
signal. A transition commits atomically; `next` must be a declared target.

`RunState` is plain JSON: `runID`, `revision`, `status`, `steps`, `inFlight`, a frame stack
(length 1 in v1) with per-frame `input`/`state`/`results`/`loops`/`invocation`/`attempts` (policy
snapshot, count, interruptions, absolute deadline, committed `retryAt`, message-free last failure)
and pinned `{ id, version, digest }`, `pending` (`reason: 'suspend' | 'retry'`, `data`,
`deadline`, `resumeAt`), `outcome`, `output`, message-free `error`, and `origin.traceparent`. A
status matrix defines which fields each status allows. Timestamps are canonical UTC; all time
decisions use an injectable `now`. `FlowRun` yields entry, attempt-checkpoint, transition,
failure-with-disposition and suspend commits; hosts persist them with optimistic concurrency on
`revision`; actions dedupe on `invocationID`, fixed per node entry. `recover` replays an
interrupted attempt without consuming `maxAttempts` (bounded by `maxInterruptions`).

The engine is the only failure logger; kinds contribute safe fields through `describeError`.

API: `createFlowGraph`, `graph.authoringSchema`, `graph.storageSchema`, `runStateSchema`,
`graph.check`, `graph.start`, `graph.resume` (`value` / `timeout` / `retry` events, with deadline
rules), `graph.recover` (crashed `running` states), `graph.run`, `formatIssues`, `toTimestamp`,
`FlowRetryableError`.

## Prerequisite: answer value validation in `system-one-client`

`validateResult` today validates answer shapes only. Extend it to validate each answer against its
question, raising `SystemOneResponseError` with issues:

- `choice`: `choice` is a key of the question's `criteria`; `probabilities` keys are criteria keys.
- `score`: when `legend.min` and `legend.max` are numbers, `score` lies within them.
- `noul`: `noul` in [0, 1].
- All types: `confidence`, `action.act_probability` and every `probabilities` value in [0, 1], and
  finite.

Tests cover each rule, including a backend returning an undeclared choice. This is a behaviour
change for existing consumers (a previously accepted bad answer now throws); it ships with a
release intent noting it.

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
  retry?: FlowRetryPolicy
}
```

**Execute.** Resolve `state`. System One accepts only a string, object or array: any other
resolved value (`null`, boolean, number) fails the node with code `invalid_state`, not retryable;
the checker also rejects a literal `{ value }` state of those types. Call
`client.predict({ state, questions, model, signal })`. Answers are value-validated by the client
(see prerequisite). Then one `setResult` call writes answers **flat** under the node —
`results.<id>.<questionKey>` — together with call metadata under `results.<id>.$meta`
(`{ model, usage }`). Then evaluate `cases` in order (`evaluate` sees the staged result), first
match wins, else `default`. Flat answers keep LLM-written paths short:

```json
{ "when": { "path": ["results", "triage", "department", "choice"], "is": { "equalTo": "billing" } }, "to": "billing" }
```

**`resultSchema`.** A closed schema built from the question map, separate from the client's open
answer schemas (which allow extra fields):

| Question type | Referenceable fields |
|---|---|
| `choice` | `choice`, `confidence`, `probabilities.<criteriaKey>`, `action.act_probability` |
| `score` | `score`, `confidence`, `legend` (open: backend-defined), `probabilities` (open: keys are score values), `action.act_probability` |
| `noul` | `noul`, `confidence`, `action.act_probability` |

Plus `$meta.model`, `$meta.usage.inputTokens`, `$meta.usage.outputTokens`. Every object is
`additionalProperties: false` except the two marked open. Extra fields a backend adds are kept in
the result at runtime but cannot be referenced by flows. The engine's cross-node
`invalid_result_path` check then covers reads of `decide` results from any node.

**Check** (kind hook, on top of schema and result-path validation):

- `questions` valid per `questionMapSchema`; no question key named `$meta`.
- Comparisons on a `choice` field (`equalTo`, `notEqualTo`, `in`, `notIn`) use declared criteria
  keys, wherever the filter appears.
- Comparisons on `noul`, `confidence`, `act_probability` and probabilities use numbers in [0, 1].
- A literal `{ value }` state is a string, object or array.

**Retries.** `retries: true`. `retryable(error)` is decided by status, because the HTTP backend
maps every unmapped non-2xx status (including a plain 400) to `SystemOneConnectionError`:

- Retryable: `SystemOneConnectionError` with no `status` (backend not reached), or with status
  408, 429, 500, 502, 503, 504 or 529. This covers `SystemOneRateLimitError` (429) and
  `SystemOneOverloadedError` (529). Returns `{ afterMs: retryAfterMs }` when the error carries one,
  else `true`.
- Not retryable: any other status, and `SystemOneInputError`, `SystemOneAuthError`,
  `SystemOneModelError`, `SystemOneResponseError`, `invalid_state`.
- Attempt timeouts are retryable (engine rule). A sensible default is set through `retryDefaults.decide` in
`createDecisionFlowGraph` (3 attempts, 10 s per attempt, backoff from 500 ms, jitter,
`suspendAfterMs: 30000`), overridable per node.

**`describeError(error)`.** Returns `ErrorMetadata`: `type` (System One error class name, or
`invalid_state`), `status` when present, `retryAfterMs` when present. Never the message. The engine
uses it for `lastFailure`, its log records and span attributes.

**Errors.** After retries: `onError` if set, else run `error` with code `node_failed`, recording the
System One error class and `status` through `describeError`.

**Construction.**

```ts
const graph = createDecisionFlowGraph({
  client,                     // SystemOneClient
  actions?, kinds?, retryDefaults?, maxSteps?, runtime?, logger?,
  recordErrorMessages?, random?, now?,
  resolver?,                  // forwarded; follow-on
})
```

registers `decideKind({ client })` on `createFlowGraph`, merges the default `decide` retry policy
under the caller's `retryDefaults`, and defaults the engine `logger` to
`getMokeiLogger('decision-flow')`. `decideKind` is also exported for hosts that compose kinds
themselves.

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
      "onError": "technical",
      "retry": { "maxAttempts": 3, "attemptTimeoutMs": 5000, "backoff": { "initialMs": 500, "jitter": true } }
    },
    "ask": {
      "kind": "input",
      "prompt": { "value": "Which team should handle this?" },
      "schema": { "enum": ["billing", "technical"] },
      "timeout": { "afterMs": 86400000, "to": "technical" },
      "next": "route"
    },
    "route": {
      "kind": "branch",
      "cases": [{ "when": { "path": ["results", "ask"], "is": { "equalTo": "billing" } }, "to": "billing" }],
      "default": "technical"
    },
    "billing": {
      "kind": "action", "name": "createTicket",
      "args": { "ticket": { "object": { "team": { "value": "billing" }, "message": { "ref": ["input", "message"] } } } },
      "next": "done"
    },
    "technical": {
      "kind": "action", "name": "createTicket",
      "args": { "ticket": { "object": { "team": { "value": "technical" }, "message": { "ref": ["input", "message"] } } } },
      "next": "done"
    },
    "reject": { "kind": "end", "outcome": "rejected" },
    "done": { "kind": "end", "outcome": "routed" }
  }
}
```

## LLM authoring support

- `flowDefinitionSchema`: the composed **authoring** schema (engine plus `decide`), executable kinds
  only, with a `description` on every field and examples, suitable to hand a model directly.
  `flowStorageSchema` is exported separately for persistence.
- `formatIssues` re-exported: compact issue text (`path`, `code`, `message`, `hint`) for a repair loop.

## Observability

Engine spans (`flow.segment`, `flow.node` per attempt), segment parenting and origin links, the
metric dimension policy and the privacy rules are specified in the sozai doc. Mokei complements
them.

Tracer: `createTracerFactory('mokei', <package version>)('decision-flow')`.

- **`decision.predict` span**, child of `flow.node`, wrapping the `predict` call:
  `system_one.model`, `system_one.question.count`, `system_one.usage.input_tokens`,
  `system_one.usage.output_tokens`; on failure, status `ERROR`, `error.type` (error class),
  `http.status_code` when present, `system_one.retry_after_ms` when present.
- **One span event per question** on the `flow.node` span, `decision.answer`, with fixed attribute
  names: `decision.question` (the question key), `decision.type`, `decision.choice` / `decision.score`
  / `decision.noul`, `decision.confidence`. No dynamic attribute names.
- Choice labels are bounded by declared criteria, which `validateResult` now enforces, so
  `decision.choice` is a safe dimension. `decision.question` is safe when definitions are curated;
  for LLM-generated flows the collector should map or drop it.
- Derived metrics: decision distribution per flow, node and question (`count` connector on
  `decision.answer`); confidence distribution; low-confidence fallback rate (from
  `flow.branch.case`); predict latency, tokens and retries (`spanmetrics` on `decision.predict`).
- **Privacy:** never record the resolved System One `state`, question instructions, criteria
  descriptions, input, state or results payloads. Error messages only when the host sets
  `recordErrorMessages: true` (forwarded to the engine).

Logging: the engine is the only failure logger (it alone knows whether a failure is retried,
handled or unhandled). `createDecisionFlowGraph` defaults the engine's `logger` to
`getMokeiLogger('decision-flow')`, so `decide` failures land under the `mokei` category: `warn`
per retried attempt and per `onError`-handled failure, `error` when the run fails. Records carry
`describeError`'s System One class, `status` and `retryAfterMs`, never the error object or its
message unless `recordErrorMessages` is true. The engine applies `traceLogger` per record inside
the active span, so records carry the node span's trace and span IDs. `decide` itself does not
log.

Spans follow the engine rule: `decision.predict` is started with the tracer directly, not
`withSpan`, so no exception message is recorded by default.

## Testing

- `validateResult` (client): each value rule, including an undeclared choice.
- `decide` against a fake `SystemOneBackend`: answers stored flat, `$meta`, case selection,
  `default`, `onError`, each System One error class, retry with `retryAfterMs`, a 400 not retried,
  408/5xx retried, attempt timeout on a hanging backend, suspend on a long rate-limit wait and
  resume with a `retry` event, `invalid_state` for a resolved number or `null`.
- `resultSchema`: cross-node read of an undeclared question key, an extra backend field, or a
  `probabilities` key outside the criteria rejected; `legend.*` accepted.
- Checker hook: unknown choice label anywhere, out-of-range numbers, `$meta` key.
- The triage example end to end, including suspend at `ask`, JSON round-trip, `value` and `timeout`
  resumes.
- `flowDefinitionSchema` snapshot; the example validates against it; a `call` node does not.
- Tracing: in-memory exporter asserting `decision.predict` under `flow.node`, `decision.answer`
  events with fixed attribute names, and no payload or message leakage by default. Logging: logtape
  test sink asserting one record per event under `mokei.decision-flow`, carrying `describeError`
  fields and the node span's trace IDs.
- `describeError`: each System One error class maps to type, status and `retryAfterMs`; no message.
- Type tests on the public API.

## Follow-on

- Flow references (`call`, `goto`, `loop.body: { flow }`, `FlowResolver`) — engine side in sozai;
  mokei already forwards `resolver`.
- MCP `check_flow` / `run_flow` tools.
- `AgentSession` integration (flows gating or routing turns).
- `system-one-client` HTTP backend adopting `@sozai/async` `retry()` with `retryAfterMs`.
