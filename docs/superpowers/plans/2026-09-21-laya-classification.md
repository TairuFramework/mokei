# Laya classification support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform-neutral TypeScript Laya classification client that speaks the TypeSafe System One API, an MCP server exposing it, and setup docs for the `laya serve` / hosted sidecar.

**Architecture:** A neutral `@mokei/laya-client` defines Laya's typed-question API (`choice`/`score`/`noul`) with `@sozai/schema` JSON schemas as the source of truth, over a pluggable `LayaBackend` seam. One backend ships now: `HttpLayaBackend` (ky) speaking `POST /v1/systemone` and `GET /v1/models`, reaching both a local `laya serve` binary and the hosted `api.typesafe.ai`. `@mokei/mcp-laya` reuses the client. An in-process ggml backend is deferred; only the seam is built.

**Tech Stack:** TypeScript (ES2025, NodeNext, ESM), `ky` (fetch HTTP + Bearer), `@sozai/schema` (`FromSchema` types + validators), `@mokei/context-server` + `@mokei/context-server-node` (MCP server), vitest, Biome, swc, turbo.

**Spec:** `docs/superpowers/specs/2026-09-21-laya-onnx-classification-design.md`

## Global Constraints

- TypeScript: `type` not `interface`; `Array<T>` not `T[]`; never `any` (use `unknown` / `Record<string, unknown>`); ES private `#field` + getter, never `private`/`readonly`/`protected`; every public method and factory takes a single parameters object; capital `ID`/`HTTP`/`URL` in identifiers; `import type` for type-only imports.
- Schema-first. Every public type describing a wire value (questions, state, answers, usage, models) is a `@sozai/schema` schema `as const satisfies Schema`, with its type derived via `FromSchema<typeof schema>`. The same schemas validate inputs and outputs.
- Every parameter object, option object, and result shape on the public API is a named, exported type. No anonymous inline object type in a public signature.
- `@mokei/laya-client` is platform-neutral: runtime dependencies are `ky` and `@sozai/schema` only. No `node:*` imports. tsconfig `lib` is `["es2025", "dom"]`, no `"types": ["node"]`.
- The TypeSafe request requires `model`. The client resolves it from the per-call value or `defaultModel` and throws `LayaError` when neither is set.
- ESM only, `"type": "module"`, `moduleResolution: NodeNext`, strict mode. Relative imports end in `.js`.
- Biome formatting: 2-space indent, 100-col width, single quotes, trailing commas, arrow parens always.
- Both new packages are published and join `versioning.fixed` in `pnpm-workspace.yaml`. Set each new package `version` to the fixed group's current version: `0.13.1`.
- `pnpm` / `pnpx` only, never `npm` / `npx`.
- Lint runs as `rtk proxy pnpm run lint`. Never edit `package.json` scripts, lint/build config, or `.npmrc`.
- Tests use vitest; test files end in `.test.ts` under `test/`; type tests via `tsconfig.test.json`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

- Caller passes a malformed question map (missing `type`, or `choice` without `criteria`). Must throw `LayaInputError` before any HTTP request. Pinned in Task 5.
- `predict` called with no `model` and no `defaultModel`. Must throw `LayaError`, not send a request with `model: undefined`. Pinned in Task 5.
- Sidecar response missing `answers`, or an answer whose shape mismatches its primitive. Must throw `LayaResponseError`, not a raw `TypeError`. Pinned in Task 3.
- Hosted API returns 401/403 for a missing or bad Bearer key. Must throw `LayaAuthError`, distinct from a generic connection failure. Pinned in Task 6.
- A request aborted mid-flight via `signal`. Must reject with an abort error and not hang. Pinned in Task 6.

---

### Task 1: Scaffold `@mokei/laya-client` with schema-first types

**Files:**
- Create: `packages/laya-client/package.json`
- Create: `packages/laya-client/tsconfig.json`
- Create: `packages/laya-client/tsconfig.test.json`
- Create: `packages/laya-client/src/types.ts`
- Create: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/types.test-d.ts`

**Interfaces:**
- Produces: the schemas `choiceQuestionSchema`, `scoreQuestionSchema`, `noulQuestionSchema`, `questionSchema`, `questionMapSchema`, `stateSchema`, `choiceAnswerSchema`, `scoreAnswerSchema`, `noulAnswerSchema`, `wireUsageSchema`, `modelMetadataSchema`, `modelsResponseSchema`; the derived types `ChoiceQuestion`, `ScoreQuestion`, `NoulQuestion`, `Question`, `QuestionMap`, `State`, `ChoiceAnswer`, `ScoreAnswer`, `NoulAnswer`; and `Usage`, `LayaModel`, `AnswerFor<TQuestion>`, `PredictResult<TQuestions>`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@mokei/laya-client",
  "version": "0.13.1",
  "description": "Mokei Laya classification client",
  "keywords": ["model", "context", "protocol", "mcp", "laya", "classification", "typesafe"],
  "homepage": "https://mokei.dev",
  "repository": {
    "type": "git",
    "url": "https://github.com/TairuFramework/mokei",
    "directory": "packages/laya-client"
  },
  "license": "MIT",
  "sideEffects": false,
  "type": "module",
  "exports": { ".": "./lib/index.js" },
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": ["lib/*"],
  "scripts": {
    "build": "pnpm run build:clean && pnpm run build:js && pnpm run build:types",
    "build:clean": "del lib",
    "build:js": "del 'lib/**/*.js' && swc src -d ./lib --config-file ../../node_modules/@kigu/dev/swc.json --strip-leading-paths",
    "build:types": "del 'lib/**/*.d.ts' 'lib/**/*.d.ts.map' && tsc --emitDeclarationOnly --skipLibCheck",
    "build:types:ci": "tsc --emitDeclarationOnly --skipLibCheck --declarationMap false",
    "prepublishOnly": "pnpm run build",
    "test": "pnpm run test:types && pnpm run test:unit",
    "test:types": "tsc --noEmit --skipLibCheck -p tsconfig.test.json",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@sozai/schema": "catalog:",
    "ky": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` (neutral — no node lib)**

```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "lib": ["es2025", "dom"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./lib",
    "rootDir": "./src"
  },
  "include": ["./src/**/*"]
}
```

- [ ] **Step 3: Create `tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "..",
    "resolveJsonModule": true
  },
  "include": ["./src/**/*", "./test/**/*"]
}
```

- [ ] **Step 4: Write `src/types.ts`**

`instructions` accepts any JSON, so its schema is the permissive `{}`; its type is written by hand.
`type` uses `const` so `FromSchema` infers the literal.

```ts
import type { FromSchema, Schema } from '@sozai/schema'

export type Instructions = string | Record<string, unknown> | Array<unknown> | null

const instructionsSchema = {} as const satisfies Schema

export const choiceQuestionSchema = {
  type: 'object',
  properties: {
    type: { const: 'choice' },
    instructions: instructionsSchema,
    criteria: { type: 'object', additionalProperties: { type: 'string' } },
  },
  required: ['type', 'criteria'],
  additionalProperties: false,
} as const satisfies Schema

export const scoreQuestionSchema = {
  type: 'object',
  properties: {
    type: { const: 'score' },
    instructions: instructionsSchema,
    criteria: { type: 'array', items: { type: 'string' }, minItems: 1 },
  },
  required: ['type', 'criteria'],
  additionalProperties: false,
} as const satisfies Schema

export const noulQuestionSchema = {
  type: 'object',
  properties: {
    type: { const: 'noul' },
    instructions: instructionsSchema,
    criteria: {},
  },
  required: ['type'],
  additionalProperties: false,
} as const satisfies Schema

export const questionSchema = {
  anyOf: [choiceQuestionSchema, scoreQuestionSchema, noulQuestionSchema],
} as const satisfies Schema

export const questionMapSchema = {
  type: 'object',
  additionalProperties: questionSchema,
  minProperties: 1,
} as const satisfies Schema

export const stateSchema = {
  anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }, { type: 'array' }],
} as const satisfies Schema

export type ChoiceQuestion = FromSchema<typeof choiceQuestionSchema>
export type ScoreQuestion = FromSchema<typeof scoreQuestionSchema>
export type NoulQuestion = FromSchema<typeof noulQuestionSchema>
export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion
export type QuestionMap = Record<string, Question>
export type State = string | Record<string, unknown> | Array<unknown>

export const choiceAnswerSchema = {
  type: 'object',
  properties: {
    type: { const: 'choice' },
    choice: { type: 'string' },
    confidence: { type: 'number' },
    probabilities: { type: 'object', additionalProperties: { type: 'number' } },
  },
  required: ['type', 'choice', 'confidence', 'probabilities'],
  additionalProperties: false,
} as const satisfies Schema

export const scoreAnswerSchema = {
  type: 'object',
  properties: {
    type: { const: 'score' },
    score: { type: 'number' },
    confidence: { type: 'number' },
    legend: { type: 'object', additionalProperties: true },
    probabilities: { type: 'object', additionalProperties: { type: 'number' } },
  },
  required: ['type', 'score', 'confidence', 'legend', 'probabilities'],
  additionalProperties: false,
} as const satisfies Schema

export const noulAnswerSchema = {
  type: 'object',
  properties: { type: { const: 'noul' }, noul: { type: 'number' } },
  required: ['type', 'noul'],
  additionalProperties: false,
} as const satisfies Schema

export type ChoiceAnswer = FromSchema<typeof choiceAnswerSchema>
export type ScoreAnswer = FromSchema<typeof scoreAnswerSchema>
export type NoulAnswer = FromSchema<typeof noulAnswerSchema>

/** Wire usage: snake_case as returned by the API. Mapped to Usage during validation. */
export const wireUsageSchema = {
  type: 'object',
  properties: { input_tokens: { type: 'integer' }, output_tokens: { type: 'integer' } },
  required: ['input_tokens', 'output_tokens'],
  additionalProperties: true,
} as const satisfies Schema

export type Usage = { inputTokens: number; outputTokens: number }

export const modelMetadataSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    release_date: { type: 'string' },
  },
  required: ['name'],
  additionalProperties: true,
} as const satisfies Schema

export const modelsResponseSchema = {
  type: 'object',
  properties: { models: { type: 'array', items: modelMetadataSchema } },
  required: ['models'],
  additionalProperties: true,
} as const satisfies Schema

export type LayaModel = { name: string; description?: string; releaseDate?: string }

export type AnswerFor<TQuestion> = TQuestion extends ChoiceQuestion
  ? ChoiceAnswer
  : TQuestion extends ScoreQuestion
    ? ScoreAnswer
    : NoulAnswer

export type PredictResult<TQuestions extends QuestionMap> = {
  model: string
  answers: { [K in keyof TQuestions]: AnswerFor<TQuestions[K]> }
  usage: Usage
  extras?: Record<string, unknown>
}
```

- [ ] **Step 5: Write `src/index.ts` re-exporting the types and schemas**

```ts
export type {
  AnswerFor,
  ChoiceAnswer,
  ChoiceQuestion,
  Instructions,
  LayaModel,
  NoulAnswer,
  NoulQuestion,
  PredictResult,
  Question,
  QuestionMap,
  ScoreAnswer,
  ScoreQuestion,
  State,
  Usage,
} from './types.js'
export {
  choiceAnswerSchema,
  choiceQuestionSchema,
  modelMetadataSchema,
  modelsResponseSchema,
  noulAnswerSchema,
  noulQuestionSchema,
  questionMapSchema,
  questionSchema,
  scoreAnswerSchema,
  scoreQuestionSchema,
  stateSchema,
  wireUsageSchema,
} from './types.js'
```

- [ ] **Step 6: Write the type-level test `test/types.test-d.ts`**

```ts
import { expectTypeOf, test } from 'vitest'

import type { ChoiceAnswer, NoulAnswer, PredictResult, ScoreAnswer } from '../src/types.js'

test('PredictResult infers answer shape per question type', () => {
  const questions = {
    dept: { type: 'choice', criteria: { a: 'x' } },
    urgency: { type: 'score', criteria: ['low', 'high'] },
    churn: { type: 'noul' },
  } as const

  type Result = PredictResult<typeof questions>
  expectTypeOf<Result['answers']['dept']>().toEqualTypeOf<ChoiceAnswer>()
  expectTypeOf<Result['answers']['urgency']>().toEqualTypeOf<ScoreAnswer>()
  expectTypeOf<Result['answers']['churn']>().toEqualTypeOf<NoulAnswer>()
  expectTypeOf<Result['model']>().toEqualTypeOf<string>()
})
```

- [ ] **Step 7: Install and type-check**

Run: `pnpm install`
Then: `pnpm --filter @mokei/laya-client run test:types`
Expected: PASS. If `FromSchema` does not narrow a `const` discriminant to its literal, change each `type` property to `{ enum: ['choice'] }` (etc.) — `FromSchema` infers the literal from a single-item `enum`. Re-run until green.

- [ ] **Step 8: Commit**

```bash
git add packages/laya-client
git commit -m "feat: scaffold @mokei/laya-client with schema-first Laya types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Error types

**Files:**
- Create: `packages/laya-client/src/errors.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/errors.test.ts`

**Interfaces:**
- Produces: `LayaError`, `LayaInputError` (with `issues`), `LayaConnectionError`, `LayaAuthError`, `LayaResponseError` (with `issues`), `LayaModelError`, `ValidationIssue`.

- [ ] **Step 1: Write the failing test `test/errors.test.ts`**

```ts
import { describe, expect, test } from 'vitest'

import {
  LayaAuthError,
  LayaConnectionError,
  LayaError,
  LayaInputError,
  LayaModelError,
  LayaResponseError,
} from '../src/errors.js'

describe('Laya errors', () => {
  test('every subclass extends LayaError and keeps its name', () => {
    for (const [err, name] of [
      [new LayaConnectionError('x'), 'LayaConnectionError'],
      [new LayaAuthError('x'), 'LayaAuthError'],
      [new LayaModelError('x'), 'LayaModelError'],
    ] as const) {
      expect(err).toBeInstanceOf(LayaError)
      expect(err.name).toBe(name)
    }
  })

  test('input and response errors carry validation issues', () => {
    const input = new LayaInputError('bad', [{ message: 'missing type', path: ['dept', 'type'] }])
    const response = new LayaResponseError('bad', [{ message: 'missing answers', path: ['answers'] }])
    expect(input).toBeInstanceOf(LayaError)
    expect(input.issues[0].message).toBe('missing type')
    expect(response.issues[0].message).toBe('missing answers')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/errors.test.ts`
Expected: FAIL, cannot resolve `../src/errors.js`.

- [ ] **Step 3: Write `src/errors.ts`**

```ts
export type ValidationIssue = {
  message: string
  path?: ReadonlyArray<unknown>
}

export class LayaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LayaError'
  }
}

class ValidationError extends LayaError {
  #issues: Array<ValidationIssue>

  constructor(message: string, issues: Array<ValidationIssue>, options?: ErrorOptions) {
    super(message, options)
    this.#issues = issues
  }

  get issues(): Array<ValidationIssue> {
    return this.#issues
  }
}

/** Caller-supplied questions or state failed schema validation. Thrown before any request. */
export class LayaInputError extends ValidationError {
  constructor(message: string, issues: Array<ValidationIssue> = [], options?: ErrorOptions) {
    super(message, issues, options)
    this.name = 'LayaInputError'
  }
}

/** The sidecar could not be reached, or returned an unmapped non-2xx status. */
export class LayaConnectionError extends LayaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LayaConnectionError'
  }
}

/** 401 or 403: a missing or rejected Bearer key. */
export class LayaAuthError extends LayaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LayaAuthError'
  }
}

/** The sidecar response was malformed or failed schema validation. */
export class LayaResponseError extends ValidationError {
  constructor(message: string, issues: Array<ValidationIssue> = [], options?: ErrorOptions) {
    super(message, issues, options)
    this.name = 'LayaResponseError'
  }
}

/** 404, or an unknown or unavailable model. */
export class LayaModelError extends LayaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LayaModelError'
  }
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

```ts
export {
  LayaAuthError,
  LayaConnectionError,
  LayaError,
  LayaInputError,
  LayaModelError,
  LayaResponseError,
  type ValidationIssue,
} from './errors.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/errors.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/laya-client/src/errors.ts packages/laya-client/src/index.ts packages/laya-client/test/errors.test.ts
git commit -m "feat: add Laya error hierarchy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Input and response validation

**Files:**
- Create: `packages/laya-client/src/validation.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/validation.test.ts`

**Interfaces:**
- Consumes: schemas + types (Task 1); `LayaInputError`, `LayaResponseError`, `ValidationIssue` (Task 2).
- Produces:
  - `validateQuestions(params: { questions: unknown }): QuestionMap`
  - `validateState(params: { state: unknown }): State`
  - `validateResult<TQuestions extends QuestionMap>(params: { questions: TQuestions; raw: unknown }): PredictResult<TQuestions>`
  - `validateModels(params: { raw: unknown }): Array<LayaModel>`

`validateResult` checks each answer against the schema its question type demands, maps wire `usage`
to `Usage`, and passes through unknown top-level fields as `extras`. A `choice` label outside
`criteria` is accepted; only structural shape is enforced.

- [ ] **Step 1: Write the failing test `test/validation.test.ts`**

```ts
import { describe, expect, test } from 'vitest'

import { LayaInputError, LayaResponseError } from '../src/errors.js'
import { validateModels, validateQuestions, validateResult, validateState } from '../src/validation.js'

const questions = {
  dept: { type: 'choice', criteria: { billing: 'x', tech: 'y' } },
  urgency: { type: 'score', criteria: ['low', 'high'] },
  churn: { type: 'noul' },
} as const

describe('validateQuestions / validateState', () => {
  test('accepts a valid question map and state', () => {
    expect(validateQuestions({ questions })).toBe(questions as unknown)
    expect(validateState({ state: { body: 'hi' } })).toEqual({ body: 'hi' })
  })

  test('throws LayaInputError on a malformed question (missing criteria)', () => {
    expect(() => validateQuestions({ questions: { dept: { type: 'choice' } } })).toThrow(LayaInputError)
  })

  test('throws LayaInputError on an empty question map', () => {
    expect(() => validateQuestions({ questions: {} })).toThrow(LayaInputError)
  })
})

describe('validateResult', () => {
  test('accepts a well-formed response, maps usage, keeps a label outside criteria', () => {
    const raw = {
      model: 'english',
      answers: {
        dept: { type: 'choice', choice: 'unlisted', confidence: 0.9, probabilities: { unlisted: 0.9 } },
        urgency: { type: 'score', score: 1.4, confidence: 0.8, legend: {}, probabilities: { low: 0.2 } },
        churn: { type: 'noul', noul: 0.7 },
      },
      usage: { input_tokens: 12, output_tokens: 3 },
      family: 'english',
    }
    const result = validateResult({ questions, raw })
    expect(result.answers.dept.choice).toBe('unlisted')
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 })
    expect(result.extras).toEqual({ family: 'english' })
  })

  test('throws LayaResponseError when answers is missing', () => {
    expect(() => validateResult({ questions, raw: { model: 'english', usage: { input_tokens: 0, output_tokens: 0 } } })).toThrow(LayaResponseError)
  })

  test('throws LayaResponseError when an answer has the wrong shape', () => {
    const raw = {
      model: 'english',
      answers: { dept: { type: 'choice', confidence: 0.9 }, urgency: {}, churn: {} },
      usage: { input_tokens: 0, output_tokens: 0 },
    }
    expect(() => validateResult({ questions, raw })).toThrow(LayaResponseError)
  })
})

describe('validateModels', () => {
  test('maps release_date to releaseDate', () => {
    const models = validateModels({ raw: { models: [{ name: 'english', release_date: '2025-01-01' }] } })
    expect(models).toEqual([{ name: 'english', description: undefined, releaseDate: '2025-01-01' }])
  })

  test('throws LayaResponseError on a bad models list', () => {
    expect(() => validateModels({ raw: { models: 'x' } })).toThrow(LayaResponseError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/validation.test.ts`
Expected: FAIL, cannot resolve `../src/validation.js`.

- [ ] **Step 3: Write `src/validation.ts`**

```ts
import { createValidator, type Validator } from '@sozai/schema'

import { LayaInputError, LayaResponseError, type ValidationIssue } from './errors.js'
import {
  choiceAnswerSchema,
  modelsResponseSchema,
  noulAnswerSchema,
  type LayaModel,
  type PredictResult,
  type Question,
  type QuestionMap,
  questionMapSchema,
  scoreAnswerSchema,
  type State,
  stateSchema,
  type Usage,
  wireUsageSchema,
} from './types.js'

const questionMapValidator = createValidator(questionMapSchema)
const stateValidator = createValidator(stateSchema)
const choiceAnswerValidator = createValidator(choiceAnswerSchema)
const scoreAnswerValidator = createValidator(scoreAnswerSchema)
const noulAnswerValidator = createValidator(noulAnswerSchema)
const usageValidator = createValidator(wireUsageSchema)
const modelsValidator = createValidator(modelsResponseSchema)

function toIssues(prefix: string, issues: ReadonlyArray<{ message: string; path?: unknown }>) {
  return issues.map((issue) => ({
    message: `${prefix}: ${issue.message}`,
    path: issue.path as ReadonlyArray<unknown>,
  })) satisfies Array<ValidationIssue>
}

function run<T>(validator: Validator<T>, value: unknown, prefix: string): Array<ValidationIssue> {
  const result = validator(value)
  return result.issues == null ? [] : toIssues(prefix, result.issues)
}

export function validateQuestions(params: { questions: unknown }): QuestionMap {
  const issues = run(questionMapValidator, params.questions, 'questions')
  if (issues.length > 0) {
    throw new LayaInputError('Invalid question map', issues)
  }
  return params.questions as QuestionMap
}

export function validateState(params: { state: unknown }): State {
  const issues = run(stateValidator, params.state, 'state')
  if (issues.length > 0) {
    throw new LayaInputError('Invalid state', issues)
  }
  return params.state as State
}

function answerValidatorFor(question: Question) {
  switch (question.type) {
    case 'choice':
      return choiceAnswerValidator
    case 'score':
      return scoreAnswerValidator
    case 'noul':
      return noulAnswerValidator
  }
}

export function validateResult<TQuestions extends QuestionMap>(params: {
  questions: TQuestions
  raw: unknown
}): PredictResult<TQuestions> {
  const { questions, raw } = params
  if (raw == null || typeof raw !== 'object') {
    throw new LayaResponseError('Response is not an object')
  }
  const record = raw as Record<string, unknown>
  const { answers, usage, model, ...extras } = record
  if (answers == null || typeof answers !== 'object') {
    throw new LayaResponseError('Response is missing answers', [
      { message: 'answers must be an object', path: ['answers'] },
    ])
  }
  if (typeof model !== 'string') {
    throw new LayaResponseError('Response is missing model', [
      { message: 'model must be a string', path: ['model'] },
    ])
  }
  const answerRecord = answers as Record<string, unknown>
  const issues: Array<ValidationIssue> = []
  for (const [key, question] of Object.entries(questions)) {
    issues.push(...run(answerValidatorFor(question), answerRecord[key], `answers.${key}`))
  }
  const usageIssues = run(usageValidator, usage, 'usage')
  issues.push(...usageIssues)
  if (issues.length > 0) {
    throw new LayaResponseError('Response failed validation', issues)
  }
  const wireUsage = usage as { input_tokens: number; output_tokens: number }
  const mappedUsage: Usage = {
    inputTokens: wireUsage.input_tokens,
    outputTokens: wireUsage.output_tokens,
  }
  return {
    model,
    answers: answerRecord,
    usage: mappedUsage,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  } as PredictResult<TQuestions>
}

export function validateModels(params: { raw: unknown }): Array<LayaModel> {
  const issues = run(modelsValidator, params.raw, 'models')
  if (issues.length > 0) {
    throw new LayaResponseError('Invalid models list', issues)
  }
  const wire = params.raw as {
    models: Array<{ name: string; description?: string; release_date?: string }>
  }
  return wire.models.map((entry) => ({
    name: entry.name,
    description: entry.description,
    releaseDate: entry.release_date,
  }))
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

```ts
export { validateModels, validateQuestions, validateResult, validateState } from './validation.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/validation.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/laya-client/src/validation.ts packages/laya-client/src/index.ts packages/laya-client/test/validation.test.ts
git commit -m "feat: add Laya input and response validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Backend seam types

**Files:**
- Create: `packages/laya-client/src/backend.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/backend.test-d.ts`

**Interfaces:**
- Consumes: `State`, `QuestionMap`, `Usage`, `LayaModel` (Task 1).
- Produces: `LayaResult`, `LayaBackendPredictParams`, `LayaBackendBatchParams`, `LayaBackendListModelsParams`, `LayaBackend`.

- [ ] **Step 1: Write `src/backend.ts`**

```ts
import type { LayaModel, QuestionMap, State, Usage } from './types.js'

export type LayaResult = {
  model: string
  answers: Record<string, unknown>
  usage: Usage
  extras?: Record<string, unknown>
}

export type LayaBackendPredictParams = {
  state: State
  questions: QuestionMap
  model: string
  signal?: AbortSignal
}

export type LayaBackendBatchParams = {
  states: Array<State>
  questions: QuestionMap
  model: string
  signal?: AbortSignal
}

export type LayaBackendListModelsParams = {
  signal?: AbortSignal
}

export type LayaBackend = {
  predict: (params: LayaBackendPredictParams) => Promise<LayaResult>
  batch?: (params: LayaBackendBatchParams) => Promise<Array<LayaResult>>
  listModels?: (params?: LayaBackendListModelsParams) => Promise<Array<LayaModel>>
  close?: () => Promise<void>
}
```

- [ ] **Step 2: Add exports to `src/index.ts`**

```ts
export type {
  LayaBackend,
  LayaBackendBatchParams,
  LayaBackendListModelsParams,
  LayaBackendPredictParams,
  LayaResult,
} from './backend.js'
```

- [ ] **Step 3: Write the type-level test `test/backend.test-d.ts`**

```ts
import { expectTypeOf, test } from 'vitest'

import type { LayaBackend, LayaResult } from '../src/backend.js'

test('a minimal backend needs only predict', () => {
  const backend: LayaBackend = {
    predict: async () =>
      ({ model: 'english', answers: {}, usage: { inputTokens: 0, outputTokens: 0 } }) satisfies LayaResult,
  }
  expectTypeOf(backend.predict).toBeFunction()
  expectTypeOf(backend.batch).toEqualTypeOf<LayaBackend['batch']>()
})
```

- [ ] **Step 4: Run test to verify it compiles**

Run: `pnpm --filter @mokei/laya-client run test:types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/laya-client/src/backend.ts packages/laya-client/src/index.ts packages/laya-client/test/backend.test-d.ts
git commit -m "feat: add Laya backend seam types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: LayaClient over a backend

**Files:**
- Create: `packages/laya-client/src/client.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/client.test.ts`

**Interfaces:**
- Consumes: `LayaBackend`, `LayaResult` (Task 4); `validateQuestions`, `validateState`, `validateResult` (Task 3); `LayaError` (Task 2); `LayaModel`, `PredictResult`, `QuestionMap`, `State` (Task 1).
- Produces: `LayaPredictParams<TQuestions>`, `LayaPredictBatchParams<TQuestions>`, `LayaListModelsParams`, `LayaBackendClientOptions`, `LayaClient`.

Review Focus pinned here: malformed questions throw `LayaInputError` before any backend call; missing
model throws `LayaError`; empty-batch short-circuit; batch fallback.

- [ ] **Step 1: Write the failing test `test/client.test.ts`**

```ts
import { describe, expect, test, vi } from 'vitest'

import type { LayaBackend, LayaResult } from '../src/backend.js'
import { LayaClient } from '../src/client.js'
import { LayaError, LayaInputError } from '../src/errors.js'

const questions = { dept: { type: 'choice', criteria: { billing: 'x' } } } as const

function result(answers: Record<string, unknown>): LayaResult {
  return { model: 'english', answers, usage: { inputTokens: 1, outputTokens: 1 } }
}

describe('LayaClient.predict', () => {
  test('validates, dispatches, returns a typed result', async () => {
    const backend: LayaBackend = {
      predict: vi.fn(async () =>
        result({ dept: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.9 } } }),
      ),
    }
    const client = new LayaClient({ backend, defaultModel: 'english' })
    const res = await client.predict({ state: 'hi', questions })
    expect(res.answers.dept.choice).toBe('billing')
  })

  test('throws LayaInputError on a malformed question map before any backend call', async () => {
    const predict = vi.fn()
    const client = new LayaClient({ backend: { predict }, defaultModel: 'english' })
    await expect(
      client.predict({ state: 'hi', questions: { dept: { type: 'choice' } } as never }),
    ).rejects.toThrow(LayaInputError)
    expect(predict).not.toHaveBeenCalled()
  })

  test('throws LayaError when no model resolves', async () => {
    const predict = vi.fn()
    const client = new LayaClient({ backend: { predict } })
    await expect(client.predict({ state: 'hi', questions })).rejects.toThrow(LayaError)
    expect(predict).not.toHaveBeenCalled()
  })

  test('per-call model overrides defaultModel', async () => {
    const predict = vi.fn(async () =>
      result({ dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: { billing: 1 } } }),
    )
    const client = new LayaClient({ backend: { predict }, defaultModel: 'english' })
    await client.predict({ state: 'hi', questions, model: 'multilingual' })
    expect(predict.mock.calls[0][0].model).toBe('multilingual')
  })
})

describe('LayaClient.predictBatch', () => {
  const answer = { dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: { billing: 1 } } }

  test('returns [] and issues no request for empty states', async () => {
    const predict = vi.fn()
    const client = new LayaClient({ backend: { predict }, defaultModel: 'english' })
    expect(await client.predictBatch({ states: [], questions })).toEqual([])
    expect(predict).not.toHaveBeenCalled()
  })

  test('uses backend.batch when present', async () => {
    const batch = vi.fn(async () => [result(answer), result(answer)])
    const client = new LayaClient({ backend: { predict: vi.fn(), batch }, defaultModel: 'english' })
    expect(await client.predictBatch({ states: ['a', 'b'], questions })).toHaveLength(2)
    expect(batch).toHaveBeenCalledOnce()
  })

  test('falls back to sequential predict when batch is absent', async () => {
    const predict = vi.fn(async () => result(answer))
    const client = new LayaClient({ backend: { predict }, defaultModel: 'english' })
    expect(await client.predictBatch({ states: ['a', 'b'], questions })).toHaveLength(2)
    expect(predict).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/client.test.ts`
Expected: FAIL, cannot resolve `../src/client.js`.

- [ ] **Step 3: Write `src/client.ts`**

```ts
import type { LayaBackend } from './backend.js'
import { LayaError } from './errors.js'
import type { LayaModel, PredictResult, QuestionMap, State } from './types.js'
import { validateQuestions, validateResult, validateState } from './validation.js'

export type LayaPredictParams<TQuestions extends QuestionMap> = {
  state: State
  questions: TQuestions
  model?: string
  signal?: AbortSignal
}

export type LayaPredictBatchParams<TQuestions extends QuestionMap> = {
  states: Array<State>
  questions: TQuestions
  model?: string
  signal?: AbortSignal
}

export type LayaListModelsParams = {
  signal?: AbortSignal
}

export type LayaBackendClientOptions = {
  backend: LayaBackend
  defaultModel?: string
}

export class LayaClient {
  #backend: LayaBackend
  #defaultModel?: string

  constructor(options: LayaBackendClientOptions) {
    this.#backend = options.backend
    this.#defaultModel = options.defaultModel
  }

  #resolveModel(model?: string): string {
    const resolved = model ?? this.#defaultModel
    if (resolved == null) {
      throw new LayaError('A model is required: pass `model` or set `defaultModel`')
    }
    return resolved
  }

  async predict<TQuestions extends QuestionMap>(
    params: LayaPredictParams<TQuestions>,
  ): Promise<PredictResult<TQuestions>> {
    validateQuestions({ questions: params.questions })
    validateState({ state: params.state })
    const model = this.#resolveModel(params.model)
    const raw = await this.#backend.predict({
      state: params.state,
      questions: params.questions,
      model,
      signal: params.signal,
    })
    return validateResult({ questions: params.questions, raw })
  }

  async predictBatch<TQuestions extends QuestionMap>(
    params: LayaPredictBatchParams<TQuestions>,
  ): Promise<Array<PredictResult<TQuestions>>> {
    if (params.states.length === 0) {
      return []
    }
    validateQuestions({ questions: params.questions })
    for (const state of params.states) {
      validateState({ state })
    }
    const model = this.#resolveModel(params.model)
    if (this.#backend.batch != null) {
      const raws = await this.#backend.batch({
        states: params.states,
        questions: params.questions,
        model,
        signal: params.signal,
      })
      return raws.map((raw) => validateResult({ questions: params.questions, raw }))
    }
    const results: Array<PredictResult<TQuestions>> = []
    for (const state of params.states) {
      const raw = await this.#backend.predict({
        state,
        questions: params.questions,
        model,
        signal: params.signal,
      })
      results.push(validateResult({ questions: params.questions, raw }))
    }
    return results
  }

  async listModels(params?: LayaListModelsParams): Promise<Array<LayaModel>> {
    if (this.#backend.listModels == null) {
      throw new LayaError('Backend does not support listModels')
    }
    return this.#backend.listModels(params)
  }
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

```ts
export {
  LayaClient,
  type LayaBackendClientOptions,
  type LayaListModelsParams,
  type LayaPredictBatchParams,
  type LayaPredictParams,
} from './client.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/client.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/laya-client/src/client.ts packages/laya-client/src/index.ts packages/laya-client/test/client.test.ts
git commit -m "feat: add LayaClient with input validation and model resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: HttpLayaBackend and createLayaClient

**Files:**
- Create: `packages/laya-client/src/http.ts`
- Modify: `packages/laya-client/src/client.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/http.test.ts`

**Interfaces:**
- Consumes: `LayaBackend` + backend param types, `LayaResult` (Task 4); `validateModels` (Task 3); error types (Task 2); `LayaClient`, `LayaBackendClientOptions` (Task 5).
- Produces: `LayaHTTPClientOptions`, `HttpLayaBackendParams`, `HttpLayaBackend`, `CreateLayaClientOptions`, `createLayaClient(options: CreateLayaClientOptions): LayaClient`.

`HttpLayaBackend` targets the TypeSafe System One contract. `predict`/`batch` return the raw response
envelope (the client validates answers, since only the client knows the questions). `listModels`
maps via `validateModels`. Bearer header when `apiKey` set. Status mapping: 401/403 → `LayaAuthError`,
404 → `LayaModelError`, other non-2xx / network → `LayaConnectionError`. Review Focus pinned here:
auth error mapping, abort does not hang.

- [ ] **Step 1: Write the failing test `test/http.test.ts`**

```ts
import { afterEach, describe, expect, test, vi } from 'vitest'

import { LayaAuthError, LayaConnectionError } from '../src/errors.js'
import { HttpLayaBackend } from '../src/http.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubJSON(body: unknown, init: { status?: number } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string) => {
      const req = input instanceof Request ? input : new Request(input)
      ;(globalThis as Record<string, unknown>).__lastRequest = req
      return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

const questions = { dept: { type: 'choice', criteria: { billing: 'x' } } } as const

describe('HttpLayaBackend', () => {
  test('predict posts to /v1/systemone with a Bearer header and returns the raw envelope', async () => {
    stubJSON({ model: 'english', answers: { dept: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.9 } } }, usage: { input_tokens: 1, output_tokens: 1 } })
    const backend = new HttpLayaBackend({ url: 'http://localhost:8000', apiKey: 'secret' })
    const res = await backend.predict({ state: 'hi', questions, model: 'english' })
    const req = (globalThis as Record<string, unknown>).__lastRequest as Request
    expect(req.url).toBe('http://localhost:8000/v1/systemone')
    expect(req.headers.get('authorization')).toBe('Bearer secret')
    expect(res.model).toBe('english')
  })

  test('maps 401 to LayaAuthError', async () => {
    stubJSON({ error: 'unauthorized' }, { status: 401 })
    const backend = new HttpLayaBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(LayaAuthError)
  })

  test('maps 500 to LayaConnectionError', async () => {
    stubJSON({ error: 'boom' }, { status: 500 })
    const backend = new HttpLayaBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions, model: 'english' })).rejects.toThrow(LayaConnectionError)
  })

  test('an aborted request rejects and does not hang', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: Request | string, opts?: { signal?: AbortSignal }) => {
        const signal = input instanceof Request ? input.signal : opts?.signal
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }),
    )
    const backend = new HttpLayaBackend({ url: 'http://localhost:8000' })
    const controller = new AbortController()
    const pending = backend.predict({ state: 'hi', questions, model: 'english', signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/http.test.ts`
Expected: FAIL, cannot resolve `../src/http.js`.

- [ ] **Step 3: Write `src/http.ts`**

```ts
import ky, { HTTPError, type KyInstance } from 'ky'

import type {
  LayaBackend,
  LayaBackendBatchParams,
  LayaBackendListModelsParams,
  LayaBackendPredictParams,
  LayaResult,
} from './backend.js'
import { LayaAuthError, LayaConnectionError, LayaModelError } from './errors.js'
import { validateModels } from './validation.js'

export type LayaHTTPClientOptions = {
  url: string
  apiKey?: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  timeout?: number
  defaultModel?: string
}

export type HttpLayaBackendParams = Omit<LayaHTTPClientOptions, 'defaultModel'>

async function mapError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (cause) {
    if (cause instanceof HTTPError) {
      const status = cause.response.status
      if (status === 401 || status === 403) {
        throw new LayaAuthError('Laya sidecar rejected the API key', { cause })
      }
      if (status === 404) {
        throw new LayaModelError('Model or endpoint not found', { cause })
      }
      throw new LayaConnectionError(`Sidecar returned ${status}`, { cause })
    }
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause
    }
    throw new LayaConnectionError('Failed to reach Laya sidecar', { cause })
  }
}

export class HttpLayaBackend implements LayaBackend {
  #http: KyInstance

  constructor(params: HttpLayaBackendParams) {
    const headers = { ...params.headers }
    if (params.apiKey != null) {
      headers.Authorization = `Bearer ${params.apiKey}`
    }
    this.#http = ky.create({
      prefixUrl: params.url,
      headers,
      fetch: params.fetch,
      timeout: params.timeout,
    })
  }

  async predict(params: LayaBackendPredictParams): Promise<LayaResult> {
    return mapError(() =>
      this.#http
        .post('v1/systemone', {
          json: { state: params.state, model: params.model, questions: params.questions },
          signal: params.signal,
        })
        .json<LayaResult>(),
    )
  }

  async batch(params: LayaBackendBatchParams): Promise<Array<LayaResult>> {
    const body = await mapError(() =>
      this.#http
        .post('v1/decide/batch', {
          json: { states: params.states, model: params.model, questions: params.questions },
          signal: params.signal,
        })
        .json<{ results: Array<LayaResult> }>(),
    )
    return body.results
  }

  async listModels(params?: LayaBackendListModelsParams) {
    const raw = await mapError(() => this.#http.get('v1/models', { signal: params?.signal }).json())
    return validateModels({ raw })
  }
}
```

Note: `ky` `prefixUrl` requires paths without a leading slash, hence `v1/systemone`.

- [ ] **Step 4: Append `createLayaClient` to `src/client.ts`**

```ts
import { HttpLayaBackend, type LayaHTTPClientOptions } from './http.js'

export type CreateLayaClientOptions = LayaHTTPClientOptions | LayaBackendClientOptions

export function createLayaClient(options: CreateLayaClientOptions): LayaClient {
  if ('backend' in options) {
    return new LayaClient(options)
  }
  return new LayaClient({
    backend: new HttpLayaBackend(options),
    defaultModel: options.defaultModel,
  })
}
```

- [ ] **Step 5: Add exports to `src/index.ts`**

```ts
export { HttpLayaBackend, type HttpLayaBackendParams, type LayaHTTPClientOptions } from './http.js'
export { createLayaClient, type CreateLayaClientOptions } from './client.js'
```

- [ ] **Step 6: Run tests, then the full package**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/http.test.ts`
Expected: PASS (4 tests).
Then: `pnpm --filter @mokei/laya-client run test`
Expected: PASS (type + unit).

- [ ] **Step 7: Commit**

```bash
git add packages/laya-client/src/http.ts packages/laya-client/src/client.ts packages/laya-client/src/index.ts packages/laya-client/test/http.test.ts
git commit -m "feat: add HttpLayaBackend (TypeSafe System One) and createLayaClient

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Preset question sets

**Files:**
- Create: `packages/laya-client/src/presets.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/presets.test.ts`

**Interfaces:**
- Consumes: `QuestionMap` (Task 1).
- Produces: `routerQuestions(): QuestionMap`, `guardQuestions(): QuestionMap`, `moderationQuestions(): QuestionMap`, `triageQuestions(): QuestionMap`.

Each factory returns a fresh object.

- [ ] **Step 1: Write the failing test `test/presets.test.ts`**

```ts
import { describe, expect, test } from 'vitest'

import { validateQuestions } from '../src/validation.js'
import {
  guardQuestions,
  moderationQuestions,
  routerQuestions,
  triageQuestions,
} from '../src/presets.js'

describe('preset question sets', () => {
  test('every preset is a valid question map', () => {
    for (const questions of [routerQuestions(), guardQuestions(), moderationQuestions(), triageQuestions()]) {
      expect(() => validateQuestions({ questions })).not.toThrow()
    }
  })

  test('guardQuestions has a noul jailbreak question; triage has a choice department', () => {
    expect(guardQuestions().jailbreak.type).toBe('noul')
    const dept = triageQuestions().department
    expect(dept.type).toBe('choice')
    if (dept.type === 'choice') {
      expect(Object.keys(dept.criteria).length).toBeGreaterThan(1)
    }
  })

  test('each factory returns a fresh object', () => {
    expect(routerQuestions()).not.toBe(routerQuestions())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/presets.test.ts`
Expected: FAIL, cannot resolve `../src/presets.js`.

- [ ] **Step 3: Write `src/presets.ts`**

```ts
import type { QuestionMap } from './types.js'

/** Which model tier should handle this input. */
export function routerQuestions(): QuestionMap {
  return {
    tier: {
      type: 'choice',
      instructions: 'Which model tier should handle this request?',
      criteria: {
        small: 'simple, short, or low-stakes requests',
        large: 'complex, long, or high-stakes requests',
      },
    },
  }
}

/** Prompt-injection / jailbreak detection. */
export function guardQuestions(): QuestionMap {
  return {
    jailbreak: {
      type: 'noul',
      instructions: 'Does this input attempt to jailbreak, injection-attack, or bypass safety rules?',
    },
  }
}

/** Content moderation. */
export function moderationQuestions(): QuestionMap {
  return {
    unsafe: {
      type: 'noul',
      instructions: 'Does this content violate a general safety policy (violence, hate, sexual, self-harm)?',
    },
    severity: {
      type: 'score',
      instructions: 'How severe is any policy violation?',
      criteria: ['none', 'mild', 'severe'],
    },
  }
}

/** Support-ticket triage. */
export function triageQuestions(): QuestionMap {
  return {
    department: {
      type: 'choice',
      instructions: 'Which department should handle this?',
      criteria: {
        billing: 'invoices, payments, refunds',
        technical: 'bugs, outages, errors',
        sales: 'pricing, contracts',
        other: 'everything else',
      },
    },
    urgency: {
      type: 'score',
      instructions: 'How urgent is this request?',
      criteria: ['not urgent', 'soon', 'critical deadline'],
    },
  }
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

```ts
export { guardQuestions, moderationQuestions, routerQuestions, triageQuestions } from './presets.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/presets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/laya-client/src/presets.ts packages/laya-client/src/index.ts packages/laya-client/test/presets.test.ts
git commit -m "feat: add Laya preset question sets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: routeIntent helper

**Files:**
- Create: `packages/laya-client/src/routeIntent.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/routeIntent.test.ts`

**Interfaces:**
- Consumes: `LayaClient` (Task 5); `ChoiceQuestion`, `State` (Task 1).
- Produces: `IntentRoute`, `RouteIntentParams`, `routeIntent(params: RouteIntentParams): Promise<IntentRoute>`.

- [ ] **Step 1: Write the failing test `test/routeIntent.test.ts`**

```ts
import { describe, expect, test, vi } from 'vitest'

import { LayaClient } from '../src/client.js'
import { routeIntent } from '../src/routeIntent.js'
import type { ChoiceQuestion } from '../src/types.js'

const question: ChoiceQuestion = {
  type: 'choice',
  instructions: 'Which tool?',
  criteria: { search: 'lookups', write: 'edits' },
}

describe('routeIntent', () => {
  test('returns the top label, confidence, and model', async () => {
    const client = new LayaClient({
      backend: {
        predict: vi.fn(async () => ({
          model: 'english',
          answers: { intent: { type: 'choice', choice: 'search', confidence: 0.88, probabilities: { search: 0.88 } } },
          usage: { inputTokens: 1, outputTokens: 1 },
        })),
      },
      defaultModel: 'english',
    })
    const route = await routeIntent({ client, state: 'find the docs', question })
    expect(route).toEqual({ label: 'search', confidence: 0.88, model: 'english' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/routeIntent.test.ts`
Expected: FAIL, cannot resolve `../src/routeIntent.js`.

- [ ] **Step 3: Write `src/routeIntent.ts`**

```ts
import type { LayaClient } from './client.js'
import type { ChoiceQuestion, State } from './types.js'

export type IntentRoute = {
  label: string
  confidence: number
  model: string
}

export type RouteIntentParams = {
  client: LayaClient
  state: State
  question: ChoiceQuestion
  model?: string
  signal?: AbortSignal
}

export async function routeIntent(params: RouteIntentParams): Promise<IntentRoute> {
  const result = await params.client.predict({
    state: params.state,
    questions: { intent: params.question },
    model: params.model,
    signal: params.signal,
  })
  const answer = result.answers.intent
  return { label: answer.choice, confidence: answer.confidence, model: result.model }
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

```ts
export { routeIntent, type IntentRoute, type RouteIntentParams } from './routeIntent.js'
```

- [ ] **Step 5: Run tests, then the full package**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/routeIntent.test.ts`
Expected: PASS.
Then: `pnpm --filter @mokei/laya-client run test`
Expected: PASS (all).

- [ ] **Step 6: Build and lint**

Run: `pnpm --filter @mokei/laya-client run build`
Expected: builds `lib/`.
Run: `rtk proxy pnpm run lint`
Expected: no lint errors on the new files.

- [ ] **Step 7: Commit**

```bash
git add packages/laya-client/src/routeIntent.ts packages/laya-client/src/index.ts packages/laya-client/test/routeIntent.test.ts
git commit -m "feat: add routeIntent helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Add laya-client to the release lockstep

**Files:**
- Modify: `pnpm-workspace.yaml` (the `versioning.fixed` list)

**Interfaces:** none.

- [ ] **Step 1: Add `@mokei/laya-client` to the `versioning.fixed` group**

In `pnpm-workspace.yaml`, add `'@mokei/laya-client'` to the fixed list, after `'@mokei/http-server'`.

- [ ] **Step 2: Verify the release plan still resolves**

Run: `pnpm change status`
Expected: runs without error; `@mokei/laya-client` is part of the fixed group.

- [ ] **Step 3: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "chore: add @mokei/laya-client to release lockstep

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Scaffold `@mokei/mcp-laya` with the predict tool

**Files:**
- Create: `mcp-servers/laya/package.json`
- Create: `mcp-servers/laya/tsconfig.json`
- Create: `mcp-servers/laya/tsconfig.test.json`
- Create: `mcp-servers/laya/manifest.json`
- Create: `mcp-servers/laya/src/config.ts`
- Create: `mcp-servers/laya/src/index.ts`
- Create: `mcp-servers/laya/src/serve.ts`
- Modify: `mcp-servers/config.json`
- Test: `mcp-servers/laya/test/config.test.ts`

**Interfaces:**
- Consumes: `createLayaClient`, `LayaClient`, `QuestionMap`, `State`, `questionSchema`, `stateSchema` (`@mokei/laya-client`); `createTool`, `Schema`, `ServerConfig`, `ToolDefinitions`, `ExtractServerTypes` (`@mokei/context-server`); `serveProcess` (`@mokei/context-server-node`).
- Produces: `createLayaTools(options: LayaToolsOptions)`, `createLayaConfig(options?: LayaToolsOptions)`, `LayaToolsOptions`, `LayaServerTypes`.

Config from env: `LAYA_URL` (default `http://localhost:8000`), `LAYA_API_KEY` (optional Bearer),
`LAYA_MODEL` (default model). The `predict` tool reuses the client's exported `questionSchema` and
`stateSchema` for its input schema, so tool inputs are validated by the same schemas.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@mokei/mcp-laya",
  "version": "0.13.1",
  "description": "Laya classification MCP server",
  "keywords": ["model", "context", "protocol", "mcp", "server", "laya", "classification"],
  "homepage": "https://mokei.dev",
  "repository": {
    "type": "git",
    "url": "https://github.com/TairuFramework/mokei",
    "directory": "mcp-servers/laya"
  },
  "license": "MIT",
  "sideEffects": false,
  "type": "module",
  "exports": { ".": "./lib/index.js" },
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "bin": { "mcp-laya": "./lib/serve.js" },
  "files": ["lib/*"],
  "scripts": {
    "build": "pnpm run build:clean && pnpm run build:js && pnpm run build:types",
    "build:clean": "del lib",
    "build:js": "del 'lib/**/*.js' && swc src -d ./lib --config-file ../../node_modules/@kigu/dev/swc.json --strip-leading-paths",
    "build:types": "del 'lib/**/*.d.ts' 'lib/**/*.d.ts.map' && tsc --emitDeclarationOnly --skipLibCheck",
    "build:types:ci": "tsc --emitDeclarationOnly --skipLibCheck --declarationMap false",
    "prepublishOnly": "pnpm run build",
    "test": "pnpm run test:types && pnpm run test:unit",
    "test:types": "tsc --noEmit --skipLibCheck -p tsconfig.test.json",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@mokei/context-server": "workspace:^",
    "@mokei/context-server-node": "workspace:^",
    "@mokei/laya-client": "workspace:^"
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json` and `tsconfig.test.json`**

`mcp-servers/laya/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "lib": ["es2025", "dom"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./lib",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["./src/**/*"]
}
```

`mcp-servers/laya/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "..",
    "resolveJsonModule": true
  },
  "include": ["./src/**/*", "./test/**/*"]
}
```

- [ ] **Step 3: Write the failing test `test/config.test.ts`**

```ts
import { describe, expect, test, vi } from 'vitest'

import type { LayaClient } from '@mokei/laya-client'

import { createLayaTools } from '../src/config.js'

function fakeClient(answers: Record<string, unknown>): LayaClient {
  return {
    predict: vi.fn(async () => ({ model: 'english', answers, usage: { inputTokens: 1, outputTokens: 1 } })),
  } as unknown as LayaClient
}

describe('createLayaTools', () => {
  test('predict tool calls the client and returns JSON text', async () => {
    const client = fakeClient({ dept: { type: 'choice', choice: 'billing', confidence: 0.9, probabilities: { billing: 0.9 } } })
    const tools = createLayaTools({ client })
    const res = await tools.predict.handler({
      input: { state: 'hi', questions: { dept: { type: 'choice', criteria: { billing: 'x' } } } },
      signal: new AbortController().signal,
    } as never)
    expect(res.isError).toBe(false)
    expect(res.content[0].text).toContain('billing')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm install`
Then: `pnpm --filter @mokei/mcp-laya exec vitest run test/config.test.ts`
Expected: FAIL, cannot resolve `../src/config.js`.

- [ ] **Step 5: Write `src/config.ts`**

```ts
import {
  createTool,
  type ExtractServerTypes,
  type Schema,
  type ServerConfig,
  type ToolDefinitions,
} from '@mokei/context-server'
import {
  createLayaClient,
  type LayaClient,
  type QuestionMap,
  questionSchema,
  type State,
  stateSchema,
} from '@mokei/laya-client'

export type LayaToolsOptions = {
  client?: LayaClient
  url?: string
  apiKey?: string
  defaultModel?: string
}

const questionsInputSchema = {
  type: 'object',
  additionalProperties: questionSchema,
  minProperties: 1,
  description: 'A Laya question map: each key maps to a choice/score/noul question',
} as const satisfies Schema

function resolveClient(options: LayaToolsOptions): LayaClient {
  return (
    options.client ??
    createLayaClient({
      url: options.url ?? process.env.LAYA_URL ?? 'http://localhost:8000',
      apiKey: options.apiKey ?? process.env.LAYA_API_KEY,
      defaultModel: options.defaultModel ?? process.env.LAYA_MODEL,
    })
  )
}

export function createLayaTools(options: LayaToolsOptions = {}) {
  const client = resolveClient(options)

  return {
    predict: createTool({
      description: 'Classify text with Laya typed questions (choice/score/noul)',
      inputSchema: {
        type: 'object',
        properties: {
          state: stateSchema,
          questions: questionsInputSchema,
          model: { type: 'string', description: 'Model name; overrides LAYA_MODEL' },
        },
        required: ['state', 'questions'],
        additionalProperties: false,
      } as const satisfies Schema,
      handler: async (req) => {
        try {
          const result = await client.predict({
            state: req.input.state as State,
            questions: req.input.questions as QuestionMap,
            model: req.input.model as string | undefined,
            signal: req.signal,
          })
          return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
        } catch (err) {
          return { content: [{ type: 'text', text: (err as Error).message }], isError: true }
        }
      },
    }),
  } satisfies ToolDefinitions
}

export function createLayaConfig(options: LayaToolsOptions = {}) {
  return {
    name: 'laya',
    version: '0.1.0',
    protocolVersions: ['2026-07-28', '2025-11-25'],
    tools: createLayaTools(options),
  } as const satisfies ServerConfig
}

export type LayaServerTypes = ExtractServerTypes<ReturnType<typeof createLayaConfig>>
```

- [ ] **Step 6: Write `src/index.ts` and `src/serve.ts`**

`src/index.ts`:

```ts
/**
 * Laya classification MCP server.
 *
 * @module mcp-laya
 */
export { createLayaConfig, createLayaTools, type LayaServerTypes, type LayaToolsOptions } from './config.js'
```

`src/serve.ts`:

```ts
#!/usr/bin/env node
import { serveProcess } from '@mokei/context-server-node'

import { createLayaConfig } from './config.js'

const config = createLayaConfig()

serveProcess(config)
```

- [ ] **Step 7: Write `manifest.json`**

```json
{
  "manifest_version": "0.2",
  "name": "@mokei/mcp-laya",
  "display_name": "Mokei Laya",
  "version": "0.1.0",
  "description": "Laya classification MCP server",
  "author": { "name": "Paul Le Cam" },
  "server": {
    "type": "node",
    "entry_point": "lib/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/lib/index.js"],
      "env": { "LAYA_URL": "http://localhost:8000", "LAYA_MODEL": "", "LAYA_API_KEY": "" }
    }
  },
  "tools": [{ "name": "predict", "description": "Classify text with Laya typed questions" }],
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/TairuFramework/mokei" }
}
```

- [ ] **Step 8: Register the server in `mcp-servers/config.json`**

Add a `laya` entry alongside `fetch` and `sqlite`:

```json
"laya": {
  "command": "node",
  "args": ["mcp-servers/laya/lib/serve.js"],
  "env": { "LAYA_URL": "http://localhost:8000" }
}
```

- [ ] **Step 9: Run the test, build**

Run: `pnpm --filter @mokei/mcp-laya exec vitest run test/config.test.ts`
Expected: PASS.
Then: `pnpm --filter @mokei/mcp-laya run build`
Expected: builds `lib/`, including `serve.js`.

- [ ] **Step 10: Commit**

```bash
git add mcp-servers/laya mcp-servers/config.json
git commit -m "feat: add @mokei/mcp-laya server with predict tool

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Preset MCP tools and lockstep entry

**Files:**
- Modify: `mcp-servers/laya/src/config.ts`
- Modify: `mcp-servers/laya/manifest.json`
- Modify: `mcp-servers/laya/test/config.test.ts`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Consumes: `routerQuestions`, `guardQuestions`, `moderationQuestions`, `triageQuestions` (`@mokei/laya-client`).
- Produces: `route`, `guard`, `moderate`, `triage` tools, each taking `{ state, model? }`.

- [ ] **Step 1: Extend the failing test in `test/config.test.ts`**

Add:

```ts
test('preset tools classify with a fixed question set', async () => {
  const client = fakeClient({ jailbreak: { type: 'noul', noul: 0.1 } })
  const tools = createLayaTools({ client })
  const res = await tools.guard.handler({
    input: { state: 'hello' },
    signal: new AbortController().signal,
  } as never)
  expect(res.isError).toBe(false)
  expect(res.content[0].text).toContain('jailbreak')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/mcp-laya exec vitest run test/config.test.ts`
Expected: FAIL, `tools.guard` is undefined.

- [ ] **Step 3: Add preset tools in `src/config.ts`**

Extend the import from `@mokei/laya-client` with the preset factories and `QuestionMap`. Inside
`createLayaTools`, add a helper and the four tools:

```ts
import {
  createLayaClient,
  guardQuestions,
  type LayaClient,
  moderationQuestions,
  type QuestionMap,
  questionSchema,
  routerQuestions,
  type State,
  stateSchema,
  triageQuestions,
} from '@mokei/laya-client'

// inside createLayaTools, after `predict`:
function presetTool(description: string, questions: QuestionMap) {
  return createTool({
    description,
    inputSchema: {
      type: 'object',
      properties: { state: stateSchema, model: { type: 'string' } },
      required: ['state'],
      additionalProperties: false,
    } as const satisfies Schema,
    handler: async (req) => {
      try {
        const result = await client.predict({
          state: req.input.state as State,
          questions,
          model: req.input.model as string | undefined,
          signal: req.signal,
        })
        return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
      } catch (err) {
        return { content: [{ type: 'text', text: (err as Error).message }], isError: true }
      }
    },
  })
}

// add to the returned object, alongside predict:
route: presetTool('Route to a model tier', routerQuestions()),
guard: presetTool('Detect jailbreak / prompt-injection attempts', guardQuestions()),
moderate: presetTool('Moderate content for safety', moderationQuestions()),
triage: presetTool('Triage a support request', triageQuestions()),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @mokei/mcp-laya exec vitest run test/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Update `manifest.json` tools list**

Add `route`, `guard`, `moderate`, `triage` entries to the `tools` array with one-line descriptions matching the tool descriptions.

- [ ] **Step 6: Add `@mokei/mcp-laya` to the release lockstep**

In `pnpm-workspace.yaml`, add `'@mokei/mcp-laya'` to `versioning.fixed`, grouped with the other `@mokei/mcp-*` packages.

- [ ] **Step 7: Full build and lint**

Run: `pnpm --filter @mokei/mcp-laya run test`
Expected: PASS.
Run: `pnpm --filter @mokei/mcp-laya run build`
Expected: builds.
Run: `rtk proxy pnpm run lint`
Expected: no lint errors.
Run: `pnpm change status`
Expected: runs without error.

- [ ] **Step 8: Commit**

```bash
git add mcp-servers/laya pnpm-workspace.yaml
git commit -m "feat: add Laya preset MCP tools and release lockstep entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Wire contract and sidecar setup docs

**Files:**
- Create: `docs/reference/laya-sidecar.md`

**Interfaces:** none.

The document is the single source for the TypeSafe System One contract that `HttpLayaBackend`
targets, plus how to run the sidecar. Documentation only.

- [ ] **Step 1: Write `docs/reference/laya-sidecar.md`**

Include, as prose and code blocks:

1. That `@mokei/laya-client` speaks the TypeSafe System One API, served by two interchangeable backends: the local `laya serve` binary from [ggmlc](https://github.com/monatis/ggmlc) releases, and the hosted `https://api.typesafe.ai` (Bearer key).
2. The endpoint table:

```
POST /v1/systemone      { state, model, questions }                -> { model, answers, usage }
GET  /v1/models                                                    -> { models: [{ name, description, release_date }] }
POST /v1/decide/batch   { states: [...], model, questions }        -> { results: [{ model, answers, usage }] }   (laya.cpp only)
```

3. The answer shapes per primitive: `choice` → `{ type, choice, confidence, probabilities }`; `score` → `{ type, score, confidence, legend, probabilities }`; `noul` → `{ type, noul }`. `usage` is `{ input_tokens, output_tokens }`.
4. Local setup:

```bash
# Compile a GGUF once (Python, one-off)
uv pip install laya
python examples/laya/compile_laya.py --family english --quantize f16

# Run the server from a ggmlc release binary
laya serve english-f16.gguf --port 8000 --device auto
```

5. Client usage against each backend:

```ts
import { createLayaClient } from '@mokei/laya-client'

// Local laya serve
const local = createLayaClient({ url: 'http://localhost:8000', defaultModel: 'english' })

// Hosted TypeSafe
const hosted = createLayaClient({
  url: 'https://api.typesafe.ai',
  apiKey: process.env.TYPESAFE_API_KEY,
  defaultModel: 'english',
})
```

6. The MCP server env vars: `LAYA_URL`, `LAYA_API_KEY`, `LAYA_MODEL`.
7. A note that a future in-process backend will bind ggml / `laya.cpp` (native or WASM) behind the same `LayaBackend` seam, removing the sidecar requirement; the ONNX path is superseded.

- [ ] **Step 2: Verify the contract matches the client**

Read `packages/laya-client/src/http.ts` and confirm every path, method, and body field in the doc matches what `HttpLayaBackend` sends. Fix the doc if they diverge.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/laya-sidecar.md
git commit -m "docs: add Laya TypeSafe wire contract and sidecar setup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Full-workspace verification

**Files:** none (verification only).

- [ ] **Step 1: Build the whole workspace**

Run: `pnpm build`
Expected: all packages build, including `@mokei/laya-client` and `@mokei/mcp-laya`.

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: PASS across packages and integration tests.

- [ ] **Step 3: Lint and type-check**

Run: `rtk proxy pnpm run lint`
Expected: clean.
Run: `pnpm test:types`
Expected: clean.

- [ ] **Step 4: Confirm no stray changes**

Run: `git status`
Expected: clean tree; every change already committed under the tasks above.
