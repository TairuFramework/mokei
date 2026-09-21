# Laya classification support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform-neutral TypeScript Laya classification client, an MCP server exposing it, and a documented HTTP sidecar contract.

**Architecture:** A neutral `@mokei/laya-client` defines Laya's typed-question API (`choice`/`score`/`noul`) over a pluggable `LayaBackend` seam. One backend ships now: `HttpLayaBackend` (ky) talking to a user-run Laya sidecar. `@mokei/mcp-laya` reuses the client to expose classification tools. An in-process ONNX backend is deferred; only the seam is built.

**Tech Stack:** TypeScript (ES2025, NodeNext, ESM), `ky` (fetch HTTP), `@sozai/schema` (validation), `@mokei/context-server` + `@mokei/context-server-node` (MCP server), vitest, Biome, swc, turbo.

**Spec:** `docs/superpowers/specs/2026-09-21-laya-onnx-classification-design.md`

## Global Constraints

- TypeScript: `type` not `interface`; `Array<T>` not `T[]`; never `any` (use `unknown` / `Record<string, unknown>`); ES private `#field` + getter, never `private`/`readonly`/`protected`; every public method and factory takes a single parameters object; capital `ID`/`HTTP` in identifiers; `import type` for type-only imports.
- Every parameter object, option object, and result shape on the public API is a named, exported type. No anonymous inline object type in a public signature.
- `@mokei/laya-client` is platform-neutral: runtime dependencies are `ky` and `@sozai/schema` only. No `node:*` imports. tsconfig `lib` is `["es2025", "dom"]` with no `"types": ["node"]`.
- ESM only, `"type": "module"`, `moduleResolution: NodeNext`, strict mode. Relative imports end in `.js`.
- Biome formatting: 2-space indent, 100-col width, single quotes, trailing commas, arrow parens always.
- Both new packages are published and join `versioning.fixed` in `pnpm-workspace.yaml`. Set each new package `version` to the fixed group's current version: `0.13.1`.
- `pnpm` / `pnpx` only, never `npm` / `npx`.
- Lint runs as `rtk proxy pnpm run lint` (an `rtk` shim otherwise redirects `pnpm run lint`). Never edit `package.json` scripts, lint/build config, or `.npmrc`.
- Tests use vitest; test files end in `.test.ts` under `test/`; type tests run via `tsconfig.test.json`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

- Sidecar returns a `choice` label absent from the question's `criteria`. The client must pass it through, not crash. Pinned in Task 5.
- `predictBatch` called with an empty `states` array. Must return `[]` and issue no request. Pinned in Task 5.
- Sidecar response missing `answers`, or an answer with the wrong shape for its primitive. Must throw `LayaResponseError`, not a raw `TypeError`. Pinned in Task 3.
- A request aborted mid-flight via `signal`. Must reject with an abort error and not hang. Pinned in Task 6.
- `model` omitted on a client built with `defaultModel`. Must send `defaultModel`; an explicit `model` must override it. Pinned in Task 5.

---

### Task 1: Scaffold `@mokei/laya-client` and core types

**Files:**
- Create: `packages/laya-client/package.json`
- Create: `packages/laya-client/tsconfig.json`
- Create: `packages/laya-client/tsconfig.test.json`
- Create: `packages/laya-client/src/types.ts`
- Create: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/types.test-d.ts`

**Interfaces:**
- Produces: `ChoiceQuestion`, `ScoreQuestion`, `NoulQuestion`, `Question`, `QuestionMap`, `State`, `ChoiceAnswer`, `ScoreAnswer`, `NoulAnswer`, `RoutingInfo`, `AnswerFor<TQuestion>`, `PredictResult<TQuestions>`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@mokei/laya-client",
  "version": "0.13.1",
  "description": "Mokei Laya classification client",
  "keywords": ["model", "context", "protocol", "mcp", "laya", "classification", "bert"],
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

```ts
/** A multi-class question. `criteria` maps each label to its description. */
export type ChoiceQuestion = {
  type: 'choice'
  instructions: string
  criteria: Record<string, string>
}

/** An ordinal question. `criteria` lists rubric levels low to high. */
export type ScoreQuestion = {
  type: 'score'
  instructions: string
  criteria: Array<string>
}

/** A binary yes/no question. */
export type NoulQuestion = {
  type: 'noul'
  instructions: string
}

export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion

export type QuestionMap = Record<string, Question>

/** Input to classify. An object is flattened to text by the backend. */
export type State = string | Record<string, unknown>

export type ChoiceAnswer = {
  choice: string
  confidence: number
  distribution?: Record<string, number>
}

export type ScoreAnswer = {
  score: number
  confidence: number
  distribution?: Array<number>
}

export type NoulAnswer = {
  noul: number
}

export type RoutingInfo = {
  model: string
  reason: string
}

export type AnswerFor<TQuestion> = TQuestion extends ChoiceQuestion
  ? ChoiceAnswer
  : TQuestion extends ScoreQuestion
    ? ScoreAnswer
    : NoulAnswer

export type PredictResult<TQuestions extends QuestionMap> = {
  answers: { [K in keyof TQuestions]: AnswerFor<TQuestions[K]> }
  routing?: RoutingInfo
}
```

- [ ] **Step 5: Write `src/index.ts` re-exporting the types**

```ts
export type {
  AnswerFor,
  ChoiceAnswer,
  ChoiceQuestion,
  NoulAnswer,
  NoulQuestion,
  PredictResult,
  Question,
  QuestionMap,
  RoutingInfo,
  ScoreAnswer,
  ScoreQuestion,
  State,
} from './types.js'
```

- [ ] **Step 6: Write the type-level test `test/types.test-d.ts`**

```ts
import { expectTypeOf, test } from 'vitest'

import type { ChoiceAnswer, NoulAnswer, PredictResult, ScoreAnswer } from '../src/types.js'

test('PredictResult infers answer shape per question type', () => {
  const questions = {
    dept: { type: 'choice', instructions: '', criteria: { a: 'x' } },
    urgency: { type: 'score', instructions: '', criteria: ['low', 'high'] },
    churn: { type: 'noul', instructions: '' },
  } as const

  type Result = PredictResult<typeof questions>
  expectTypeOf<Result['answers']['dept']>().toEqualTypeOf<ChoiceAnswer>()
  expectTypeOf<Result['answers']['urgency']>().toEqualTypeOf<ScoreAnswer>()
  expectTypeOf<Result['answers']['churn']>().toEqualTypeOf<NoulAnswer>()
})
```

- [ ] **Step 7: Install and build**

Run: `pnpm install`
Then: `pnpm --filter @mokei/laya-client run test:types`
Expected: PASS (type test compiles, inference holds).

- [ ] **Step 8: Commit**

```bash
git add packages/laya-client
git commit -m "feat: scaffold @mokei/laya-client with core Laya types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Error types

**Files:**
- Create: `packages/laya-client/src/errors.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/errors.test.ts`

**Interfaces:**
- Produces: `LayaError`, `LayaConnectionError`, `LayaResponseError` (with `issues` getter), `LayaModelError`, `ValidationIssue`.

- [ ] **Step 1: Write the failing test `test/errors.test.ts`**

```ts
import { describe, expect, test } from 'vitest'

import {
  LayaConnectionError,
  LayaError,
  LayaModelError,
  LayaResponseError,
} from '../src/errors.js'

describe('Laya errors', () => {
  test('subclasses extend LayaError and keep their name', () => {
    const conn = new LayaConnectionError('down')
    expect(conn).toBeInstanceOf(LayaError)
    expect(conn.name).toBe('LayaConnectionError')

    const model = new LayaModelError('unknown model')
    expect(model).toBeInstanceOf(LayaError)
    expect(model.name).toBe('LayaModelError')
  })

  test('LayaResponseError carries validation issues', () => {
    const err = new LayaResponseError('bad', [{ message: 'missing answers', path: ['answers'] }])
    expect(err).toBeInstanceOf(LayaError)
    expect(err.issues).toEqual([{ message: 'missing answers', path: ['answers'] }])
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

/** The sidecar could not be reached or the request failed at the transport level. */
export class LayaConnectionError extends LayaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LayaConnectionError'
  }
}

/** The sidecar response was malformed or failed schema validation. */
export class LayaResponseError extends LayaError {
  #issues: Array<ValidationIssue>

  constructor(message: string, issues: Array<ValidationIssue> = [], options?: ErrorOptions) {
    super(message, options)
    this.name = 'LayaResponseError'
    this.#issues = issues
  }

  get issues(): Array<ValidationIssue> {
    return this.#issues
  }
}

/** The requested model is unknown or unavailable on the sidecar. */
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
  LayaConnectionError,
  LayaError,
  LayaModelError,
  LayaResponseError,
  type ValidationIssue,
} from './errors.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/errors.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/laya-client/src/errors.ts packages/laya-client/src/index.ts packages/laya-client/test/errors.test.ts
git commit -m "feat: add Laya error hierarchy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Response validation

**Files:**
- Create: `packages/laya-client/src/schemas.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/schemas.test.ts`

**Interfaces:**
- Consumes: `LayaResponseError`, `ValidationIssue` (Task 2); `QuestionMap`, `RoutingInfo`, `PredictResult` (Task 1).
- Produces: `validateResult<TQuestions extends QuestionMap>(params: { questions: TQuestions; raw: unknown }): PredictResult<TQuestions>`, `validateRouting(params: { raw: unknown }): RoutingInfo`, `validateModels(params: { raw: unknown }): Array<string>`.

This validates each answer against the shape its question type demands. A `choice` label outside `criteria` is accepted (the model may return any label); only structural shape is enforced. Review Focus: missing `answers` and wrong-shaped answers throw `LayaResponseError`.

- [ ] **Step 1: Write the failing test `test/schemas.test.ts`**

```ts
import { describe, expect, test } from 'vitest'

import { LayaResponseError } from '../src/errors.js'
import { validateModels, validateResult, validateRouting } from '../src/schemas.js'

const questions = {
  dept: { type: 'choice', instructions: '', criteria: { billing: 'x', tech: 'y' } },
  urgency: { type: 'score', instructions: '', criteria: ['low', 'high'] },
  churn: { type: 'noul', instructions: '' },
} as const

describe('validateResult', () => {
  test('accepts a well-formed response, including a label outside criteria', () => {
    const raw = {
      answers: {
        dept: { choice: 'unlisted', confidence: 0.9 },
        urgency: { score: 1.4, confidence: 0.8 },
        churn: { noul: 0.7 },
      },
    }
    const result = validateResult({ questions, raw })
    expect(result.answers.dept.choice).toBe('unlisted')
    expect(result.answers.churn.noul).toBe(0.7)
  })

  test('throws LayaResponseError when answers is missing', () => {
    expect(() => validateResult({ questions, raw: {} })).toThrow(LayaResponseError)
  })

  test('throws LayaResponseError when an answer has the wrong shape', () => {
    const raw = {
      answers: {
        dept: { confidence: 0.9 },
        urgency: { score: 1.4, confidence: 0.8 },
        churn: { noul: 0.7 },
      },
    }
    expect(() => validateResult({ questions, raw })).toThrow(LayaResponseError)
  })
})

describe('validateRouting / validateModels', () => {
  test('validateRouting requires model and reason', () => {
    expect(validateRouting({ raw: { model: 'english', reason: 'latin' } })).toEqual({
      model: 'english',
      reason: 'latin',
    })
    expect(() => validateRouting({ raw: { model: 'english' } })).toThrow(LayaResponseError)
  })

  test('validateModels requires a string array', () => {
    expect(validateModels({ raw: { models: ['a', 'b'] } })).toEqual(['a', 'b'])
    expect(() => validateModels({ raw: { models: 'a' } })).toThrow(LayaResponseError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/schemas.test.ts`
Expected: FAIL, cannot resolve `../src/schemas.js`.

- [ ] **Step 3: Write `src/schemas.ts`**

```ts
import { asType, createValidator } from '@sozai/schema'

import { LayaResponseError, type ValidationIssue } from './errors.js'
import type { PredictResult, Question, QuestionMap, RoutingInfo } from './types.js'

const choiceAnswerValidator = createValidator({
  type: 'object',
  properties: { choice: { type: 'string' }, confidence: { type: 'number' } },
  required: ['choice', 'confidence'],
} as const)

const scoreAnswerValidator = createValidator({
  type: 'object',
  properties: { score: { type: 'number' }, confidence: { type: 'number' } },
  required: ['score', 'confidence'],
} as const)

const noulAnswerValidator = createValidator({
  type: 'object',
  properties: { noul: { type: 'number' } },
  required: ['noul'],
} as const)

const routingValidator = createValidator({
  type: 'object',
  properties: { model: { type: 'string' }, reason: { type: 'string' } },
  required: ['model', 'reason'],
} as const)

const modelsValidator = createValidator({
  type: 'object',
  properties: { models: { type: 'array', items: { type: 'string' } } },
  required: ['models'],
} as const)

function validatorFor(question: Question) {
  switch (question.type) {
    case 'choice':
      return choiceAnswerValidator
    case 'score':
      return scoreAnswerValidator
    case 'noul':
      return noulAnswerValidator
  }
}

function toIssues(prefix: string, issues: ReadonlyArray<{ message: string; path?: unknown }>) {
  return issues.map((issue) => ({
    message: `${prefix}: ${issue.message}`,
    path: issue.path as ReadonlyArray<unknown>,
  })) satisfies Array<ValidationIssue>
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
  const answers = record.answers
  if (answers == null || typeof answers !== 'object') {
    throw new LayaResponseError('Response is missing answers', [
      { message: 'answers must be an object', path: ['answers'] },
    ])
  }
  const answerRecord = answers as Record<string, unknown>
  const issues: Array<ValidationIssue> = []
  for (const [key, question] of Object.entries(questions)) {
    const result = validatorFor(question)(answerRecord[key])
    if (result.issues != null) {
      issues.push(...toIssues(`answers.${key}`, result.issues))
    }
  }
  if (issues.length > 0) {
    throw new LayaResponseError('Response answers failed validation', issues)
  }

  let routing: RoutingInfo | undefined
  if (record.routing != null) {
    routing = validateRouting({ raw: record.routing })
  }
  return { answers: answerRecord, routing } as PredictResult<TQuestions>
}

export function validateRouting(params: { raw: unknown }): RoutingInfo {
  const result = routingValidator(params.raw)
  if (result.issues != null) {
    throw new LayaResponseError('Invalid routing', toIssues('routing', result.issues))
  }
  return asType(routingValidator, params.raw)
}

export function validateModels(params: { raw: unknown }): Array<string> {
  const result = modelsValidator(params.raw)
  if (result.issues != null) {
    throw new LayaResponseError('Invalid models list', toIssues('models', result.issues))
  }
  return (params.raw as { models: Array<string> }).models
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

```ts
export { validateModels, validateResult, validateRouting } from './schemas.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/schemas.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/laya-client/src/schemas.ts packages/laya-client/src/index.ts packages/laya-client/test/schemas.test.ts
git commit -m "feat: add Laya response validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Backend seam types

**Files:**
- Create: `packages/laya-client/src/backend.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/backend.test-d.ts`

**Interfaces:**
- Consumes: `State`, `QuestionMap`, `RoutingInfo` (Task 1).
- Produces: `LayaResult`, `LayaBackendPredictParams`, `LayaBackendRouteParams`, `LayaBackendBatchParams`, `LayaBackendListModelsParams`, `LayaBackend`.

- [ ] **Step 1: Write `src/backend.ts`**

```ts
import type { QuestionMap, RoutingInfo, State } from './types.js'

export type LayaResult = {
  answers: Record<string, unknown>
  routing?: RoutingInfo
}

export type LayaBackendPredictParams = {
  state: State
  questions: QuestionMap
  model?: string
  signal?: AbortSignal
}

export type LayaBackendRouteParams = {
  state: State
  questions: QuestionMap
  signal?: AbortSignal
}

export type LayaBackendBatchParams = {
  states: Array<State>
  questions: QuestionMap
  model?: string
  signal?: AbortSignal
}

export type LayaBackendListModelsParams = {
  signal?: AbortSignal
}

export type LayaBackend = {
  predict: (params: LayaBackendPredictParams) => Promise<LayaResult>
  route?: (params: LayaBackendRouteParams) => Promise<RoutingInfo>
  batch?: (params: LayaBackendBatchParams) => Promise<Array<LayaResult>>
  listModels?: (params?: LayaBackendListModelsParams) => Promise<Array<string>>
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
  LayaBackendRouteParams,
  LayaResult,
} from './backend.js'
```

- [ ] **Step 3: Write the type-level test `test/backend.test-d.ts`**

```ts
import { expectTypeOf, test } from 'vitest'

import type { LayaBackend, LayaResult } from '../src/backend.js'

test('a minimal backend needs only predict', () => {
  const backend: LayaBackend = {
    predict: async () => ({ answers: {} }) satisfies LayaResult,
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
- Consumes: `LayaBackend`, `LayaResult` (Task 4); `validateResult`, `validateRouting` (Task 3); `PredictResult`, `QuestionMap`, `RoutingInfo`, `State` (Task 1).
- Produces: `LayaPredictParams<TQuestions>`, `LayaPredictBatchParams<TQuestions>`, `LayaRouteParams`, `LayaListModelsParams`, `LayaBackendClientOptions`, `LayaClient`, `createLayaClientFromBackend(options: LayaBackendClientOptions): LayaClient`.

`createLayaClient` (both forms) arrives in Task 6, once `HttpLayaBackend` exists. This task builds the client over an injected backend so it is testable without HTTP. Review Focus pinned here: label outside criteria, empty-batch short-circuit, `defaultModel` application and override.

- [ ] **Step 1: Write the failing test `test/client.test.ts`**

```ts
import { describe, expect, test, vi } from 'vitest'

import type { LayaBackend, LayaResult } from '../src/backend.js'
import { LayaClient } from '../src/client.js'

const questions = {
  dept: { type: 'choice', instructions: '', criteria: { billing: 'x' } },
} as const

function backendReturning(result: LayaResult): LayaBackend {
  return { predict: vi.fn(async () => result) }
}

describe('LayaClient.predict', () => {
  test('validates and returns a typed result, passing through an unlisted label', async () => {
    const client = new LayaClient({
      backend: backendReturning({ answers: { dept: { choice: 'unlisted', confidence: 0.9 } } }),
    })
    const result = await client.predict({ state: 'hi', questions })
    expect(result.answers.dept.choice).toBe('unlisted')
  })

  test('applies defaultModel when model is omitted and lets an explicit model override it', async () => {
    const predict = vi.fn(async () => ({ answers: { dept: { choice: 'billing', confidence: 1 } } }))
    const client = new LayaClient({ backend: { predict }, defaultModel: 'english' })

    await client.predict({ state: 'hi', questions })
    expect(predict.mock.calls[0][0].model).toBe('english')

    await client.predict({ state: 'hi', questions, model: 'multilingual' })
    expect(predict.mock.calls[1][0].model).toBe('multilingual')
  })
})

describe('LayaClient.predictBatch', () => {
  test('returns [] and issues no request for an empty states array', async () => {
    const predict = vi.fn()
    const client = new LayaClient({ backend: { predict } })
    const results = await client.predictBatch({ states: [], questions })
    expect(results).toEqual([])
    expect(predict).not.toHaveBeenCalled()
  })

  test('uses backend.batch when present', async () => {
    const batch = vi.fn(async () => [
      { answers: { dept: { choice: 'billing', confidence: 1 } } },
      { answers: { dept: { choice: 'billing', confidence: 1 } } },
    ])
    const client = new LayaClient({ backend: { predict: vi.fn(), batch } })
    const results = await client.predictBatch({ states: ['a', 'b'], questions })
    expect(results).toHaveLength(2)
    expect(batch).toHaveBeenCalledOnce()
  })

  test('falls back to sequential predict when batch is absent', async () => {
    const predict = vi.fn(async () => ({ answers: { dept: { choice: 'billing', confidence: 1 } } }))
    const client = new LayaClient({ backend: { predict } })
    const results = await client.predictBatch({ states: ['a', 'b'], questions })
    expect(results).toHaveLength(2)
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
import { validateResult, validateRouting } from './schemas.js'
import type { PredictResult, QuestionMap, RoutingInfo, State } from './types.js'

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

export type LayaRouteParams = {
  state: State
  questions: QuestionMap
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

  async predict<TQuestions extends QuestionMap>(
    params: LayaPredictParams<TQuestions>,
  ): Promise<PredictResult<TQuestions>> {
    const raw = await this.#backend.predict({
      state: params.state,
      questions: params.questions,
      model: params.model ?? this.#defaultModel,
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
    const model = params.model ?? this.#defaultModel
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
      results.push(await this.predict({ state, questions: params.questions, model, signal: params.signal }))
    }
    return results
  }

  async route(params: LayaRouteParams): Promise<RoutingInfo> {
    if (this.#backend.route == null) {
      throw new Error('Backend does not support route')
    }
    const raw = await this.#backend.route(params)
    return validateRouting({ raw })
  }

  async listModels(params?: LayaListModelsParams): Promise<Array<string>> {
    if (this.#backend.listModels == null) {
      throw new Error('Backend does not support listModels')
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
  type LayaRouteParams,
} from './client.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/laya-client/src/client.ts packages/laya-client/src/index.ts packages/laya-client/test/client.test.ts
git commit -m "feat: add LayaClient over a pluggable backend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: HttpLayaBackend and createLayaClient

**Files:**
- Create: `packages/laya-client/src/http.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/http.test.ts`

**Interfaces:**
- Consumes: `LayaBackend`, `LayaResult`, backend param types (Task 4); `validateRouting`, `validateModels` (Task 3); `LayaClient`, `LayaBackendClientOptions` (Task 5); error types (Task 2).
- Produces: `LayaHTTPClientOptions`, `HttpLayaBackendParams`, `HttpLayaBackend`, `CreateLayaClientOptions`, `createLayaClient(options: CreateLayaClientOptions): LayaClient`.

`HttpLayaBackend` posts to the wire contract from the spec. `predict`/`batch` return the raw envelope (the client validates answers, since only the client knows the questions). `route`/`listModels` validate here. Review Focus pinned here: an aborted request rejects and does not hang. HTTP status mapping: 404 → `LayaModelError`; other non-2xx and network failures → `LayaConnectionError`.

- [ ] **Step 1: Write the failing test `test/http.test.ts`**

```ts
import { afterEach, describe, expect, test, vi } from 'vitest'

import { LayaConnectionError } from '../src/errors.js'
import { HttpLayaBackend } from '../src/http.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubJSON(body: unknown, init: { status?: number } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': 'application/json' } })),
  )
}

const questions = { dept: { type: 'choice', instructions: '', criteria: { billing: 'x' } } } as const

describe('HttpLayaBackend', () => {
  test('predict posts state and questions and returns the raw envelope', async () => {
    stubJSON({ answers: { dept: { choice: 'billing', confidence: 0.9 } } })
    const backend = new HttpLayaBackend({ url: 'http://localhost:8000' })
    const result = await backend.predict({ state: 'hi', questions })
    expect(result.answers).toEqual({ dept: { choice: 'billing', confidence: 0.9 } })
  })

  test('maps a non-2xx status to LayaConnectionError', async () => {
    stubJSON({ error: 'boom' }, { status: 500 })
    const backend = new HttpLayaBackend({ url: 'http://localhost:8000' })
    await expect(backend.predict({ state: 'hi', questions })).rejects.toThrow(LayaConnectionError)
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
    const pending = backend.predict({ state: 'hi', questions, signal: controller.signal })
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
  LayaBackendRouteParams,
  LayaResult,
} from './backend.js'
import { LayaConnectionError, LayaModelError } from './errors.js'
import { validateModels, validateRouting } from './schemas.js'

export type LayaHTTPClientOptions = {
  url: string
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
      if (cause.response.status === 404) {
        throw new LayaModelError('Model or endpoint not found', { cause })
      }
      throw new LayaConnectionError(`Sidecar returned ${cause.response.status}`, { cause })
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
    this.#http = ky.create({
      prefixUrl: params.url,
      headers: params.headers,
      fetch: params.fetch,
      timeout: params.timeout,
    })
  }

  async predict(params: LayaBackendPredictParams): Promise<LayaResult> {
    return mapError(() =>
      this.#http
        .post('predict', {
          json: { state: params.state, questions: params.questions, model: params.model },
          signal: params.signal,
        })
        .json<LayaResult>(),
    )
  }

  async batch(params: LayaBackendBatchParams): Promise<Array<LayaResult>> {
    const body = await mapError(() =>
      this.#http
        .post('batch', {
          json: {
            items: params.states.map((state) => ({ state })),
            questions: params.questions,
            model: params.model,
          },
          signal: params.signal,
        })
        .json<{ results: Array<LayaResult> }>(),
    )
    return body.results
  }

  async route(params: LayaBackendRouteParams) {
    const raw = await mapError(() =>
      this.#http
        .post('route', { json: { state: params.state, questions: params.questions }, signal: params.signal })
        .json(),
    )
    return validateRouting({ raw })
  }

  async listModels(params?: LayaBackendListModelsParams) {
    const raw = await mapError(() => this.#http.get('models', { signal: params?.signal }).json())
    return validateModels({ raw })
  }
}
```

- [ ] **Step 4: Write `createLayaClient` at the foot of `src/client.ts`**

Append to `packages/laya-client/src/client.ts`:

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

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/http.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Full package check**

Run: `pnpm --filter @mokei/laya-client run test`
Expected: PASS (type tests + all unit tests).

- [ ] **Step 8: Commit**

```bash
git add packages/laya-client/src/http.ts packages/laya-client/src/client.ts packages/laya-client/src/index.ts packages/laya-client/test/http.test.ts
git commit -m "feat: add HttpLayaBackend and createLayaClient

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Preset question sets

**Files:**
- Create: `packages/laya-client/src/presets.ts`
- Modify: `packages/laya-client/src/index.ts`
- Test: `packages/laya-client/test/presets.test.ts`

**Interfaces:**
- Consumes: `ChoiceQuestion`, `NoulQuestion`, `QuestionMap` (Task 1).
- Produces: `routerQuestions(): QuestionMap`, `guardQuestions(): QuestionMap`, `moderationQuestions(): QuestionMap`, `triageQuestions(): QuestionMap`.

Each factory returns a fresh object so callers can mutate safely.

- [ ] **Step 1: Write the failing test `test/presets.test.ts`**

```ts
import { describe, expect, test } from 'vitest'

import {
  guardQuestions,
  moderationQuestions,
  routerQuestions,
  triageQuestions,
} from '../src/presets.js'

describe('preset question sets', () => {
  test('guardQuestions returns a noul jailbreak question', () => {
    const q = guardQuestions()
    expect(q.jailbreak.type).toBe('noul')
  })

  test('triageQuestions returns a choice department question with criteria', () => {
    const q = triageQuestions()
    expect(q.department.type).toBe('choice')
    if (q.department.type === 'choice') {
      expect(Object.keys(q.department.criteria).length).toBeGreaterThan(1)
    }
  })

  test('each factory returns a fresh object', () => {
    expect(routerQuestions()).not.toBe(routerQuestions())
    expect(moderationQuestions()).not.toBe(moderationQuestions())
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
- Consumes: `LayaClient` (Task 5); `ChoiceQuestion`, `RoutingInfo`, `State` (Task 1).
- Produces: `IntentRoute`, `RouteIntentParams`, `routeIntent(params: RouteIntentParams): Promise<IntentRoute>`.

The helper wraps `predict` with a single `choice` question keyed `intent`, then returns its label and confidence.

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
  test('returns the top label and confidence', async () => {
    const client = new LayaClient({
      backend: { predict: vi.fn(async () => ({ answers: { intent: { choice: 'search', confidence: 0.88 } } })) },
    })
    const route = await routeIntent({ client, state: 'find the docs', question })
    expect(route).toEqual({ label: 'search', confidence: 0.88, routing: undefined })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/routeIntent.test.ts`
Expected: FAIL, cannot resolve `../src/routeIntent.js`.

- [ ] **Step 3: Write `src/routeIntent.ts`**

```ts
import type { LayaClient } from './client.js'
import type { ChoiceQuestion, RoutingInfo, State } from './types.js'

export type IntentRoute = {
  label: string
  confidence: number
  routing?: RoutingInfo
}

export type RouteIntentParams = {
  client: LayaClient
  state: State
  question: ChoiceQuestion
  signal?: AbortSignal
}

export async function routeIntent(params: RouteIntentParams): Promise<IntentRoute> {
  const result = await params.client.predict({
    state: params.state,
    questions: { intent: params.question },
    signal: params.signal,
  })
  const answer = result.answers.intent
  return { label: answer.choice, confidence: answer.confidence, routing: result.routing }
}
```

- [ ] **Step 4: Add exports to `src/index.ts`**

```ts
export { routeIntent, type IntentRoute, type RouteIntentParams } from './routeIntent.js'
```

- [ ] **Step 5: Run tests to verify they pass, then the full package**

Run: `pnpm --filter @mokei/laya-client exec vitest run test/routeIntent.test.ts`
Expected: PASS.
Then: `pnpm --filter @mokei/laya-client run test`
Expected: PASS (all).

- [ ] **Step 6: Build and lint**

Run: `pnpm --filter @mokei/laya-client run build`
Expected: builds `lib/` with no error.
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

In `pnpm-workspace.yaml`, add `'@mokei/laya-client'` to the fixed list, keeping it grouped with the other published packages (place it after `'@mokei/http-server'`).

- [ ] **Step 2: Verify the release plan still resolves**

Run: `pnpm change status`
Expected: command runs without error; `@mokei/laya-client` is recognised as part of the fixed group.

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
- Consumes: `createLayaClient`, `LayaClient`, `QuestionMap` (`@mokei/laya-client`); `createTool`, `Schema`, `ServerConfig`, `ToolDefinitions`, `ExtractServerTypes` (`@mokei/context-server`); `serveProcess` (`@mokei/context-server-node`).
- Produces: `createLayaTools(options: LayaToolsOptions)`, `createLayaConfig(options?: LayaToolsOptions)`, `LayaToolsOptions`, `LayaServerTypes`.

The `LAYA_URL` env var (default `http://localhost:8000`) points the client at the sidecar. The `predict` tool takes `state` and `questions` as free-form JSON objects, since a Laya question map is dynamic.

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
  return { predict: vi.fn(async () => ({ answers })) } as unknown as LayaClient
}

describe('createLayaTools', () => {
  test('predict tool calls the client and returns JSON text', async () => {
    const client = fakeClient({ dept: { choice: 'billing', confidence: 0.9 } })
    const tools = createLayaTools({ client })
    const res = await tools.predict.handler({
      input: { state: 'hi', questions: { dept: { type: 'choice', instructions: '', criteria: { billing: 'x' } } } },
      signal: new AbortController().signal,
    } as never)
    expect(res.isError).toBe(false)
    expect(res.content[0].text).toContain('billing')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @mokei/mcp-laya exec vitest run test/config.test.ts`
Expected: FAIL, cannot resolve `../src/config.js` (run `pnpm install` first if the package is unknown).

- [ ] **Step 5: Write `src/config.ts`**

```ts
import {
  createTool,
  type ExtractServerTypes,
  type Schema,
  type ServerConfig,
  type ToolDefinitions,
} from '@mokei/context-server'
import { createLayaClient, type LayaClient, type QuestionMap, type State } from '@mokei/laya-client'

export type LayaToolsOptions = {
  client?: LayaClient
  url?: string
  defaultModel?: string
}

const stateSchema = {
  oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }],
  description: 'Text or a JSON object to classify',
} as const satisfies Schema

const questionsSchema = {
  type: 'object',
  additionalProperties: true,
  description: 'A Laya question map: each key maps to a choice/score/noul question',
} as const satisfies Schema

function resolveClient(options: LayaToolsOptions): LayaClient {
  return (
    options.client ??
    createLayaClient({
      url: options.url ?? process.env.LAYA_URL ?? 'http://localhost:8000',
      defaultModel: options.defaultModel,
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
        properties: { state: stateSchema, questions: questionsSchema },
        required: ['state', 'questions'],
        additionalProperties: false,
      } as const satisfies Schema,
      handler: async (req) => {
        try {
          const result = await client.predict({
            state: req.input.state as State,
            questions: req.input.questions as QuestionMap,
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
      "env": { "LAYA_URL": "http://localhost:8000" }
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

- [ ] **Step 9: Install, run the test, build**

Run: `pnpm install`
Then: `pnpm --filter @mokei/mcp-laya exec vitest run test/config.test.ts`
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
- Produces: `route`, `guard`, `moderate`, `triage` tools on the server, each taking `{ state }`.

- [ ] **Step 1: Extend the failing test in `test/config.test.ts`**

Add:

```ts
test('preset tools classify with a fixed question set', async () => {
  const client = fakeClient({ jailbreak: { noul: 0.1 } })
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

Import the preset factories and add a helper that builds a `{ state }`-only tool, then include the four tools in the returned object:

```ts
import {
  createLayaClient,
  guardQuestions,
  moderationQuestions,
  type LayaClient,
  type QuestionMap,
  routerQuestions,
  type State,
  triageQuestions,
} from '@mokei/laya-client'

// inside createLayaTools, after `predict`:
function presetTool(description: string, questions: QuestionMap) {
  return createTool({
    description,
    inputSchema: {
      type: 'object',
      properties: { state: stateSchema },
      required: ['state'],
      additionalProperties: false,
    } as const satisfies Schema,
    handler: async (req) => {
      try {
        const result = await client.predict({ state: req.input.state as State, questions, signal: req.signal })
        return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
      } catch (err) {
        return { content: [{ type: 'text', text: (err as Error).message }], isError: true }
      }
    },
  })
}

// add to the returned object alongside predict:
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

### Task 12: Wire contract and reference sidecar docs

**Files:**
- Create: `docs/reference/laya-sidecar.md`

**Interfaces:** none.

The document is the single source for the HTTP contract that `HttpLayaBackend` targets, plus a reference FastAPI sidecar that satisfies it. It is documentation only — not a package, not built, not released.

- [ ] **Step 1: Write `docs/reference/laya-sidecar.md`**

Include, as prose and code blocks:

1. A statement that no Laya HTTP server exists upstream, so this contract is defined by mokei, and that the user runs the sidecar.
2. The endpoint table copied from the spec:

```
POST /predict   { state, questions, model? }                    -> { answers, routing? }
POST /route     { state, questions }                            -> { model, reason }
GET  /models                                                    -> { models: string[] }
POST /batch     { items: [{ state }], questions, model? }       -> { results: [{ answers, routing? }] }
```

3. The answer shapes per primitive (`choice` → `{ choice, confidence, distribution? }`, `score` → `{ score, confidence, distribution? }`, `noul` → `{ noul }`).
4. A reference FastAPI sidecar:

```python
# laya_sidecar.py  --  reference only. Run: uvicorn laya_sidecar:app --port 8000
from fastapi import FastAPI
from pydantic import BaseModel
from laya import Router

app = FastAPI()
router = Router(preload=True)


class PredictBody(BaseModel):
    state: dict | str
    questions: dict
    model: str | None = None


class RouteBody(BaseModel):
    state: dict | str
    questions: dict


class BatchBody(BaseModel):
    items: list[dict]
    questions: dict
    model: str | None = None


@app.post("/predict")
def predict(body: PredictBody):
    kwargs = {"model": body.model} if body.model else {}
    res = router.predict(body.state, body.questions, **kwargs)
    return {"answers": res["answers"], "routing": res.get("routing")}


@app.post("/route")
def route(body: RouteBody):
    decision = router.route(body.state, body.questions)
    return {"model": decision.model, "reason": decision.reason}


@app.get("/models")
def models():
    return {"models": ["english", "multilingual", "typed-decisions"]}


@app.post("/batch")
def batch(body: BatchBody):
    kwargs = {"model": body.model} if body.model else {}
    results = []
    for item in body.items:
        res = router.predict(item["state"], body.questions, **kwargs)
        results.append({"answers": res["answers"], "routing": res.get("routing")})
    return {"results": results}
```

5. A usage note: `createLayaClient({ url: 'http://localhost:8000' })`, and that `LAYA_URL` configures the MCP server.

6. A note that when upstream ONNX export lands (tracked at `https://github.com/NandhaKishorM/laya/issues/7` and any ONNX work), an in-process `OnnxLayaBackend` will implement the same `LayaBackend` seam and remove the sidecar requirement.

- [ ] **Step 2: Verify the contract matches the client**

Read `packages/laya-client/src/http.ts` and confirm every path, method, and body field in the doc matches what `HttpLayaBackend` sends. Fix the doc if they diverge.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/laya-sidecar.md
git commit -m "docs: add Laya HTTP wire contract and reference sidecar

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
