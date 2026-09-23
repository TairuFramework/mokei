# Laya Daemon Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@mokei/laya-backend`, a `SystemOneBackend` that drives `laya daemon` over stdio, plus
integration tests covering the daemon backend and `HTTPSystemOneBackend` against a real `laya serve`.

**Architecture:** `LayaDaemonBackend` spawns `laya daemon` lazily with nano-spawn, waits for its
ready line, writes one JSON request per stdin line and correlates stdout response lines by `id`
(`src/protocol.ts`). Process exit rejects pending calls and the next call respawns. The client's
answer schemas first learn the extra fields real `laya.cpp` answers carry.

**Tech Stack:** TypeScript ESM (NodeNext), nano-spawn `^2.1.0`, vitest, swc, Biome, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-23-laya-backend-design.md`

## Global Constraints

- Package name `@mokei/laya-backend`, directory `packages/laya-backend`, joins `versioning.fixed` in `pnpm-workspace.yaml`.
- `@mokei/system-one-client` stays platform-neutral: no `node:*` imports, no new dependencies.
- `@mokei/laya-backend` spawns with `nano-spawn` (`catalog:`), never `node:child_process` at runtime. Type-only `node:*` imports and `node:path` are allowed.
- Integration suites gate on `MOKEI_LAYA_GGUF` and on the binary from `MOKEI_LAYA_BIN` (default `laya`) resolving; they skip otherwise.
- Integration assertions are structural only: no assertions on which answer the model picks.
- `pnpm` / `pnpx` only. Lint with `rtk proxy pnpm run lint` (never `pnpm lint`).
- Follow the `kigu:conventions` skill: `Array<T>` not `T[]`, `type` not `interface`, capitalized acronyms (`HTTP`, `ID`, `JSON`), params objects for public APIs.
- Workspace tests resolve built `lib/`: rebuild a package (`pnpm run build` in it) before tests in a dependent package.
- Commits end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GQXToSJu66HrWiqxZBTuFu
  ```

## Review Focus

- A binary that does not exist or is not executable: `predict` rejects with `SystemOneConnectionError`, with no unhandled rejection and no crash of the host process. (Task 4, "a missing binary" test.)
- The daemon crashing while several calls are queued: every queued call rejects, and writing to the dead process's stdin (EPIPE) never throws out of the backend. (Task 4, crash test with a second queued call.)
- A caller aborting one call while others are in flight: the late response must not be delivered to a later call. (Task 3, abort test.)
- Real `laya.cpp` answers carrying `action` and a noul `confidence`, plus `usage.latency_ms`, `family`, `route`: they must pass client validation, or `laya serve` and the daemon both fail on every call. (Task 1 test, Task 5 integration.)
- Leaked daemon processes: `close()` must actually end the process. (Task 4, `close()` test asserting the pid is gone.)

## File Structure

- `packages/system-one-client/src/types.ts` (modify) — answer schemas accept `action` and noul `confidence`.
- `packages/laya-backend/package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts` (create) — package scaffolding, mirroring `packages/system-one-client`.
- `packages/laya-backend/src/protocol.ts` (create) — `parseDaemonLine`, `PendingRequests`.
- `packages/laya-backend/src/backend.ts` (create) — `LayaDaemonBackend`, `LayaDaemonBackendParams`.
- `packages/laya-backend/src/index.ts` (create) — exports.
- `packages/laya-backend/test/protocol.test.ts`, `test/backend.test.ts`, `test/lifecycle.test.ts` (create).
- `packages/laya-backend/test/fixtures/fake-laya.mjs` (create, executable) — fake `laya daemon`.
- `integration-tests/suites/laya.test.ts` (create), `integration-tests/package.json`, `integration-tests/README.md` (modify).
- `docs/reference/system-one-sidecar.md`, `docs/agents/architecture.md`, `docs/agents/plans/backlog/2026-09-22-laya-in-process-ggml-backend.md` (modify).

---

### Task 1: Client accepts laya.cpp answer fields

Real `laya.cpp` output (see `examples/laya/src/questions.cpp` `answer_to_json` in ggmlc) adds
`action: { act_probability }` to every answer and `confidence` to noul answers. The answer schemas
use `additionalProperties: false`, so `validateResult` currently rejects every real `laya serve`
response. Add the fields as optional, keeping the schemas closed.

**Files:**
- Modify: `packages/system-one-client/src/types.ts` (answer schemas, around lines 59-89)
- Test: `packages/system-one-client/test/validation.test.ts`

**Interfaces:**
- Produces: `ChoiceAnswer`, `ScoreAnswer`, `NoulAnswer` gain `action?: { act_probability?: number; [key: string]: unknown }`; `NoulAnswer` gains `confidence?: number`. New exported schema `answerActionSchema`.

- [ ] **Step 1: Write the failing test**

Add inside the `validateResult` describe block in `packages/system-one-client/test/validation.test.ts` (reuse the file's `questions` constant, which has `dept` choice, `urgency` score, `churn` noul):

```ts
  test('accepts laya.cpp answers carrying action and a noul confidence', () => {
    const result = validateResult({
      questions,
      raw: {
        model: 'laya',
        family: 'english',
        route: 'english: ascii',
        answers: {
          dept: {
            type: 'choice',
            choice: 'billing',
            confidence: 0.9,
            probabilities: { billing: 0.9, tech: 0.1 },
            action: { act_probability: 0.8 },
          },
          urgency: {
            type: 'score',
            score: 0.3,
            confidence: 0.7,
            legend: { '0': 'low', '1': 'high' },
            probabilities: { '0': 0.7, '1': 0.3 },
            action: { act_probability: 0.5 },
          },
          churn: { type: 'noul', noul: 0.2, confidence: 0.8, action: { act_probability: 0.1 } },
        },
        usage: { input_tokens: 12, output_tokens: 0, latency_ms: 4.2 },
      },
    })
    expect(result.answers.dept.action?.act_probability).toBe(0.8)
    expect(result.answers.churn.confidence).toBe(0.8)
    expect(result.extras).toEqual({ family: 'english', route: 'english: ascii' })
  })

  test('still rejects an unknown answer field', () => {
    expect(() =>
      validateResult({
        questions,
        raw: {
          model: 'laya',
          answers: {
            dept: { type: 'choice', choice: 'billing', confidence: 1, probabilities: {}, extra: 1 },
            urgency: { type: 'score', score: 0, confidence: 1, legend: {}, probabilities: {} },
            churn: { type: 'noul', noul: 0.5 },
          },
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      }),
    ).toThrow(SystemOneResponseError)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/system-one-client && pnpm exec vitest run test/validation.test.ts`
Expected: the first new test FAILS with `SystemOneResponseError: Response failed validation`; the second passes; type check of `result.answers.dept.action` also fails (`pnpm run test:types` reports `Property 'action' does not exist`).

- [ ] **Step 3: Implement**

In `packages/system-one-client/src/types.ts`, add above `choiceAnswerSchema`:

```ts
/** laya.cpp adds this to every answer: the probability that the answer should be acted on. */
export const answerActionSchema = {
  type: 'object',
  properties: { act_probability: { type: 'number' } },
  additionalProperties: true,
} as const satisfies Schema
```

Add `action: answerActionSchema,` to the `properties` of `choiceAnswerSchema`, `scoreAnswerSchema`
and `noulAnswerSchema` (not to `required`). Change `noulAnswerSchema.properties` to:

```ts
  properties: {
    type: { enum: ['noul'] },
    noul: { type: 'number' },
    confidence: { type: 'number' },
    action: answerActionSchema,
  },
```

Export `answerActionSchema` from `packages/system-one-client/src/index.ts` in the `./types.js` value
export list (alphabetical: before `choiceAnswerSchema`).

In `docs/reference/system-one-sidecar.md`, after the "Noul Primitive" JSON block, add:

```markdown
`laya.cpp` also returns `action: { "act_probability": 0.81 }` on every answer, and `confidence` on
noul answers. The client accepts both as optional fields.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/system-one-client && pnpm test && pnpm run build`
Expected: all tests pass, types clean, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/system-one-client docs/reference/system-one-sidecar.md
git commit -m "fix: accept laya.cpp action and noul confidence answer fields"
```

---

### Task 2: Package scaffold and daemon protocol

**Files:**
- Create: `packages/laya-backend/package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `src/protocol.ts`, `src/index.ts`
- Modify: `pnpm-workspace.yaml` (`versioning.fixed` list)
- Test: `packages/laya-backend/test/protocol.test.ts`

**Interfaces:**
- Consumes: `SystemOneResult`, `SystemOneResponseError` from `@mokei/system-one-client`.
- Produces:
  ```ts
  export type DaemonLine =
    | { kind: 'ready' }
    | { kind: 'result'; id: string | undefined; result: SystemOneResult }
    | { kind: 'error'; id: string | undefined; message: string }
    | { kind: 'invalid'; line: string }
  export function parseDaemonLine(line: string): DaemonLine
  export class PendingRequests {
    get size(): number
    add(id: string): Promise<SystemOneResult>
    discard(id: string, reason: unknown): void
    settle(line: DaemonLine): void
    rejectAll(error: unknown): void
  }
  ```

- [ ] **Step 1: Scaffold the package**

`packages/laya-backend/package.json`:

```json
{
  "name": "@mokei/laya-backend",
  "version": "0.13.0",
  "description": "Mokei System One backend running laya.cpp models through laya daemon",
  "keywords": [
    "model",
    "context",
    "protocol",
    "mcp",
    "system-one",
    "laya",
    "gguf",
    "classification"
  ],
  "homepage": "https://mokei.dev",
  "repository": {
    "type": "git",
    "url": "https://github.com/TairuFramework/mokei",
    "directory": "packages/laya-backend"
  },
  "license": "MIT",
  "sideEffects": false,
  "type": "module",
  "exports": {
    ".": "./lib/index.js"
  },
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": [
    "lib/*"
  ],
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
    "@mokei/system-one-client": "workspace:^",
    "nano-spawn": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

Set `"version"` to the current `@mokei/system-one-client` version (read it from
`packages/system-one-client/package.json`; lockstep).

`packages/laya-backend/tsconfig.json`:

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

`packages/laya-backend/tsconfig.test.json`:

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

`packages/laya-backend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
```

In `pnpm-workspace.yaml` `versioning.fixed`, add `'@mokei/laya-backend'` in alphabetical position
(before `'@mokei/llama-provider'`).

Run: `pnpm install` from the repo root. Expected: lockfile updated, no errors.

- [ ] **Step 2: Write the failing test**

`packages/laya-backend/test/protocol.test.ts`:

```ts
import type { SystemOneResult } from '@mokei/system-one-client'
import { SystemOneResponseError } from '@mokei/system-one-client'
import { describe, expect, test } from 'vitest'

import { PendingRequests, parseDaemonLine } from '../src/protocol.js'

const result = {
  model: 'laya',
  answers: {},
  usage: { input_tokens: 1, output_tokens: 0 },
} satisfies SystemOneResult

describe('parseDaemonLine', () => {
  test('recognizes the ready line', () => {
    expect(parseDaemonLine('{"status":"ready","model":"laya"}')).toEqual({ kind: 'ready' })
  })

  test('parses a result and strips its id', () => {
    expect(parseDaemonLine(JSON.stringify({ ...result, id: '7' }))).toEqual({
      kind: 'result',
      id: '7',
      result,
    })
  })

  test('parses an error with and without an id', () => {
    expect(parseDaemonLine('{"id":"3","error":"missing questions"}')).toEqual({
      kind: 'error',
      id: '3',
      message: 'missing questions',
    })
    expect(parseDaemonLine('{"error":"bad"}')).toEqual({
      kind: 'error',
      id: undefined,
      message: 'bad',
    })
  })

  test('stringifies a numeric id', () => {
    expect(parseDaemonLine('{"id":4,"error":"x"}')).toMatchObject({ id: '4' })
  })

  test('marks non-JSON and non-object lines invalid', () => {
    expect(parseDaemonLine('not json')).toEqual({ kind: 'invalid', line: 'not json' })
    expect(parseDaemonLine('[1]')).toEqual({ kind: 'invalid', line: '[1]' })
  })
})

describe('PendingRequests', () => {
  test('resolves the call whose id matches', async () => {
    const pending = new PendingRequests()
    const first = pending.add('1')
    const second = pending.add('2')
    pending.settle({ kind: 'result', id: '2', result: { ...result, model: 'two' } })
    pending.settle({ kind: 'result', id: '1', result: { ...result, model: 'one' } })
    expect((await first).model).toBe('one')
    expect((await second).model).toBe('two')
    expect(pending.size).toBe(0)
  })

  test('rejects a daemon error with SystemOneResponseError', async () => {
    const pending = new PendingRequests()
    const call = pending.add('1')
    pending.settle({ kind: 'error', id: '1', message: 'missing questions' })
    await expect(call).rejects.toThrow(SystemOneResponseError)
    await expect(call).rejects.toThrow('missing questions')
  })

  test('routes an id-less error and an invalid line to the oldest call', async () => {
    const pending = new PendingRequests()
    const first = pending.add('1')
    const second = pending.add('2')
    const third = pending.add('3')
    pending.settle({ kind: 'error', id: undefined, message: 'bad' })
    pending.settle({ kind: 'invalid', line: 'garbage' })
    await expect(first).rejects.toThrow('bad')
    await expect(second).rejects.toThrow('garbage')
    expect(pending.size).toBe(1)
    pending.settle({ kind: 'result', id: '3', result })
    await expect(third).resolves.toEqual(result)
  })

  test('drops a result with an unknown id', () => {
    const pending = new PendingRequests()
    void pending.add('1')
    pending.settle({ kind: 'result', id: '99', result })
    expect(pending.size).toBe(1)
  })

  test('a discarded call rejects at once and swallows its late response', async () => {
    const pending = new PendingRequests()
    const first = pending.add('1')
    const second = pending.add('2')
    const reason = new Error('aborted')
    pending.discard('1', reason)
    await expect(first).rejects.toBe(reason)
    pending.settle({ kind: 'error', id: undefined, message: 'late' })
    expect(pending.size).toBe(1)
    pending.settle({ kind: 'result', id: '2', result })
    await expect(second).resolves.toEqual(result)
  })

  test('rejectAll rejects every live call and empties the map', async () => {
    const pending = new PendingRequests()
    const first = pending.add('1')
    const second = pending.add('2')
    pending.discard('2', new Error('aborted'))
    await expect(second).rejects.toThrow('aborted')
    const error = new Error('exited')
    pending.rejectAll(error)
    await expect(first).rejects.toBe(error)
    expect(pending.size).toBe(0)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/laya-backend && pnpm exec vitest run test/protocol.test.ts`
Expected: FAIL, cannot resolve `../src/protocol.js`.

- [ ] **Step 4: Implement**

`packages/laya-backend/src/protocol.ts`:

```ts
import { SystemOneResponseError, type SystemOneResult } from '@mokei/system-one-client'

/** One stdout line of `laya daemon`, classified. */
export type DaemonLine =
  | { kind: 'ready' }
  | { kind: 'result'; id: string | undefined; result: SystemOneResult }
  | { kind: 'error'; id: string | undefined; message: string }
  | { kind: 'invalid'; line: string }

export function parseDaemonLine(line: string): DaemonLine {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { kind: 'invalid', line }
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'invalid', line }
  }
  const { id, ...rest } = value as Record<string, unknown>
  if (rest.status === 'ready') {
    return { kind: 'ready' }
  }
  const lineID = id == null ? undefined : String(id)
  if (typeof rest.error === 'string') {
    return { kind: 'error', id: lineID, message: rest.error }
  }
  // Shape validation happens in SystemOneClient.validateResult.
  return { kind: 'result', id: lineID, result: rest as SystemOneResult }
}

type Entry = {
  resolve: (result: SystemOneResult) => void
  reject: (reason: unknown) => void
  discarded: boolean
}

/**
 * Calls written to the daemon and not yet answered, in write order. The daemon answers
 * serially, so a line without an id belongs to the oldest entry.
 */
export class PendingRequests {
  #entries = new Map<string, Entry>()

  get size(): number {
    return this.#entries.size
  }

  add(id: string): Promise<SystemOneResult> {
    return new Promise<SystemOneResult>((resolve, reject) => {
      this.#entries.set(id, { resolve, reject, discarded: false })
    })
  }

  /** Rejects the call now, but keeps its entry so the late response is consumed, not misrouted. */
  discard(id: string, reason: unknown): void {
    const entry = this.#entries.get(id)
    if (entry == null || entry.discarded) {
      return
    }
    entry.discarded = true
    entry.reject(reason)
  }

  settle(line: DaemonLine): void {
    if (line.kind === 'ready') {
      return
    }
    const id = line.kind === 'invalid' ? undefined : line.id
    const key = id == null ? this.#entries.keys().next().value : id
    if (key == null) {
      return
    }
    const entry = this.#entries.get(key)
    if (entry == null) {
      return
    }
    this.#entries.delete(key)
    if (entry.discarded) {
      return
    }
    if (line.kind === 'result') {
      entry.resolve(line.result)
    } else if (line.kind === 'error') {
      entry.reject(new SystemOneResponseError(`laya daemon error: ${line.message}`))
    } else {
      entry.reject(
        new SystemOneResponseError(`laya daemon wrote a non-JSON line: ${line.line.slice(0, 200)}`),
      )
    }
  }

  rejectAll(error: unknown): void {
    for (const entry of this.#entries.values()) {
      if (!entry.discarded) {
        entry.reject(error)
      }
    }
    this.#entries.clear()
  }
}
```

`packages/laya-backend/src/index.ts`:

```ts
export { type DaemonLine, PendingRequests, parseDaemonLine } from './protocol.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/laya-backend && pnpm test`
Expected: all protocol tests pass, types clean.

- [ ] **Step 6: Commit**

```bash
git add packages/laya-backend pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat: scaffold @mokei/laya-backend with the laya daemon protocol"
```

---

### Task 3: `LayaDaemonBackend` start and predict

**Files:**
- Create: `packages/laya-backend/src/backend.ts`, `packages/laya-backend/test/fixtures/fake-laya.mjs`
- Modify: `packages/laya-backend/src/index.ts`
- Test: `packages/laya-backend/test/backend.test.ts`

**Interfaces:**
- Consumes: `parseDaemonLine`, `PendingRequests` (Task 2); `SystemOneBackend`, `SystemOneBackendPredictParams`, `SystemOneModel`, `SystemOneResult`, `SystemOneConnectionError`, `SystemOneError` from `@mokei/system-one-client`; `spawn`, `Subprocess`, `SubprocessError` from `nano-spawn`.
- Produces:
  ```ts
  export type LayaDaemonBackendParams = {
    model?: string
    modelsDir?: string
    binary?: string
    family?: string
    device?: string
    threads?: number
    startupTimeoutMs?: number
  }
  export class LayaDaemonBackend implements SystemOneBackend {
    constructor(params: LayaDaemonBackendParams)
    predict(params: SystemOneBackendPredictParams): Promise<SystemOneResult>
    listModels(): Promise<Array<SystemOneModel>>
    close(): Promise<void>
  }
  ```
- The fake daemon's per-request behavior is keyed on the request `state` string (below); Task 4 reuses it.

- [ ] **Step 1: Write the fake daemon**

`packages/laya-backend/test/fixtures/fake-laya.mjs`:

```js
#!/usr/bin/env node
// Stand-in for `laya daemon` in unit tests, speaking the same newline JSON protocol: a ready
// line, then one response per request line, in request order.
//
// FAKE_LAYA_START picks startup behavior: 'ok' (default), 'fail' (stderr text, exit 1) or
// 'hang' (never ready). A request's `state` string picks its behavior: 'error',
// 'error-no-id', 'invalid', 'crash', 'slow:<ms>'; any other state gets a normal result whose
// `route` echoes the state.
import { createInterface } from 'node:readline'

const start = process.env.FAKE_LAYA_START ?? 'ok'

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function answerFor(question) {
  const action = { act_probability: 0.5 }
  if (question.type === 'choice') {
    const keys = Object.keys(question.criteria)
    const probabilities = Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0]))
    return { type: 'choice', choice: keys[0], confidence: 1, probabilities, action }
  }
  if (question.type === 'score') {
    const legend = Object.fromEntries(question.criteria.map((level, i) => [String(i), level]))
    const probabilities = Object.fromEntries(question.criteria.map((_, i) => [String(i), i === 0 ? 1 : 0]))
    return { type: 'score', score: 0, confidence: 1, legend, probabilities, action }
  }
  return { type: 'noul', noul: 0.5, confidence: 0.5, action }
}

if (start === 'fail') {
  process.stderr.write('failed to load missing.gguf\n')
  process.exit(1)
}
if (start === 'hang') {
  process.stderr.write('loading model\n')
  setInterval(() => {}, 1000)
} else {
  write({ status: 'ready', model: 'laya' })
}

for await (const line of createInterface({ input: process.stdin })) {
  if (start === 'hang' || line === '') continue
  const { id, state, questions } = JSON.parse(line)
  if (state === 'error') {
    write({ id, error: 'missing questions' })
    continue
  }
  if (state === 'error-no-id') {
    write({ error: 'bad line' })
    continue
  }
  if (state === 'invalid') {
    process.stdout.write('not json\n')
    continue
  }
  if (state === 'crash') {
    process.stderr.write('decide failed\n')
    process.exit(3)
  }
  if (typeof state === 'string' && state.startsWith('slow:')) {
    await new Promise((resolve) => setTimeout(resolve, Number(state.slice(5))))
  }
  const answers = Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [key, answerFor(question)]),
  )
  write({
    model: 'laya',
    family: 'english',
    route: typeof state === 'string' ? state : 'object',
    pid: process.pid,
    argv: process.argv.slice(2),
    answers,
    usage: { input_tokens: 3, output_tokens: 0, latency_ms: 1 },
    id,
  })
}
```

Run: `chmod +x packages/laya-backend/test/fixtures/fake-laya.mjs`

- [ ] **Step 2: Write the failing tests**

`packages/laya-backend/test/backend.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import {
  createSystemOneClient,
  SystemOneError,
  SystemOneResponseError,
  type SystemOneResult,
} from '@mokei/system-one-client'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { LayaDaemonBackend, type LayaDaemonBackendParams } from '../src/backend.js'

const FAKE_LAYA = fileURLToPath(new URL('./fixtures/fake-laya.mjs', import.meta.url))
const questions = { dept: { type: 'choice', criteria: { billing: 'x', tech: 'y' } } } as const

type FakeResult = SystemOneResult & { route: string; pid: number; argv: Array<string> }

const backends: Array<LayaDaemonBackend> = []

function makeBackend(params: Partial<LayaDaemonBackendParams> = {}): LayaDaemonBackend {
  const backend = new LayaDaemonBackend({ model: 'fake.gguf', binary: FAKE_LAYA, ...params })
  backends.push(backend)
  return backend
}

async function predict(
  backend: LayaDaemonBackend,
  state: string,
  signal?: AbortSignal,
): Promise<FakeResult> {
  return (await backend.predict({ state, questions, model: 'laya', signal })) as FakeResult
}

afterEach(async () => {
  await Promise.all(backends.splice(0).map((backend) => backend.close()))
  vi.unstubAllEnvs()
})

describe('LayaDaemonBackend', () => {
  test('the constructor requires model or modelsDir', () => {
    expect(() => new LayaDaemonBackend({})).toThrow(SystemOneError)
  })

  test('predict returns the daemon result without its id', async () => {
    const result = await predict(makeBackend(), 'hello')
    expect(result.model).toBe('laya')
    expect(result.route).toBe('hello')
    expect(result).not.toHaveProperty('id')
    expect(result.answers.dept).toMatchObject({ type: 'choice', choice: 'billing' })
  })

  test('passes the model and flags to laya daemon', async () => {
    const backend = makeBackend({ model: 'm.gguf', family: 'english', device: 'cpu', threads: 2 })
    const result = await predict(backend, 'a')
    expect(result.argv).toEqual([
      'daemon',
      'm.gguf',
      '--family',
      'english',
      '--device',
      'cpu',
      '--threads',
      '2',
    ])
  })

  test('passes a models directory instead of a model', async () => {
    const backend = makeBackend({ model: undefined, modelsDir: 'models' })
    expect((await predict(backend, 'a')).argv).toEqual(['daemon', '--models-dir', 'models'])
  })

  test('starts one process for concurrent first calls', async () => {
    const backend = makeBackend()
    const results = await Promise.all([
      predict(backend, 'a'),
      predict(backend, 'b'),
      predict(backend, 'c'),
    ])
    expect(new Set(results.map((r) => r.pid)).size).toBe(1)
  })

  test('routes each response to its own call', async () => {
    const backend = makeBackend()
    const results = await Promise.all([predict(backend, 'slow:50'), predict(backend, 'b')])
    expect(results.map((r) => r.route)).toEqual(['slow:50', 'b'])
  })

  test('a daemon error rejects with SystemOneResponseError and the daemon keeps serving', async () => {
    const backend = makeBackend()
    await expect(predict(backend, 'error')).rejects.toThrow(SystemOneResponseError)
    expect((await predict(backend, 'after')).route).toBe('after')
  })

  test('an error without an id and a non-JSON line reject the oldest call', async () => {
    const backend = makeBackend()
    const [noID, invalid, ok] = await Promise.allSettled([
      predict(backend, 'error-no-id'),
      predict(backend, 'invalid'),
      predict(backend, 'ok'),
    ])
    expect(noID.status === 'rejected' && noID.reason).toBeInstanceOf(SystemOneResponseError)
    expect(invalid.status === 'rejected' && invalid.reason).toBeInstanceOf(SystemOneResponseError)
    expect(ok.status === 'fulfilled' && ok.value.route).toBe('ok')
  })

  test('an aborted call rejects at once and its late response reaches no other call', async () => {
    const backend = makeBackend()
    await predict(backend, 'warm')
    const controller = new AbortController()
    const slow = predict(backend, 'slow:100', controller.signal)
    const next = predict(backend, 'next')
    controller.abort()
    await expect(slow).rejects.toMatchObject({ name: 'AbortError' })
    expect((await next).route).toBe('next')
  })

  test('an already-aborted signal rejects without a request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(predict(makeBackend(), 'a', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  test('listModels names the GGUF, or the models directory', async () => {
    expect(await makeBackend({ model: '/models/laya_english_f16.gguf' }).listModels()).toEqual([
      { name: 'laya_english_f16.gguf' },
    ])
    expect(await makeBackend({ model: undefined, modelsDir: '/models' }).listModels()).toEqual([
      { name: '/models' },
    ])
  })

  test('SystemOneClient runs predictBatch over the daemon', async () => {
    const client = createSystemOneClient({ backend: makeBackend(), defaultModel: 'laya' })
    const results = await client.predictBatch({ states: ['a', 'b', 'c'], questions })
    expect(results.map((r) => r.extras?.route)).toEqual(['a', 'b', 'c'])
    expect(results.every((r) => r.answers.dept.choice === 'billing')).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/laya-backend && pnpm exec vitest run test/backend.test.ts`
Expected: FAIL, cannot resolve `../src/backend.js`.

- [ ] **Step 4: Implement**

`packages/laya-backend/src/backend.ts`:

```ts
import { basename } from 'node:path'
import type { Writable } from 'node:stream'
import {
  type SystemOneBackend,
  type SystemOneBackendPredictParams,
  SystemOneConnectionError,
  SystemOneError,
  type SystemOneModel,
  type SystemOneResult,
} from '@mokei/system-one-client'
import spawn, { SubprocessError } from 'nano-spawn'

import { PendingRequests, parseDaemonLine } from './protocol.js'

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000
const CLOSE_GRACE_MS = 5_000
const STDERR_TAIL_LINES = 20

export type LayaDaemonBackendParams = {
  /** Path to a compiled Laya GGUF. One of `model` or `modelsDir` is required. */
  model?: string
  /** Directory of Laya GGUFs; the daemon routes english vs multilingual. */
  modelsDir?: string
  /** The `laya` executable. Defaults to `laya` on PATH. */
  binary?: string
  /** `--family`: auto, english, multilingual or typed-decisions. */
  family?: string
  /** `--device`: auto, cpu, cuda or metal. */
  device?: string
  /** `--threads`: CPU workers. */
  threads?: number
  /** How long to wait for the daemon's ready line. Defaults to 60 seconds. */
  startupTimeoutMs?: number
}

type Daemon = {
  stdin: Writable
  pending: PendingRequests
  exited: Promise<void>
  kill: () => void
  state: { closing: boolean }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  promise.catch(() => {})
  return { promise, resolve, reject }
}

function formatTail(stderrTail: Array<string>): string {
  return stderrTail.length > 0 ? `: ${stderrTail.join('\n')}` : ''
}

function exitError(failure: unknown, stderrTail: Array<string>): SystemOneConnectionError {
  const tail = formatTail(stderrTail)
  if (failure instanceof SubprocessError) {
    if (failure.signalName != null) {
      return new SystemOneConnectionError(`laya daemon exited on ${failure.signalName}${tail}`, {
        cause: failure,
      })
    }
    if (failure.exitCode != null) {
      return new SystemOneConnectionError(`laya daemon exited with code ${failure.exitCode}${tail}`, {
        cause: failure,
      })
    }
    return new SystemOneConnectionError(`Failed to start laya daemon: ${failure.message}`, {
      cause: failure,
    })
  }
  return new SystemOneConnectionError(`laya daemon exited${tail}`)
}

function daemonArgs(params: LayaDaemonBackendParams): Array<string> {
  const args = ['daemon']
  if (params.model != null) args.push(params.model)
  if (params.modelsDir != null) args.push('--models-dir', params.modelsDir)
  if (params.family != null) args.push('--family', params.family)
  if (params.device != null) args.push('--device', params.device)
  if (params.threads != null) args.push('--threads', String(params.threads))
  return args
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal == null) {
    return promise
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * Runs Laya models through a long-lived `laya daemon` process: one JSON request per stdin
 * line, one response per stdout line, correlated by id. The process starts on the first call,
 * restarts after an exit, and stops on `close()`.
 */
export class LayaDaemonBackend implements SystemOneBackend {
  #params: LayaDaemonBackendParams
  #daemon: Promise<Daemon> | undefined
  #nextID = 0

  constructor(params: LayaDaemonBackendParams) {
    if (params.model == null && params.modelsDir == null) {
      throw new SystemOneError('LayaDaemonBackend requires `model` or `modelsDir`')
    }
    this.#params = params
  }

  async predict(params: SystemOneBackendPredictParams): Promise<SystemOneResult> {
    const { signal } = params
    signal?.throwIfAborted()
    const daemon = await abortable(this.#getDaemon(), signal)
    signal?.throwIfAborted()
    // The daemon ignores `model`: its router picks the family from the loaded GGUF(s).
    const id = String(++this.#nextID)
    const response = daemon.pending.add(id)
    const onAbort = () => daemon.pending.discard(id, signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      daemon.stdin.write(`${JSON.stringify({ id, state: params.state, questions: params.questions })}\n`)
      return await response
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async listModels(): Promise<Array<SystemOneModel>> {
    const { model, modelsDir } = this.#params
    return [{ name: model != null ? basename(model) : (modelsDir as string) }]
  }

  async close(): Promise<void> {
    const started = this.#daemon
    this.#daemon = undefined
    if (started == null) {
      return
    }
    const daemon = await started.catch(() => undefined)
    if (daemon == null) {
      return
    }
    daemon.state.closing = true
    daemon.stdin.end()
    const timer = setTimeout(daemon.kill, CLOSE_GRACE_MS)
    await daemon.exited
    clearTimeout(timer)
  }

  #getDaemon(): Promise<Daemon> {
    if (this.#daemon == null) {
      const started: Promise<Daemon> = this.#startDaemon(() => {
        if (this.#daemon === started) {
          this.#daemon = undefined
        }
      })
      started.catch(() => {})
      this.#daemon = started
    }
    return this.#daemon
  }

  async #startDaemon(onExit: () => void): Promise<Daemon> {
    const subprocess = spawn(this.#params.binary ?? 'laya', daemonArgs(this.#params), {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // Guard the subprocess promise so a spawn failure or abnormal exit is never an unhandled
    // rejection; the exit handler below reports it.
    subprocess.catch(() => {})
    const pending = new PendingRequests()
    const stderrTail: Array<string> = []
    const state = { closing: false }
    const ready = deferred<void>()

    // nano-spawn requires line iteration to start synchronously after spawn().
    const readStdout = (async () => {
      for await (const line of subprocess.stdout) {
        const parsed = parseDaemonLine(line)
        if (parsed.kind === 'ready') {
          ready.resolve()
        } else {
          pending.settle(parsed)
        }
      }
    })()
    const readStderr = (async () => {
      for await (const line of subprocess.stderr) {
        stderrTail.push(line)
        if (stderrTail.length > STDERR_TAIL_LINES) {
          stderrTail.shift()
        }
      }
    })()
    const exited = Promise.allSettled([readStdout, readStderr]).then(async () => {
      const failure = await subprocess.then(
        () => undefined,
        (error: unknown) => error,
      )
      const error = state.closing
        ? new SystemOneConnectionError('laya daemon closed')
        : exitError(failure, stderrTail)
      ready.reject(error)
      pending.rejectAll(error)
      onExit()
    })

    const child = await subprocess.nodeChildProcess.catch(() => undefined)
    const stdin = child?.stdin
    if (child == null || stdin == null) {
      await ready.promise
      throw new SystemOneConnectionError('Failed to start laya daemon')
    }
    // Writing after a crash raises EPIPE here; the exit handler rejects the pending calls.
    stdin.on('error', () => {})
    const kill = () => {
      child.kill('SIGTERM')
    }

    const timeoutMs = this.#params.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    const timer = setTimeout(() => {
      ready.reject(
        new SystemOneConnectionError(
          `laya daemon was not ready after ${timeoutMs}ms${formatTail(stderrTail)}`,
        ),
      )
      kill()
    }, timeoutMs)
    try {
      await ready.promise
    } finally {
      clearTimeout(timer)
    }
    return { stdin, pending, exited, kill, state }
  }
}
```

Replace `packages/laya-backend/src/index.ts` so only the backend is public (the protocol module
stays internal):

```ts
export { LayaDaemonBackend, type LayaDaemonBackendParams } from './backend.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/laya-backend && pnpm test`
Expected: all protocol and backend tests pass, types clean.

- [ ] **Step 6: Commit**

```bash
git add packages/laya-backend
git commit -m "feat: add LayaDaemonBackend over laya daemon stdio"
```

---

### Task 4: Daemon lifecycle: crash, startup failure, timeout, close

The Task 3 implementation already contains the lifecycle code; this task pins it with tests and
fixes whatever they expose.

**Files:**
- Test: `packages/laya-backend/test/lifecycle.test.ts`
- Modify (only if a test fails): `packages/laya-backend/src/backend.ts`

**Interfaces:**
- Consumes: `LayaDaemonBackend`, `LayaDaemonBackendParams` (Task 3); the fake daemon's `FAKE_LAYA_START` env and `crash` / `slow:<ms>` states (Task 3 fixture).

- [ ] **Step 1: Write the tests**

`packages/laya-backend/test/lifecycle.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { SystemOneConnectionError, type SystemOneResult } from '@mokei/system-one-client'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { LayaDaemonBackend, type LayaDaemonBackendParams } from '../src/backend.js'

const FAKE_LAYA = fileURLToPath(new URL('./fixtures/fake-laya.mjs', import.meta.url))
const questions = { dept: { type: 'choice', criteria: { billing: 'x' } } } as const

type FakeResult = SystemOneResult & { route: string; pid: number }

const backends: Array<LayaDaemonBackend> = []

function makeBackend(params: Partial<LayaDaemonBackendParams> = {}): LayaDaemonBackend {
  const backend = new LayaDaemonBackend({ model: 'fake.gguf', binary: FAKE_LAYA, ...params })
  backends.push(backend)
  return backend
}

async function predict(backend: LayaDaemonBackend, state: string): Promise<FakeResult> {
  return (await backend.predict({ state, questions, model: 'laya' })) as FakeResult
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(backends.splice(0).map((backend) => backend.close()))
  vi.unstubAllEnvs()
})

describe('LayaDaemonBackend lifecycle', () => {
  test('a crash rejects the in-flight and queued calls, and the next call restarts', async () => {
    const backend = makeBackend()
    const { pid } = await predict(backend, 'warm')
    const [crashed, queued] = await Promise.allSettled([
      predict(backend, 'crash'),
      predict(backend, 'queued'),
    ])
    expect(crashed.status).toBe('rejected')
    const reason = crashed.status === 'rejected' ? crashed.reason : undefined
    expect(reason).toBeInstanceOf(SystemOneConnectionError)
    expect(String(reason)).toContain('code 3')
    expect(String(reason)).toContain('decide failed')
    expect(queued.status === 'rejected' && queued.reason).toBeInstanceOf(SystemOneConnectionError)
    const next = await predict(backend, 'next')
    expect(next.route).toBe('next')
    expect(next.pid).not.toBe(pid)
  })

  test('an exit before ready rejects with the stderr text', async () => {
    vi.stubEnv('FAKE_LAYA_START', 'fail')
    const call = predict(makeBackend(), 'a')
    await expect(call).rejects.toThrow(SystemOneConnectionError)
    await expect(call).rejects.toThrow('failed to load missing.gguf')
  })

  test('a failed start is retried on the next call', async () => {
    vi.stubEnv('FAKE_LAYA_START', 'fail')
    const backend = makeBackend()
    await expect(predict(backend, 'a')).rejects.toThrow(SystemOneConnectionError)
    vi.stubEnv('FAKE_LAYA_START', 'ok')
    expect((await predict(backend, 'b')).route).toBe('b')
  })

  test('a missing binary rejects with SystemOneConnectionError', async () => {
    const backend = makeBackend({ binary: '/nonexistent/laya' })
    await expect(predict(backend, 'a')).rejects.toThrow(SystemOneConnectionError)
  })

  test('the startup timeout rejects and kills the process', async () => {
    vi.stubEnv('FAKE_LAYA_START', 'hang')
    const call = predict(makeBackend({ startupTimeoutMs: 300 }), 'a')
    await expect(call).rejects.toThrow(SystemOneConnectionError)
    await expect(call).rejects.toThrow('not ready after 300ms')
    await expect(call).rejects.toThrow('loading model')
  })

  test('close() ends the process, lets queued calls finish, and a later call restarts', async () => {
    const backend = makeBackend()
    const { pid } = await predict(backend, 'warm')
    const queued = predict(backend, 'slow:50')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await backend.close()
    expect((await queued).route).toBe('slow:50')
    expect(isRunning(pid)).toBe(false)
    const next = await predict(backend, 'after')
    expect(next.pid).not.toBe(pid)
  })

  test('close() before any call resolves', async () => {
    await expect(makeBackend().close()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/laya-backend && pnpm exec vitest run test/lifecycle.test.ts`
Expected: PASS. If a test fails, fix `src/backend.ts` (not the test) and rerun; the test encodes the
spec's lifecycle rules.

- [ ] **Step 3: Run the whole package**

Run: `cd packages/laya-backend && pnpm test && pnpm run build`
Expected: all tests pass, build succeeds. Then from the repo root: `rtk proxy pnpm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/laya-backend
git commit -m "test: pin LayaDaemonBackend crash, startup and close behavior"
```

---

### Task 5: Integration suites against the real laya binary

**Files:**
- Create: `integration-tests/suites/laya.test.ts`
- Modify: `integration-tests/package.json`, `integration-tests/README.md`

**Interfaces:**
- Consumes: `LayaDaemonBackend` (`@mokei/laya-backend`); `createSystemOneClient`, `HTTPSystemOneBackend`, `PredictResult`, `QuestionMap` (`@mokei/system-one-client`); `spawn`, `Subprocess` (`nano-spawn`).

- [ ] **Step 1: Add dependencies**

In `integration-tests/package.json` `dependencies`, add (alphabetical):

```json
    "@mokei/laya-backend": "workspace:^",
```
```json
    "@mokei/system-one-client": "workspace:^",
```
```json
    "nano-spawn": "catalog:"
```

Run: `pnpm install` from the repo root, then `pnpm --filter @mokei/system-one-client --filter @mokei/laya-backend run build`.

- [ ] **Step 2: Write the suite**

`integration-tests/suites/laya.test.ts`:

```ts
import { createServer } from 'node:net'
import { basename } from 'node:path'
import { LayaDaemonBackend } from '@mokei/laya-backend'
import {
  createSystemOneClient,
  HTTPSystemOneBackend,
  type PredictResult,
  type QuestionMap,
} from '@mokei/system-one-client'
import spawn, { type Subprocess } from 'nano-spawn'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const GGUF = process.env.MOKEI_LAYA_GGUF
const BIN = process.env.MOKEI_LAYA_BIN ?? 'laya'
const HAS_BIN = await spawn(BIN, ['help']).then(
  () => true,
  () => false,
)
// Gated: runs only when MOKEI_LAYA_GGUF points at a Laya GGUF and the laya binary resolves.
const ENABLED = GGUF != null && GGUF !== '' && HAS_BIN

const questions = {
  department: {
    type: 'choice',
    instructions: 'Which department should handle this message?',
    criteria: {
      billing: 'invoices, charges and refunds',
      technical: 'bugs, outages and errors',
    },
  },
  urgency: {
    type: 'score',
    instructions: 'How urgent is this message?',
    criteria: ['not urgent', 'somewhat urgent', 'very urgent'],
  },
  complaint: { type: 'noul', instructions: 'Is the customer complaining?' },
} satisfies QuestionMap

const BILLING = 'I was charged twice for my subscription this month.'
const CRASH = 'The app crashes every time I open the settings page.'
const THANKS = 'Thanks, everything works great now.'

// Structural only: which answer a model picks is model-dependent.
function expectWellFormed(result: PredictResult<typeof questions>): void {
  const { department, urgency, complaint } = result.answers
  expect(Object.keys(questions.department.criteria)).toContain(department.choice)
  const total = Object.values(department.probabilities).reduce((sum, p) => sum + p, 0)
  expect(total).toBeCloseTo(1, 2)
  expect(Number.isFinite(urgency.score)).toBe(true)
  expect(complaint.noul).toBeGreaterThanOrEqual(0)
  expect(complaint.noul).toBeLessThanOrEqual(1)
  expect(result.usage.inputTokens).toBeGreaterThan(0)
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address != null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`laya serve did not answer ${url}/health within ${timeoutMs}ms`)
}

describe.skipIf(!ENABLED)('LayaDaemonBackend (real GGUF)', () => {
  let backend: LayaDaemonBackend

  beforeAll(() => {
    backend = new LayaDaemonBackend({ model: GGUF as string, binary: BIN })
  })

  afterAll(async () => {
    await backend?.close()
  })

  test('predict answers choice, score and noul questions', async () => {
    const client = createSystemOneClient({ backend, defaultModel: 'laya' })
    const result = await client.predict({ state: BILLING, questions })
    expectWellFormed(result)
    expect(typeof result.extras?.family).toBe('string')
  })

  test('predictBatch answers every state in order', async () => {
    const client = createSystemOneClient({ backend, defaultModel: 'laya' })
    const results = await client.predictBatch({ states: [BILLING, CRASH, THANKS], questions })
    expect(results).toHaveLength(3)
    for (const result of results) {
      expectWellFormed(result)
    }
  })

  test('listModels names the loaded GGUF', async () => {
    const client = createSystemOneClient({ backend, defaultModel: 'laya' })
    expect(await client.listModels()).toEqual([{ name: basename(GGUF as string) }])
  })

  test('close() then predict starts a fresh daemon', async () => {
    await backend.close()
    const client = createSystemOneClient({ backend, defaultModel: 'laya' })
    expectWellFormed(await client.predict({ state: THANKS, questions }))
  })
})

describe.skipIf(!ENABLED)('HTTPSystemOneBackend against laya serve', () => {
  let server: Subprocess | undefined
  let url = ''
  let model = ''

  beforeAll(async () => {
    const port = await freePort()
    url = `http://127.0.0.1:${port}`
    server = spawn(BIN, ['serve', GGUF as string, '--port', String(port)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    server.catch(() => {})
    await waitForHealth(url, 60_000)
    const [first] = await createSystemOneClient({ url }).listModels()
    model = first?.name ?? 'laya'
  }, 90_000)

  afterAll(async () => {
    const child = await server?.nodeChildProcess.catch(() => undefined)
    child?.kill('SIGTERM')
    await server?.catch(() => {})
  })

  test('listModels returns the served families', async () => {
    const models = await createSystemOneClient({ url }).listModels()
    expect(models.length).toBeGreaterThan(0)
    for (const entry of models) {
      expect(typeof entry.name).toBe('string')
    }
  })

  test('predict calls /v1/systemone', async () => {
    const client = createSystemOneClient({ url, defaultModel: model })
    expectWellFormed(await client.predict({ state: BILLING, questions }))
  })

  test('batch: true serves predictBatch from /v1/decide/batch', async () => {
    const backend = new HTTPSystemOneBackend({ url, batch: true })
    const raws = await backend.batch?.({ states: [BILLING, CRASH], questions, model })
    expect(raws).toHaveLength(2)
    const client = createSystemOneClient({ url, batch: true, defaultModel: model })
    const results = await client.predictBatch({ states: [BILLING, CRASH, THANKS], questions })
    expect(results).toHaveLength(3)
    for (const result of results) {
      expectWellFormed(result)
    }
  })
})
```

- [ ] **Step 3: Type check and run**

Run: `cd integration-tests && pnpm run test:types && pnpm exec vitest run suites/laya.test.ts`
Expected: types clean. Without `MOKEI_LAYA_GGUF` both blocks report skipped (7 tests skipped).

With a GGUF (download `laya_english_f16.gguf` from `https://huggingface.co/mys/laya-GGUF`):
Run: `MOKEI_LAYA_GGUF=/path/to/laya_english_f16.gguf pnpm exec vitest run suites/laya.test.ts`
Expected: 7 passed. If no GGUF is available to the implementer, record that in the report; the
controller runs this step.

- [ ] **Step 4: Document the requirement**

In `integration-tests/README.md`, add to the Requirements table after the `llama-provider` row:

```markdown
| `laya` | `MOKEI_LAYA_GGUF`, and the `laya` binary on `PATH` (or `MOKEI_LAYA_BIN`) |
```

After the paragraph starting "`MOKEI_LLAMA_GGUF` is separate", add:

```markdown
`MOKEI_LAYA_GGUF` points at a Laya GGUF for the `laya` suite, which drives `laya.cpp` two ways:
`@mokei/laya-backend` over `laya daemon` stdio, and `HTTPSystemOneBackend` against a `laya serve`
the suite starts on a free port. Get a GGUF from `https://huggingface.co/mys/laya-GGUF` and the
binary from `https://github.com/monatis/ggmlc/releases/latest`.
```

In the Environment variables table, after the `MOKEI_LLAMA_GGUF` row:

```markdown
| `MOKEI_LAYA_GGUF` | Laya GGUF path enabling the `laya` suite |
| `MOKEI_LAYA_BIN` | `laya` executable for the `laya` suite. Unset, `laya` is resolved on `PATH` |
```

- [ ] **Step 5: Commit**

```bash
git add integration-tests pnpm-lock.yaml
git commit -m "test: add laya integration suites for the daemon and laya serve"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/reference/system-one-sidecar.md`, `docs/agents/architecture.md`, `docs/agents/plans/backlog/2026-09-22-laya-in-process-ggml-backend.md`

- [ ] **Step 1: Reference doc**

In `docs/reference/system-one-sidecar.md`:

- In the "Backends" list, add a third bullet:
  ```markdown
  - **laya.cpp daemon (local, no server)**: `@mokei/laya-backend` starts `laya daemon` itself and talks to it over stdio, with no port to manage.
  ```
- Replace the "## Future: In-Process Backend" section with:

````markdown
## Daemon Backend (laya.cpp)

`@mokei/laya-backend` runs the same `laya` binary in `daemon` mode and talks to it over stdio: one
JSON request per line, one response per line. The process starts on the first call, restarts if it
exits, and stops on `close()`. It needs Node.js.

```ts
import { LayaDaemonBackend } from '@mokei/laya-backend'
import { createSystemOneClient } from '@mokei/system-one-client'

const backend = new LayaDaemonBackend({ model: 'english-f16.gguf', device: 'auto' })
const client = createSystemOneClient({ backend, defaultModel: 'laya' })

const result = await client.predict({
  state: 'I was double charged on my last invoice',
  questions: {
    department: {
      type: 'choice',
      criteria: { billing: 'invoices and payments', technical: 'bugs and outages' },
    },
  },
})

await backend.close()
```

The daemon picks the model family from the loaded GGUF, so the `model` passed to the client is not
forwarded; any value works. Pass `modelsDir` instead of `model` to let `laya` route between english
and multilingual GGUFs. `binary` defaults to `laya` on `PATH`.

## Future: In-Process Backend

A future version may bind ggml or `laya.cpp` directly (N-API or WebAssembly) behind the same
`SystemOneBackend` interface, removing the separate process. `laya.cpp` currently ships as an
executable only, with no library target.
````

- [ ] **Step 2: Architecture doc**

In `docs/agents/architecture.md` packages tree, after the `llama-provider/` line add:

```
+-- system-one-client/    # System One typed-question classification client (platform-neutral)
+-- laya-backend/         # System One backend running laya.cpp through `laya daemon`
```

In the "Other workspaces" block, after `mcp-servers/sqlite/` add:

```
mcp-servers/system-one/   # published MCP server: System One classification
```

- [ ] **Step 3: Backlog doc**

In `docs/agents/plans/backlog/2026-09-22-laya-in-process-ggml-backend.md`, replace the `## Context`
section's second paragraph area by appending this paragraph to `## Context`:

```markdown
`@mokei/laya-backend` (2026-09-23) already removes the separately managed sidecar: it runs
`laya daemon` as a child process over stdio. What remains here is a true in-process binding. Note
that `laya.cpp` ships as an executable only (no library target or C API), so a binding means
building a C API around the `examples/laya` sources.
```

- [ ] **Step 4: Verify and commit**

Run: `rtk proxy pnpm run lint`
Expected: no errors.

```bash
git add docs
git commit -m "docs: document the Laya daemon backend"
```
