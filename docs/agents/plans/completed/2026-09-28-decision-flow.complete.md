# Decision flows

**Status:** complete (2026-09-28)
**Packages:** new `@mokei/decision-flow`; changed `@mokei/system-one-client`
**Upstream:** `@sozai/flow-graph@0.1.0` and `@sozai/async@0.3.0` (retry policy), built in sozai

## Goal

Compose System One classifications into multi-decision flows (trees, bounded loops, suspend and
resume) whose full definition is JSON. Primary authors are application developers and LLMs that
write flow JSON, so the schema stays small and regular and check issues carry repair hints. The
runtime does not depend on session packages, leaving `AgentSession` gating and MCP flow tools open.

## Key decisions

- **Layering.** The generic graph engine lives in sozai (`@sozai/flow-graph`: `branch`, `set`,
  `loop`, `action`, `input`, `end`, resumable step-wise runs, at-least-once node execution,
  per-node JSON retry policies, definition digests). Mokei adds one node kind, `decide`.
- **Answer validation in the client.** `validateResult` in `system-one-client` checks answer
  values against their questions: choice labels and probability keys are declared criteria;
  `score` within numeric `legend` bounds; `noul`, `confidence`, `act_probability` and
  probabilities finite and in [0, 1] (enforced by the `@sozai/schema` answer schemas). The
  `validate*` functions return Standard Schema results; `predict` turns failures into
  `SystemOneInputError` / `SystemOneResponseError`, which implement `StandardSchemaV1.FailureResult`.
  Answer issue paths start with `['answers', questionKey]`.
- **Flat results.** A `decide` node writes answers under `results.<id>.<questionKey>` plus
  `$meta: { model, usage }`, then evaluates `cases` in order, else `default`. A closed
  `resultSchema` (only `score.legend` and `score.probabilities` open) makes every flow reference
  statically checkable; extra backend fields inside declared answers are kept but not referenceable.
  `$meta` and `error` are reserved question keys.
- **Declared keys only.** Only answers for declared questions are staged and traced. A backend
  returning an undeclared top-level key (such as `error`) cannot spoof the engine's handled-error
  channel.
- **Static checker.** Beyond schema validation: unsafe or reserved question and criteria keys,
  choice comparisons against declared criteria, numeric comparisons in [0, 1], and literal `state`
  must be string, object or array. It scans filters across the whole definition, scoped to its own
  node's results. It skips literal `{ value }` payloads, matching the engine's traversal.
- **Retries by status.** Retry only `SystemOneConnectionError` with no status or status
  408/429/500/502/503/504/529, honouring a finite `retryAfterMs`. Everything else, including
  `invalid_state`, is terminal. Default `decide` policy: 3 attempts, 10 s per attempt, backoff from
  500 ms with jitter, suspend after 30 s. A node's own `retry` replaces the default.
- **Safe errors and telemetry.** `describeError` returns class name, status and clamped
  `retryAfterMs`, never messages. The engine is the sole failure logger (under
  `mokei.decision-flow`). A `decision.predict` child span and per-question `decision.answer` events
  use fixed attribute names. State, instructions, criteria descriptions and payloads are never
  recorded; error messages only with `recordErrorMessages: true`. Aborted predictions end their
  span labelled by the abort reason (timeout versus caller cancellation).
- **Authoring schemas.** `flowDefinitionSchema` (executable kinds, for LLMs) and
  `flowStorageSchema` (adds reserved shapes) are composed once at module load; every
  `decide`-owned field has a description. Examples live in TSDoc and tests, not in the schema.
  `formatIssues` is re-exported
  for repair loops.
- **No `resolver` yet.** The published engine has no flow references, so `createDecisionFlowGraph`
  omits the option.

## What was built

`@mokei/decision-flow` exports `createDecisionFlowGraph`, `decideKind`, `DecideNode`,
`decideNodeSchema`, `checkDecide`, `decideTargets`, `decideResultSchema`, `retryableDecision`,
`describeDecisionError`, `InvalidDecisionStateError`, the two schema constants and `formatIssues`.
It ships a support-triage JSON example (guard, triage, low-confidence `ask` with a one-day input
timeout, route, reject) tested end to end, including JSON round-trip of a suspended run and
`value`/`timeout` resumes. The README covers persistence per revision, `invocationID` dedupe,
optimistic concurrency, metrics and privacy. Tests include a schema snapshot, type tests, and a
smoke import of the built `lib/index.js`. The package joins the dts-consumer declaration gate and
the lockstep release group. Release intents: both packages patch, 0.14.0 → 0.14.1.

## Notes

- The shared kigu SWC config strips JSON import attributes, so built code cannot import
  `package.json`. The `decision-flow` tracer is created without a version for this reason.

Follow-on work: `backlog/2026-09-28-decision-flow-follow-ons.md`.
