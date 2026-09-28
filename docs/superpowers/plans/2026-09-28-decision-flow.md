# Decision Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate System One answer values and provide a JSON-authored, resumable `@mokei/decision-flow` package powered by published sozai flow primitives.

**Architecture:** Part A tightens `SystemOneClient.predict` at its existing `validateResult` boundary. Part B registers a `decide` `NodeKind` with `@sozai/flow-graph`; the engine owns transitions, retries, persistence, and failure logging, while Mokei owns System One calls, answer-path schemas, checker rules, and decision spans.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, `@sozai/schema`, `@sozai/flow-graph`, `@sozai/async`, `@sozai/otel`, `@mokei/system-one-client`, `@mokei/logger`.

**Spec:** `docs/superpowers/specs/2026-09-28-decision-flow-design.md`. Engine contracts: `/Users/paul/dev/yulsi/sozai/docs/agents/plans/backlog/2026-09-28-async-retry.md` and `/Users/paul/dev/yulsi/sozai/docs/agents/plans/backlog/2026-09-28-flow-graph-package.md`.

## Global Constraints

- Part A is available now. Part B starts only after the required `@sozai/async` retry API and `@sozai/flow-graph` are published.
- Recheck every upstream name and signature against installed published declarations before executing Part B. Amend this plan when published types differ.
- Never implement the two upstream sozai specs in this repository. Do not commit a local sozai link.
- A flow definition and every persisted value are finite JSON. The engine validates those boundaries.
- Use `pnpm` and `pnpm exec` only. Use `rtk proxy pnpm run lint` for lint.
- Use kebab-case for new source and test files. The existing `vitest.config.ts` spelling is a required tool name.
- Use `type`, `Array<T>`, named type imports, a single parameters object for public functions, and `workspace:^` for Mokei dependencies.
- `@mokei/decision-flow` is explicitly authorised by the approved spec, despite the repository's usual new-package guardrail.
- `call`, `goto`, `loop.body: { flow }`, generation, MCP tools, and `AgentSession` integration are follow-on work. Forward `resolver` only.
- Part A's release intent says previously accepted invalid backend answers now throw. Part B gets its own release intent.

## Review Focus

- A valid answer with optional fields omitted must still pass; Task 1 tests this.
- A numeric score legend with only one bound must not impose a range; Task 1 tests this.
- An inherited object key must not count as a declared choice or probability key; Task 1 tests this.
- A failure after staging answers must not expose partial results on `onError`; Task 4 tests this.
- A missing `model` with no client default must fail safely and without a retry; Task 5 tests this.

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/system-one-client/src/validation.ts` | Existing `validateResult({ questions, raw })` shape and value validation. |
| `packages/system-one-client/test/validation.test.ts` | Direct validation cases and existing changed assertion. |
| `packages/system-one-client/test/client.test.ts` | Fake backend integration case. |
| `.changeset/decision-flow-answer-validation.md` | Part A behaviour change intent. |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Published dependency catalog, workspace lock, and fixed-version group. |
| `packages/decision-flow/package.json` | Public package, scripts, exports, dependencies. |
| `packages/decision-flow/tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts` | Build and test configuration matching `system-one-client`. |
| `packages/decision-flow/src/decide-node.ts` | `DecideNode`, JSON schema, and `decideKind` registration. |
| `packages/decision-flow/src/result-schema.ts` | Closed referenceable result shape derived from questions. |
| `packages/decision-flow/src/check-decide.ts` | Kind-specific static checks and repair hints. |
| `packages/decision-flow/src/decide-error.ts` | `invalid_state`, retry classification, safe `describeError`. |
| `packages/decision-flow/src/decision-graph.ts` | Factory, default retry policy, default logger, schema exports. |
| `packages/decision-flow/src/index.ts` | Public exports and `formatIssues` re-export. |
| `packages/decision-flow/examples/support-triage.json` | Exact JSON example from the approved spec. |
| `packages/decision-flow/README.md` | Public usage, retry and persistence rules, collector metric guidance, privacy. |
| `packages/decision-flow/test/{result-schema,check-decide,decide-node,decide-error,decision-graph,support-triage,observability}.test.ts` | Focused runtime and checker tests. |
| `packages/decision-flow/test/public-api.test-d.ts` | Public type test. |
| `.changeset/decision-flow-package.md` | Part B package release intent. |

The paths and present exports above were checked against the repository on 2026-09-28. Specifically, `validateResult` lives in `packages/system-one-client/src/validation.ts` and takes `{ questions, raw }`; `SystemOneClient.predict` calls it. `SystemOneResponseError.issues` exposes `{ message, path? }`. The client exports `QuestionMap`, `SystemOneBackend`, all six relevant error classes, and `questionMapSchema` from `src/index.ts`. The HTTP backend maps 429 and 529 to retryable connection subclasses; other unmapped non-2xx statuses become `SystemOneConnectionError`. `getMokeiLogger` is exported by `packages/logger/src/index.ts`. The current package template, test setup, and fixed-version entry were read from `packages/system-one-client`, `packages/logger`, and `pnpm-workspace.yaml`.

## Part A -- answer value validation (unblocked)

### Task 1: Validate answer values and record the behaviour change

**Files:**
- Modify: `packages/system-one-client/src/validation.ts`
- Modify: `packages/system-one-client/test/validation.test.ts`
- Modify: `packages/system-one-client/test/client.test.ts`
- Create: `.changeset/decision-flow-answer-validation.md`

**Interfaces:**
- Consumes: `QuestionMap`, `PredictResult<TQuestions>`, and `SystemOneResponseError` already exported by `@mokei/system-one-client`.
- Produces: unchanged `validateResult<TQuestions extends QuestionMap>({ questions, raw }): PredictResult<TQuestions>`; adds `SystemOneResponseError.issues` entries with paths beginning `['answers', questionKey]`.

- [ ] **Step 1: Write the failing tests.** In the existing acceptance test, change the choice, probability key, and assertion from `unlisted` to `billing`. Add these cases to `validation.test.ts`. Use the existing `questions` fixture and a helper wrapping one answer in a full valid three-answer wire result.

```ts
function response(answers: Record<string, unknown>) {
  return {
    model: 'english',
    answers: {
      dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: { billing: 1 } },
      urgency: { type: 'score', score: 0.5, confidence: 1, legend: {}, probabilities: {} },
      churn: { type: 'noul', noul: 0.5 },
      ...answers,
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  }
}

test.each([
  ['undeclared choice', 'dept', { type: 'choice', choice: 'unlisted', confidence: 1, probabilities: {} }, ['answers', 'dept', 'choice']],
  ['undeclared probability key', 'dept', { type: 'choice', choice: 'billing', confidence: 1, probabilities: { unlisted: 0.2 } }, ['answers', 'dept', 'probabilities', 'unlisted']],
  ['score below legend minimum', 'urgency', { type: 'score', score: 0, confidence: 1, legend: { min: 1, max: 3 }, probabilities: {} }, ['answers', 'urgency', 'score']],
  ['score above legend maximum', 'urgency', { type: 'score', score: 4, confidence: 1, legend: { min: 1, max: 3 }, probabilities: {} }, ['answers', 'urgency', 'score']],
  ['noul below zero', 'churn', { type: 'noul', noul: -0.1 }, ['answers', 'churn', 'noul']],
  ['noul above one', 'churn', { type: 'noul', noul: 1.1 }, ['answers', 'churn', 'noul']],
  ['confidence outside range', 'dept', { type: 'choice', choice: 'billing', confidence: 1.1, probabilities: {} }, ['answers', 'dept', 'confidence']],
  ['action probability outside range', 'dept', { type: 'choice', choice: 'billing', confidence: 1, probabilities: {}, action: { act_probability: -1 } }, ['answers', 'dept', 'action', 'act_probability']],
  ['probability outside range', 'dept', { type: 'choice', choice: 'billing', confidence: 1, probabilities: { billing: 2 } }, ['answers', 'dept', 'probabilities', 'billing']],
  ['nonfinite confidence', 'dept', { type: 'choice', choice: 'billing', confidence: Number.NaN, probabilities: {} }, ['answers', 'dept', 'confidence']],
  ['nonfinite score', 'urgency', { type: 'score', score: Infinity, confidence: 1, legend: {}, probabilities: {} }, ['answers', 'urgency', 'score']],
  ['nonfinite action probability', 'churn', { type: 'noul', noul: 0.5, action: { act_probability: Infinity } }, ['answers', 'churn', 'action', 'act_probability']],
  ['nonfinite probability', 'urgency', { type: 'score', score: 1, confidence: 1, legend: {}, probabilities: { '1': Infinity } }, ['answers', 'urgency', 'probabilities', '1']],
] as const)('rejects %s with an issue at the answer path', (_name, key, answer, path) => {
  expect(() => validateResult({ questions, raw: response({ [key]: answer }) })).toThrowError(SystemOneResponseError)
  try {
    validateResult({ questions, raw: response({ [key]: answer }) })
  } catch (error) {
    expect((error as SystemOneResponseError).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path })]))
  }
})

test('accepts optional fields omitted and a score with only one numeric bound', () => {
  const raw = response({ urgency: { type: 'score', score: 99, confidence: 1, legend: { min: 0 }, probabilities: {} } })
  expect(validateResult({ questions, raw }).answers.urgency.score).toBe(99)
})

test('does not accept inherited criteria or probability keys', () => {
  const criteria = Object.create({ inherited: 'not declared' }) as Record<string, string>
  criteria.billing = 'declared'
  const inheritedQuestions = { dept: { ...questions.dept, criteria } }
  const raw = { model: 'english', answers: { dept: { type: 'choice', choice: 'inherited', confidence: 1, probabilities: { inherited: 1 } } }, usage: { input_tokens: 1, output_tokens: 1 } }
  expect(() => validateResult({ questions: inheritedQuestions, raw })).toThrow(SystemOneResponseError)
})
```

- [ ] **Step 2: Add a fake backend test in `client.test.ts`.** Use the existing `result()` helper and the local `questions` fixture.

```ts
test('rejects an undeclared choice returned by the backend', async () => {
  const backend: SystemOneBackend = {
    predict: async () => result({ dept: { type: 'choice', choice: 'other', confidence: 1, probabilities: { billing: 1 } } }),
  }
  const client = new SystemOneClient({ backend, defaultModel: 'english' })
  await expect(client.predict({ state: 'help', questions })).rejects.toThrow(SystemOneResponseError)
})
```

Add `SystemOneResponseError` to that test file's existing error import.

- [ ] **Step 3: Run the focused red tests.** Run `pnpm --filter @mokei/system-one-client exec vitest run test/validation.test.ts test/client.test.ts`. Expected: the new invalid-value cases fail because `validateResult` currently accepts them.

- [ ] **Step 4: Implement value checks in `validation.ts`.** Keep existing shape validation, wire usage mapping, and extra answer fields. Add the following helpers and call `valueIssues(question, answer, key)` only when that answer has no shape issues. Use `Object.hasOwn` for declared keys.

```ts
function probabilityIssue(value: number, path: Array<string>): ValidationIssue | undefined {
  return Number.isFinite(value) && value >= 0 && value <= 1
    ? undefined
    : { message: `${path.join('.')} must be finite and within [0, 1]`, path }
}

function valueIssues(question: Question, answer: unknown, key: string): Array<ValidationIssue> {
  const result: Array<ValidationIssue> = []
  const value = answer as Record<string, unknown>
  const base = ['answers', key]
  const addProbability = (number: unknown, path: Array<string>) => {
    if (typeof number !== 'number') return
    const issue = probabilityIssue(number, path)
    if (issue != null) result.push(issue)
  }
  if (question.type === 'choice') {
    if (!Object.hasOwn(question.criteria, value.choice as string)) {
      result.push({ message: `${base.join('.')} choice must name a declared criterion`, path: [...base, 'choice'] })
    }
    for (const [label, probability] of Object.entries(value.probabilities as Record<string, number>)) {
      if (!Object.hasOwn(question.criteria, label)) {
        result.push({ message: `${base.join('.')} probability key must name a declared criterion`, path: [...base, 'probabilities', label] })
      }
      addProbability(probability, [...base, 'probabilities', label])
    }
  }
  if (question.type === 'score') {
    const legend = value.legend as Record<string, unknown>
    const score = value.score as number
    if (!Number.isFinite(score) || (typeof legend.min === 'number' && typeof legend.max === 'number' && (score < legend.min || score > legend.max))) {
      result.push({ message: `${base.join('.')} score must be finite and within numeric legend bounds`, path: [...base, 'score'] })
    }
    for (const [label, probability] of Object.entries(value.probabilities as Record<string, number>)) {
      addProbability(probability, [...base, 'probabilities', label])
    }
  }
  if (question.type === 'noul') addProbability(value.noul, [...base, 'noul'])
  if (value.confidence !== undefined) addProbability(value.confidence, [...base, 'confidence'])
  const action = value.action as { act_probability?: number } | undefined
  if (action?.act_probability !== undefined) addProbability(action.act_probability, [...base, 'action', 'act_probability'])
  return result
}
```

Within the existing loop, store the shape issues for each answer, append them, then append `valueIssues` only when the shape issues array is empty. A nonfinite `legend.min` or `legend.max` is not a finite answer probability; if both are numeric, the score comparison follows the spec.

- [ ] **Step 5: Run passing checks.** Run `pnpm --filter @mokei/system-one-client test`. Expected: type checks and unit tests pass, including the replacement for the old acceptance test. Run `rtk proxy pnpm run lint`. Expected: exit 0.

- [ ] **Step 6: Record the release intent.** Run `pnpm change` and select `@mokei/system-one-client` patch. Rename the generated intent to `.changeset/decision-flow-answer-validation.md` if needed. Its complete content is:

```md
---
'@mokei/system-one-client': patch
---

Reject backend answers whose choice, score, noul, confidence, action probability, or probabilities violate the question's declared values and bounds. Previously accepted invalid answers now throw `SystemOneResponseError`.
```

Run `pnpm change status`. Expected: a release plan including `@mokei/system-one-client` in the fixed group.

- [ ] **Step 7: Commit.** Run `git add packages/system-one-client/src/validation.ts packages/system-one-client/test/validation.test.ts packages/system-one-client/test/client.test.ts .changeset/decision-flow-answer-validation.md && git commit -m "fix(system-one-client): validate answer values"`.

## Part B -- decision flow package (blocked until both sozai packages are published)

### Task 2: Gate on published engine APIs and create the package with a result schema

**Files:**
- Create: `packages/decision-flow/package.json`
- Create: `packages/decision-flow/tsconfig.json`
- Create: `packages/decision-flow/tsconfig.test.json`
- Create: `packages/decision-flow/vitest.config.ts`
- Create: `packages/decision-flow/src/result-schema.ts`
- Test: `packages/decision-flow/test/result-schema.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: published `@sozai/async` `RetryPolicy`, `RetryDecision`, `MAX_DELAY_MS`; published `@sozai/flow-graph` `NodeKind`, `FlowRetryPolicy`, `Value`, `Filter`, `CheckContext`, `ExecuteContext`, `FlowIssue`, `ErrorMetadata`, `createFlowGraph`, `defineNodeKind`, `isSafePathSegment`, `formatIssues`.
- Produces: `decideResultSchema(questions: QuestionMap): Schema`, a static closed schema for `results.<nodeID>`.

- [ ] **Step 1: Verify the publication gate before editing repository files.** Run `pnpm view @sozai/async version` and `pnpm view @sozai/flow-graph version`. Expected: both print a published semver. Create `/tmp/decision-flow-gate/package.json` containing `{ "private": true }`, then run `pnpm --dir /tmp/decision-flow-gate add @sozai/async@latest @sozai/flow-graph@latest`. Expected: exit 0. Run `rg -n 'RetryPolicy|RetryDecision|MAX_DELAY_MS|NodeKind|FlowRetryPolicy|createFlowGraph|defineNodeKind|isSafePathSegment|formatIssues|ExecuteContext|CheckContext|ErrorMetadata' /tmp/decision-flow-gate/node_modules/@sozai/async/lib /tmp/decision-flow-gate/node_modules/@sozai/flow-graph/lib`. Expected: exported declarations matching the upstream specs. Inspect `NodeKind.check` and especially whether `CheckContext` exposes the complete definition for filters outside a `decide` node. Inspect `ExecuteContext.span`, `graph.check/start/resume/run`, and schema properties directly in the installed `.d.ts` files. If either package, export, or definition-wide checker context is missing, stop Part B and report the exact missing contract to the upstream agent. If a published signature differs, update this plan's Part B interfaces and tests before implementation. The upstream documents are plans, not proof of published API.

- [ ] **Step 2: Add catalog dependencies and package metadata.** Add `@sozai/flow-graph` at its published compatible version to the catalog; raise `@sozai/async` only if its published retry API requires a newer version. Add compatible `@opentelemetry/api` and `@opentelemetry/sdk-trace-base` versions to the catalog for observability tests. Add `@mokei/decision-flow` to `versioning.fixed`. Copy `system-one-client`'s package scripts, exports (`./lib/index.js`), `tsconfig.json`, `tsconfig.test.json`, and `vitest.config.ts` into the new package, changing only name, description, directory, and dependencies, and set `"version": "0.14.0"`. Use dependencies `@mokei/system-one-client: workspace:^`, `@mokei/logger: workspace:^`, `@sozai/flow-graph: catalog:`, `@sozai/async: catalog:`, `@sozai/otel: catalog:`, and `@sozai/schema: catalog:`. Use `@types/node`, `@sozai/log`, `@opentelemetry/api`, and `@opentelemetry/sdk-trace-base` from the catalog in devDependencies. Set `resolveJsonModule: true` in both tsconfig files for the package version import and Task 8's example import. Run `pnpm install --lockfile-only` followed by `pnpm install`; expected: both exit 0 and `pnpm-lock.yaml` records the new package. The new-package scaffold is part of this deliverable.

- [ ] **Step 3: Write failing `result-schema.test.ts` tests.** Construct `questions` with a choice (`billing`, `technical`), score, and noul. Assert exact `properties` paths for each field, `$meta.model`, `$meta.usage.inputTokens`, `$meta.usage.outputTokens`; assert `additionalProperties: false` on root, answer, action, `$meta`, and usage; assert open `legend` and score `probabilities`; assert choice `probabilities` has only declared labels. Use `createValidator(decideResultSchema(questions))` to assert an extra runtime answer field fails this reference schema.

```ts
test('builds closed referenceable paths and two documented open maps', () => {
  const schema = decideResultSchema(questions) as { properties: Record<string, unknown>; additionalProperties: boolean }
  expect(schema.additionalProperties).toBe(false)
  expect(schema.properties).toHaveProperty('dept')
  expect(schema.properties).toHaveProperty('$meta')
  expect(JSON.stringify(schema)).toContain('inputTokens')
  expect(JSON.stringify(schema)).not.toContain('rationale')
  expect(JSON.stringify(schema)).toContain('"legend"')
})
```

- [ ] **Step 4: Run the red test.** Run `pnpm --filter @mokei/decision-flow exec vitest run test/result-schema.test.ts`. Expected: failure because `decideResultSchema` is missing.

- [ ] **Step 5: Implement `decideResultSchema(questions: QuestionMap): Schema` in `result-schema.ts`.** Use this complete shape; `error` stays absent because the engine owns `invalid_error_path`.

```ts
import type { QuestionMap } from '@mokei/system-one-client'
import type { Schema } from '@sozai/schema'

const probability = { type: 'number', minimum: 0, maximum: 1 } as const
const action = {
  type: 'object',
  properties: { act_probability: probability },
  additionalProperties: false,
} as const

export function decideResultSchema(questions: QuestionMap): Schema {
  const properties: Record<string, Schema> = {}
  for (const [key, question] of Object.entries(questions)) {
    if (question.type === 'choice') {
      const labels = Object.fromEntries(Object.keys(question.criteria).map((label) => [label, probability]))
      properties[key] = {
        type: 'object',
        properties: {
          choice: { type: 'string', enum: Object.keys(question.criteria) },
          confidence: probability,
          probabilities: { type: 'object', properties: labels, additionalProperties: false },
          action,
        },
        additionalProperties: false,
      }
    } else if (question.type === 'score') {
      properties[key] = {
        type: 'object',
        properties: {
          score: { type: 'number' },
          confidence: probability,
          legend: { type: 'object', additionalProperties: true },
          probabilities: { type: 'object', additionalProperties: probability },
          action,
        },
        additionalProperties: false,
      }
    } else {
      properties[key] = {
        type: 'object',
        properties: { noul: probability, confidence: probability, action },
        additionalProperties: false,
      }
    }
  }
  properties.$meta = {
    type: 'object',
    properties: {
      model: { type: 'string' },
      usage: {
        type: 'object',
        properties: { inputTokens: { type: 'integer' }, outputTokens: { type: 'integer' } },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  }
  return { type: 'object', properties, additionalProperties: false }
}
```

- [ ] **Step 6: Verify and commit.** Run `pnpm --filter @mokei/decision-flow test`. Expected: type checks and result schema tests pass. Run `git add pnpm-workspace.yaml pnpm-lock.yaml packages/decision-flow && git commit -m "feat(decision-flow): add package and result schema"`.

### Task 3: Add the JSON node schema and static checker

**Files:**
- Create: `packages/decision-flow/src/decide-node.ts`
- Create: `packages/decision-flow/src/check-decide.ts`
- Test: `packages/decision-flow/test/check-decide.test.ts`

**Interfaces:**
- Consumes: `decideResultSchema(questions)` from Task 2 and the published `NodeKind`/checker contracts verified at Task 2's gate.
- Produces: `DecideNode` with `{ kind: 'decide'; description?; state: Value; questions: QuestionMap; model?; cases: Array<{ when: Filter; to: string }>; default: string; onError?; retry?: FlowRetryPolicy }`, `decideNodeSchema: Schema`, `checkDecide(node: DecideNode, ctx: CheckContext): Array<FlowIssue>`.

- [ ] **Step 1: Write failing checker tests.** In `check-decide.test.ts`, register a test-local `NodeKind<DecideNode>` using `decideNodeSchema`, `checkDecide`, `decideResultSchema`, and an `execute` method that throws if called. This task checks definitions only; Task 4 builds the production kind. Check `graph.check(definition).issues` for codes, exact definition paths, and nonempty hints. Cases: empty or malformed `questions`; `$meta` and `error` question keys; `__proto__`, `constructor`, `prototype` question and choice-criterion keys built through `JSON.parse`; invalid literal `state` values `null`, boolean, and number; unknown choice labels for `equalTo`, `notEqualTo`, `in`, `notIn` nested under `and`, `or`, and `not`; out-of-range numbers for `noul`, `confidence`, `action.act_probability`, and choice/score probabilities. Nonfinite numbers get the engine's JSON issue before the hook. Put one unknown label in a separate `branch` node reading `results.decide.department.choice` to prove definition-wide checking. Assert a declared label and boundary values 0 and 1 pass. Assert `onError` target reading `results.<id>.error.type` passes, while an invalid `error.secret` read fails with engine code `invalid_error_path`. Assert cross-node `invalid_result_path` for an undeclared question, an extra backend field, and an undeclared choice probability key; assert `legend.anyBackendKey` passes.

```ts
test.each(['$meta', 'error', '__proto__', 'constructor', 'prototype'])('rejects question key %s with a repair hint', (key) => {
  const definition = makeDefinition({ questions: JSON.parse(`{"${key}":{"type":"noul","instructions":"Check?"}}`) })
  const issues = graph.check(definition).issues
  expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'error', hint: expect.any(String) })]))
  expect(issues.some((issue) => issue.path.join('.').includes('questions'))).toBe(true)
})
```

- [ ] **Step 2: Run the red tests.** Run `pnpm --filter @mokei/decision-flow exec vitest run test/check-decide.test.ts`. Expected: missing `decideNodeSchema`/`checkDecide` or checker failures.

- [ ] **Step 3: Implement `decideNodeSchema` and `checkDecide`.** Use `questionMapSchema` for `questions`; `NodeKind.schema` must describe every field and give a concrete example. Export `decideTargets(node)` yielding each `cases[i].to`, `default`, and optional `onError` with exact paths. Recursively visit filter leaves across the complete definition through the verified `CheckContext`, including filters in other kinds that read this node's results. For a path ending in `choice`, require declared choice criteria for `equalTo`, `notEqualTo`, `in`, `notIn`. For `noul`, `confidence`, `act_probability`, or a `probabilities` value, require numeric operands in [0, 1] and finite across equality, membership, and ordering operators. Validate literal `{ value }` `state` against string/object/array. Use `isSafePathSegment` for question and criteria keys. Emit `FlowIssue` with a precise definition path, stable code, message, and renaming/correction hint. Avoid reimplementing engine-wide path checks.

- [ ] **Step 4: Verify and commit.** Run `pnpm --filter @mokei/decision-flow test`. Expected: passing checker and result-schema tests. Run `git add packages/decision-flow/src/decide-node.ts packages/decision-flow/src/check-decide.ts packages/decision-flow/test/check-decide.test.ts && git commit -m "feat(decision-flow): check decide definitions"`.

### Task 4: Execute a decision and stage flat results

**Files:**
- Modify: `packages/decision-flow/src/decide-node.ts`
- Test: `packages/decision-flow/test/decide-node.test.ts`

**Interfaces:**
- Consumes: `SystemOneClient.predict({ state, questions, model?, signal? })`; published `ExecuteContext.resolve`, `setResult`, `evaluate`, and `NodeResult`.
- Produces: `decideKind({ client: SystemOneClient }): NodeKind<DecideNode>` with `kind`, `schema`, `decideTargets` wired as `targets`, `resultSchema`, `check`, `retries: true`, and `execute`.

- [ ] **Step 1: Write failing tests with a fake `SystemOneBackend`.** Make a graph with `decide`, `end` destinations, and a fake backend. Assert the backend receives resolved state, questions, `model` override, and attempt signal. Assert `results.decide.department.choice` is flat, `$meta.model` and `$meta.usage` use mapped usage, first matching case wins, unmatched cases take `default`, and an undeclared choice returned by the backend ends with response-error metadata. Assert a finite extra backend answer field is kept at runtime, though Task 3 proves its path is not referenceable. Return a valid answer with another extra field containing `NaN`; the client keeps it, but the engine rejects the staged non-JSON result. Assert `onError` sees only its handled-error result, without partial answers. Assert `null` and numeric resolved states fail with code `invalid_state`, without backend calls; strings, objects, and arrays succeed.

```ts
test('stores flat answers and selects the first matching case', async () => {
  const run = await graph.run({ definition: makeDefinition(), input: { message: 'refund' } })
  expect(run.status).toBe('ended')
  expect(run.runState.frames[0]?.results.decide.department.choice).toBe('billing')
  expect(run.runState.frames[0]?.results.decide.$meta).toEqual({ model: 'english', usage: { inputTokens: 2, outputTokens: 1 } })
  expect(run.outcome).toBe('billing')
})
```

- [ ] **Step 2: Run the red test.** Run `pnpm --filter @mokei/decision-flow exec vitest run test/decide-node.test.ts`. Expected: `decideKind.execute` does not yet produce the result and transition.

- [ ] **Step 3: Implement `execute(node: DecideNode, ctx: ExecuteContext): Promise<NodeResult>`.** Resolve `state`; if its runtime value is neither string, object, nor array, throw a dedicated `InvalidDecisionStateError` with `code: 'invalid_state'`. Call `client.predict({ state, questions: node.questions, model: node.model, signal: ctx.signal })` once. Call `ctx.setResult({ ...answers, $meta: { model, usage } })` once. Evaluate cases in array order after staging; return `{ next: firstMatch.to }` or `{ next: node.default }`. Keep `error` reserved and let the engine route `onError`. Do not log or copy backend extras into `$meta`.

- [ ] **Step 4: Verify and commit.** Run `pnpm --filter @mokei/decision-flow test`. Expected: pass. Run `git add packages/decision-flow/src/decide-node.ts packages/decision-flow/test/decide-node.test.ts && git commit -m "feat(decision-flow): execute decide nodes"`.

### Task 5: Classify errors and retries

**Files:**
- Create: `packages/decision-flow/src/decide-error.ts`
- Modify: `packages/decision-flow/src/decide-node.ts`
- Test: `packages/decision-flow/test/decide-error.test.ts`
- Modify: `packages/decision-flow/test/decide-node.test.ts`

**Interfaces:**
- Consumes: published `RetryDecision`, `MAX_DELAY_MS`, `ErrorMetadata`, engine attempt-timeout and retry behavior.
- Produces: `retryableDecision(error: unknown): RetryDecision` and `describeDecisionError(error: unknown): ErrorMetadata`; `decideKind.retryable` and `.describeError` delegate to them.

- [ ] **Step 1: Write failing table tests.** Instantiate each verified class: `SystemOneConnectionError` with no status, 400, 408, 429, 500, 502, 503, 504, 529; `SystemOneRateLimitError`, `SystemOneOverloadedError`, `SystemOneInputError`, `SystemOneAuthError`, `SystemOneModelError`, `SystemOneResponseError`, generic `SystemOneError`, and `InvalidDecisionStateError`. Assert exact retry decisions. Test finite `retryAfterMs` yielding `{ afterMs }`, oversized finite delay clamped in metadata, and `Infinity` omitted from both decisions and metadata. Assert metadata has `type`, optional `status`, optional bounded `retryAfterMs`, and never `message` or `cause`.

```ts
test.each([408, 429, 500, 502, 503, 504, 529])('retries connection status %i', (status) => {
  expect(retryableDecision(new SystemOneConnectionError({ message: 'secret', status }))).toBe(true)
})
test('ignores an infinite server wait', () => {
  const error = new SystemOneRateLimitError({ message: 'secret', status: 429, retryAfterMs: Infinity })
  expect(retryableDecision(error)).toBe(true)
  expect(describeDecisionError(error)).toEqual({ type: 'SystemOneRateLimitError', status: 429 })
})
```

- [ ] **Step 2: Add engine integration tests.** Fake the backend to fail then succeed. Assert retry count, `retryAfterMs` delay with fake timers and injected `now`, no retry for 400 or auth/model/input/response failures, retry for 408 and 5xx, attempt timeout against a backend that never settles, and long 429 wait causing `pending.reason: 'retry'` followed by `graph.resume({ event: { type: 'retry' } })`. Assert `onError` receives `results.decide.error.type/status/reason/attempts`; without `onError`, run error code is `node_failed`. Assert a client without a default model and a node without `model` fails safely in one attempt.

- [ ] **Step 3: Run the red tests.** Run `pnpm --filter @mokei/decision-flow exec vitest run test/decide-error.test.ts test/decide-node.test.ts`. Expected: retry/error tests fail.

- [ ] **Step 4: Implement error helpers and wire the kind.** Retry only connection errors with absent status or one of `408, 429, 500, 502, 503, 504, 529`; inspect status before classifying. A finite `retryAfterMs` yields `{ afterMs }`, otherwise `true`. Return `false` for every other error. Describe known System One errors by `error.name`, status when present, and finite `retryAfterMs` clamped to `[0, MAX_DELAY_MS]`; describe invalid state as `{ type: 'invalid_state', code: 'invalid_state' }`. Do not copy messages. Let the engine handle attempt timeouts, retry waits, and terminal failure.

- [ ] **Step 5: Verify and commit.** Run `pnpm --filter @mokei/decision-flow test`. Expected: pass. Run `git add packages/decision-flow/src/decide-error.ts packages/decision-flow/src/decide-node.ts packages/decision-flow/test/decide-error.test.ts packages/decision-flow/test/decide-node.test.ts && git commit -m "feat(decision-flow): classify decision failures and retries"`.

### Task 6: Add the graph factory, public exports, and schema contract

**Files:**
- Create: `packages/decision-flow/src/decision-graph.ts`
- Create: `packages/decision-flow/src/index.ts`
- Test: `packages/decision-flow/test/decision-graph.test.ts`
- Test: `packages/decision-flow/test/public-api.test-d.ts`
- Create: `packages/decision-flow/test/__snapshots__/decision-graph.test.ts.snap`

**Interfaces:**
- Consumes: `decideKind({ client })`, published `createFlowGraph` options and graph schemas.
- Produces: `createDecisionFlowGraph({ client, actions?, kinds?, retryDefaults?, maxSteps?, runtime?, logger?, recordErrorMessages?, random?, now?, resolver? })`; schema constants `flowDefinitionSchema`, `flowStorageSchema`, and `formatIssues` export. Build schema constants from a schema-only graph at module initialisation; its `decide` execution backend throws if called and is never exposed. The factory uses the caller's real client.

- [ ] **Step 1: Write failing tests.** Assert the factory registers `decide` plus built-ins, forwards caller options, chooses caller `retryDefaults.decide` over the default, and leaves caller `retryDefaults.action` intact. Assert default `decide` policy exactly `{ maxAttempts: 3, attemptTimeoutMs: 10000, backoff: { initialMs: 500, jitter: true }, suspendAfterMs: 30000 }`. Assert a node's own `retry` replaces the default rather than field-merging. Assert `graph.authoringSchema` equals the public `flowDefinitionSchema` and `graph.storageSchema` equals `flowStorageSchema` by snapshot. Assert authoring rejects a `call` node, storage accepts it, and `formatIssues` outputs path/code/message/hint. The public type test imports `DecideNode`, `decideKind`, `createDecisionFlowGraph`, `flowDefinitionSchema`, `flowStorageSchema`, and `formatIssues` from `../src/index.js` and checks their signatures with `expectTypeOf`.

```ts
test('provides the default retry policy and composed authoring schema', () => {
  const graph = createDecisionFlowGraph({ client })
  expect(graph.authoringSchema).toMatchSnapshot()
  expect(flowDefinitionSchema).toEqual(graph.authoringSchema)
  expect(flowStorageSchema).toEqual(graph.storageSchema)
  expect(graph.check(makeDefinition()).ok).toBe(true)
})
```

- [ ] **Step 2: Run the red tests.** Run `pnpm --filter @mokei/decision-flow exec vitest run test/decision-graph.test.ts`. Expected: factory/public exports missing.

- [ ] **Step 3: Implement the factory.** Forward every listed option to `createFlowGraph`; pass `kinds: [decideKind({ client }), ...(kinds ?? [])]`. Merge `{ decide: defaultPolicy, ...retryDefaults }`. Default `logger` to `getMokeiLogger('decision-flow')`. Export `decideKind`, `DecideNode`, the composed schema constants, and `formatIssues` in `index.ts`; avoid importing session packages. Compose the two constants once with a schema-only `decideKind` whose client throws if executed; no run uses that graph. Ensure every authoring schema field has a description and examples, using the engine's schema composition. If a published engine schema lacks a required description, report that upstream contract mismatch and amend this task rather than silently patching an engine schema.

- [ ] **Step 4: Verify and commit.** Run `pnpm --filter @mokei/decision-flow test && pnpm --filter @mokei/decision-flow build`. Expected: type checks, unit and type tests, and build pass; the snapshot records the composed schema. Run `git add packages/decision-flow/src/decision-graph.ts packages/decision-flow/src/index.ts packages/decision-flow/test/decision-graph.test.ts packages/decision-flow/test/public-api.test-d.ts packages/decision-flow/test/__snapshots__/decision-graph.test.ts.snap && git commit -m "feat(decision-flow): expose graph and authoring schema"`.

### Task 7: Add decision tracing and verify failure logging

**Files:**
- Modify: `packages/decision-flow/src/decide-node.ts`
- Test: `packages/decision-flow/test/observability.test.ts`

**Interfaces:**
- Consumes: `ExecuteContext.span` and published `@sozai/otel` `createTracerFactory`, `SpanStatusCode`; engine error logger and `traceLogger` behavior.
- Produces: `decision.predict` child span and `decision.answer` events on `flow.node`. The kind never logs failures.

- [ ] **Step 1: Write failing in-memory span and log-sink tests.** Follow the existing `packages/context-server/test/trace.test.ts` in-memory context setup. Assert `decision.predict` is a child of `flow.node`; its attributes include fixed `system_one.model`, `system_one.question.count`, and usage token names. Assert one `decision.answer` event per question with only `decision.question`, `decision.type`, the answer value attribute (`decision.choice`, `decision.score`, or `decision.noul`), and optional `decision.confidence`. On failure assert span status `ERROR`, `error.type`, optional `http.status_code` and `system_one.retry_after_ms`. Serialize all spans and assert absence of state text, instructions, criterion descriptions, raw payloads, and backend error message. Configure a LogTape test sink and assert one engine record per retry, handled failure, and terminal failure under `mokei.decision-flow`, carrying safe `describeError` fields and active node trace/span IDs. Assert no second record from the kind. Test `recordErrorMessages: true` forwarding separately.

```ts
test('keeps prediction payloads and backend messages out of default spans', async () => {
  await graph.run({ definition: makeDefinition(), input: { message: 'PRIVATE_STATE' } })
  const predict = spans.find((span) => span.name === 'decision.predict')
  expect(predict?.parentSpanContext?.spanId).toBe(spans.find((span) => span.name === 'flow.node')?.spanContext().spanId)
  expect(JSON.stringify(spans)).not.toContain('PRIVATE_STATE')
  expect(JSON.stringify(spans)).not.toContain('PRIVATE_BACKEND_MESSAGE')
})
```

- [ ] **Step 2: Run the red test.** Run `pnpm --filter @mokei/decision-flow exec vitest run test/observability.test.ts`. Expected: missing decision spans/events.

- [ ] **Step 3: Implement spans around `client.predict`.** Import the package version from `../package.json` with a JSON import attribute, then create `createTracerFactory('mokei', packageJSON.version)('decision-flow')`. Start `decision.predict` directly with `tracer.startActiveSpan`, never `withSpan`. End it in `finally`. Set safe attributes and status; do not record exceptions or status messages by default. Add one fixed-key `decision.answer` event to `ctx.span` per returned answer. Let the engine alone log failures; the factory's logger default already sends them to `mokei.decision-flow`.

- [ ] **Step 4: Verify and commit.** Run `pnpm --filter @mokei/decision-flow test`. Expected: span and sink assertions pass. Run `git add packages/decision-flow/src/decide-node.ts packages/decision-flow/test/observability.test.ts && git commit -m "feat(decision-flow): trace predictions and answers"`.

### Task 8: Add the support triage example and resume tests

**Files:**
- Create: `packages/decision-flow/examples/support-triage.json`
- Create: `packages/decision-flow/README.md`
- Test: `packages/decision-flow/test/support-triage.test.ts`

**Interfaces:**
- Consumes: public graph factory and the published engine `start`, `resume`, `run`, and authoring schema.
- Produces: a complete JSON flow with `guard`, `triage`, `ask`, `route`, `billing`, `technical`, `reject`, and `done` nodes.

- [ ] **Step 1: Write the JSON example exactly as in the spec's Example section.** Keep node IDs, question text, criteria descriptions, filters, `onError`, retry settings, input timeout `86400000`, and outcomes unchanged. The file is a standalone JSON document with no TypeScript functions.

- [ ] **Step 2: Write failing end-to-end tests.** Load the JSON example with the test fixture import convention used by this repo. Assert `createValidator(flowDefinitionSchema)(example).issues` is absent and `graph.check(example).ok` is true. A fake backend gives guard `noul: 0.9` and assert `rejected`; another gives guard `0.1`, triage `billing` with confidence `0.9`, and assert `createTicket` gets billing. Give triage confidence `0.4` to suspend at `ask`; persist `JSON.parse(JSON.stringify(run.runState))`; reconstruct a fresh graph; resume with `{ type: 'value', value: 'billing' }` and assert routed billing. In a separate test advance injected `now` beyond the timeout and resume with `{ type: 'timeout' }`, then assert technical. Assert a timeout before the deadline is rejected. Check a low-confidence `technical` choice still routes through `ask` first.

```ts
test('round-trips the suspended ask state and resumes with a value', async () => {
  const first = await graph.run({ definition: example, input: { message: 'help' } })
  expect(first.status).toBe('suspended')
  expect(first.pending?.node).toBe('ask')
  const runState = JSON.parse(JSON.stringify(first.runState))
  const resumed = freshGraph.resume({ definition: example, runState, event: { type: 'value', value: 'billing' } })
  const states = []
  for await (const state of resumed) states.push(state)
  expect(states.at(-1)?.outcome).toBe('routed')
  expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ args: { ticket: { team: 'billing', message: 'help' } } }))
})
```

- [ ] **Step 3: Run the red tests.** Run `pnpm --filter @mokei/decision-flow exec vitest run test/support-triage.test.ts`. Expected: failures until the JSON example and fixture wiring are complete.

- [ ] **Step 4: Complete example fixture, test wiring, and README.** Use `resolveJsonModule` from `tsconfig.test.json`. Bind host `createTicket` action and fake backend responses; use injected `now` for timeout. Keep example data identical to the approved spec. In the README, show `createDecisionFlowGraph`, `graph.check`, `formatIssues`, `graph.run`, persistence of every yielded revision, `graph.resume`, and `graph.recover`. State that hosts dedupe actions with `invocationID` and use optimistic concurrency on `revision`. Document the span-derived metric names and safe dimensions from the spec, including never using `runID` as a metric dimension. State the privacy default and `recordErrorMessages` opt-in.

- [ ] **Step 5: Verify and commit.** Run `pnpm --filter @mokei/decision-flow test`. Expected: guard, triage, suspend, JSON round-trip, value resume, and timeout resume pass. Run `git add packages/decision-flow/examples/support-triage.json packages/decision-flow/README.md packages/decision-flow/test/support-triage.test.ts && git commit -m "test(decision-flow): cover support triage example"`.

### Task 9: Run the release gate and record the package intent

**Files:**
- Create: `.changeset/decision-flow-package.md`

**Interfaces:**
- Consumes: completed Parts A and B.
- Produces: a publishable package with a pending lockstep release intent.

- [ ] **Step 1: Run full verification.** Run `pnpm --filter @mokei/decision-flow test`, `pnpm --filter @mokei/decision-flow build`, `pnpm --filter @mokei/system-one-client test`, `pnpm run build`, `pnpm test`, and `rtk proxy pnpm run lint`. Expected: every command exits 0. If lint changes a file, inspect its diff and rerun the affected test before the release intent.

- [ ] **Step 2: Record the intent.** Run `pnpm change` and select `@mokei/decision-flow` patch. Rename the generated file to `.changeset/decision-flow-package.md` if necessary. Its complete content is:

```md
---
'@mokei/decision-flow': patch
---

Add JSON-authored, resumable System One decision flows with static checking, retries, tracing, and a support triage example.
```

- [ ] **Step 3: Verify the release plan.** Run `pnpm change status`. Expected: the fixed group includes `@mokei/decision-flow` and `@mokei/system-one-client` at the same planned version. Confirm `git status --short` shows only the intended changeset before committing.

- [ ] **Step 4: Commit.** Run `git add .changeset/decision-flow-package.md && git commit -m "chore(decision-flow): record release intent"`.

## Self-review against the approved spec

| Spec section | Task coverage |
|---|---|
| Intent and Decisions | Tasks 2-8 provide JSON definitions, composed kinds, bounded engine execution, and a client-only Mokei layer. |
| Evaluation of the existing packages | Tasks 1, 2, and 4 use the verified client boundary and the published graph extension point. |
| Work breakdown and Engine summary | Task 2 gates on published sozai exports; Tasks 3-8 consume them without implementing upstream work. |
| Prerequisite: answer value validation | Task 1 covers every listed value rule, finite values, backend rejection, and release intent. |
| The `decide` kind -- execute and result shape | Tasks 2 and 4 cover flat answers, `$meta`, ordered cases, invalid state, and closed reference paths. |
| The `decide` kind -- check | Task 3 covers question schema, reserved/unsafe keys, comparison values, and literal state. |
| The `decide` kind -- retries, errors, construction | Tasks 5 and 6 cover status classification, bounded metadata, default/override policy, `onError`, and factory options. |
| Example | Task 8 copies the JSON and tests both normal and suspended routes. |
| LLM authoring support | Tasks 3 and 6 cover descriptions, examples, composed authoring/storage schemas, `formatIssues`, snapshot, and `call` rejection. |
| Observability | Task 7 covers spans, fixed event attributes, privacy, logger category, disposition records, and trace correlation. |
| Testing | Tasks 1-8 assign every listed test family, including type tests and the public schema snapshot. |
| Follow-on | Excluded from implementation; Task 6 forwards `resolver` only, as specified. |

Review Focus is pinned by Tests 1, 4, and 5. The gate prevents planned upstream types from being treated as released facts. Public names match the interfaces introduced by preceding tasks; the schema export form remains contingent on the published engine API and is resolved in Task 6 before code is written. No spec section is left without an owning task.
