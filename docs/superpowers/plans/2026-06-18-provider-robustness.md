# Provider Robustness + Sampling Params Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix stream-killing/correctness bugs across all four providers and add per-request sampling params (temperature/maxTokens/topP + raw `providerOptions`) wired through every provider.

**Architecture:** A single `resolveSamplingParams()` helper in `@mokei/model-provider` owns precedence (config default → typed per-request → `providerOptions` spread last); each provider maps the normalized params to its backend names and spreads `providerOptions` last into the request body. Bugfixes are surgical edits at known sites.

**Tech Stack:** TypeScript, pnpm workspace, vitest, ky (HTTP), node-llama-cpp (local GGUF), `@enkaku/schema` (config validation).

## Global Constraints

- Types via `type`, never `interface`.
- Names: `ID`/`HTTP`/`JWT` casing, never `Id`/`Http`/`Jwt`. No `any` — use `unknown`/`Record<string, unknown>`.
- `Array<T>`, never `T[]`.
- Use `pnpm`/`pnpx`, never `npm`/`npx`.
- Never edit generated files (`.gen.ts`, `__generated__/`, `lib/`).
- Tests live in `packages/<pkg>/test/*.test.ts`, run with vitest.
- **Cross-package vitest resolves built `lib/`, not `src/`.** After editing `@mokei/model-provider`, run `pnpm --filter @mokei/model-provider build` before running dependent provider tests.
- Run `rtk proxy pnpm run lint` for lint (not `pnpm lint`).
- Commit after each green step. Branch off `main` first (do not commit to `main`).

---

## Task 1: SamplingParams type + `resolveSamplingParams` helper

**Files:**
- Modify: `packages/model-provider/src/index.ts` (add type to `StreamChatParams` ~line 220; add helper + types)
- Test: `packages/model-provider/test/sampling.test.ts` (create)

**Interfaces:**
- Produces:
  - `type SamplingParams = { temperature?: number; maxTokens?: number; topP?: number; providerOptions?: Record<string, unknown> }`
  - `type ResolvedSamplingParams = { temperature?: number; maxTokens?: number; topP?: number; providerOptions?: Record<string, unknown> }`
  - `function resolveSamplingParams(params?: SamplingParams, defaults?: Pick<SamplingParams, 'temperature' | 'maxTokens' | 'topP'>): ResolvedSamplingParams`
  - `StreamChatParams<...>` gains the optional `SamplingParams` fields.

- [ ] **Step 1: Write the failing test**

```ts
// packages/model-provider/test/sampling.test.ts
import { describe, expect, test } from 'vitest'

import { resolveSamplingParams } from '../src/index.js'

describe('resolveSamplingParams', () => {
  test('returns empty resolution when nothing provided', () => {
    const result = resolveSamplingParams()
    expect(result).toEqual({
      temperature: undefined,
      maxTokens: undefined,
      topP: undefined,
      providerOptions: undefined,
    })
  })

  test('typed per-request params override config defaults', () => {
    const result = resolveSamplingParams(
      { temperature: 0.2, topP: 0.9 },
      { temperature: 0.7, maxTokens: 4096, topP: 0.5 },
    )
    expect(result.temperature).toBe(0.2)
    expect(result.topP).toBe(0.9)
    expect(result.maxTokens).toBe(4096) // default kept when per-request unset
  })

  test('passes providerOptions through untouched (provider spreads it last)', () => {
    const result = resolveSamplingParams({
      temperature: 0.2,
      providerOptions: { seed: 42, temperature: 1 },
    })
    expect(result.providerOptions).toEqual({ seed: 42, temperature: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/model-provider exec vitest run test/sampling.test.ts`
Expected: FAIL — `resolveSamplingParams is not exported` / `is not a function`.

- [ ] **Step 3: Add the types and helper**

In `packages/model-provider/src/index.ts`, add near the other exported types (before `StreamChatParams`, ~line 220):

```ts
export type SamplingParams = {
  /** Sampling temperature */
  temperature?: number
  /** Maximum tokens to generate */
  maxTokens?: number
  /** Nucleus sampling top-p */
  topP?: number
  /** Raw backend options merged last into the request body (escape hatch; overrides typed params) */
  providerOptions?: Record<string, unknown>
}

export type ResolvedSamplingParams = {
  temperature?: number
  maxTokens?: number
  topP?: number
  providerOptions?: Record<string, unknown>
}

/**
 * Merge per-request sampling params over provider config defaults.
 * Precedence: config default -> typed per-request param. The raw `providerOptions`
 * bag is returned untouched; each provider spreads it LAST into its request body,
 * so it wins over the typed fields at the backend level.
 */
export function resolveSamplingParams(
  params: SamplingParams = {},
  defaults: Pick<SamplingParams, 'temperature' | 'maxTokens' | 'topP'> = {},
): ResolvedSamplingParams {
  return {
    temperature: params.temperature ?? defaults.temperature,
    maxTokens: params.maxTokens ?? defaults.maxTokens,
    topP: params.topP ?? defaults.topP,
    providerOptions: params.providerOptions,
  }
}
```

Then fold the sampling fields into `StreamChatParams` (currently ~line 220):

```ts
export type StreamChatParams<RawMessage, RawToolCall, RawTool> = RequestParams &
  SamplingParams & {
    model: string
    messages: Array<Message<RawMessage, RawToolCall>>
    tools?: Array<RawTool>
    /** Request structured output conforming to a JSON schema */
    output?: StructuredOutputParams
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/model-provider exec vitest run test/sampling.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Build model-provider so downstream packages resolve the new exports**

Run: `pnpm --filter @mokei/model-provider build`
Expected: build succeeds, `lib/` regenerated.

- [ ] **Step 6: Commit**

```bash
git add packages/model-provider/src/index.ts packages/model-provider/test/sampling.test.ts
git commit -m "feat(model-provider): add SamplingParams + resolveSamplingParams helper"
```

---

## Task 2: openai — guard SSE `JSON.parse`

**Files:**
- Modify: `packages/openai-provider/src/client.ts:20-39` (extract + guard the SSE data parse)
- Test: `packages/openai-provider/test/client.test.ts` (create)

**Interfaces:**
- Produces: `function parseEventData(data: string): unknown | undefined` exported from `client.ts` — returns `undefined` for `[DONE]`, empty, or unparseable data; otherwise the parsed JSON.

- [ ] **Step 1: Write the failing test**

```ts
// packages/openai-provider/test/client.test.ts
import { describe, expect, test } from 'vitest'

import { parseEventData } from '../src/client.js'

describe('parseEventData', () => {
  test('parses valid JSON SSE data', () => {
    expect(parseEventData('{"a":1}')).toEqual({ a: 1 })
  })

  test('returns undefined for [DONE] sentinel', () => {
    expect(parseEventData('[DONE]')).toBeUndefined()
  })

  test('returns undefined for empty / keep-alive lines', () => {
    expect(parseEventData('')).toBeUndefined()
    expect(parseEventData('   ')).toBeUndefined()
  })

  test('returns undefined (no throw) for non-JSON data', () => {
    expect(parseEventData(': keep-alive comment')).toBeUndefined()
    expect(parseEventData('not json')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/openai-provider exec vitest run test/client.test.ts`
Expected: FAIL — `parseEventData is not exported`.

- [ ] **Step 3: Extract + guard the parse**

In `packages/openai-provider/src/client.ts`, replace the `toResponseStream` transform (lines 20-39) with an exported guarded parser used by the transform:

```ts
export function parseEventData(data: string): unknown | undefined {
  const trimmed = data.trim()
  // End-of-run sentinel and keep-alive / empty lines carry no payload.
  if (trimmed === '' || trimmed.startsWith('[DONE]')) {
    return undefined
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    // Non-JSON SSE data (keep-alive comments, gateway noise) must not kill the stream.
    return undefined
  }
}

function toResponseStream<T>(response: ResponsePromise<T>): Promise<ReadableStream<T>> {
  return response.then((res) => {
    if (res.body == null) {
      throw new Error('No response body')
    }
    return res.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .pipeThrough(
        new TransformStream<EventSourceMessage, T>({
          transform(message, controller) {
            const parsed = parseEventData(message.data)
            if (parsed !== undefined) {
              controller.enqueue(parsed as T)
            }
          },
        }),
      )
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/openai-provider exec vitest run test/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/openai-provider/src/client.ts packages/openai-provider/test/client.test.ts
git commit -m "fix(openai-provider): skip unparseable SSE events instead of killing the stream"
```

---

## Task 3: anthropic — fix input-token accounting + guard tool JSON

**Files:**
- Modify: `packages/anthropic-provider/src/provider.ts:194-256` (hoist `inputTokens`; guard `JSON.parse`)
- Test: `packages/anthropic-provider/test/stream-chat.test.ts` (create)

**Interfaces:**
- Consumes: existing `AnthropicProvider.streamChat` + `AnthropicClient.messages` (monkeypatched in test).
- Produces: no new exports; behavior change only.

- [ ] **Step 1: Write the failing test**

```ts
// packages/anthropic-provider/test/stream-chat.test.ts
import { describe, expect, test } from 'vitest'

import { AnthropicClient } from '../src/client.js'
import { AnthropicProvider } from '../src/provider.js'
import type { MessagePart } from '@mokei/model-provider'
import type { StreamEvent, ToolCall } from '../src/types.js'

function streamOf(events: Array<StreamEvent>): ReadableStream<StreamEvent> {
  return new ReadableStream<StreamEvent>({
    start(controller) {
      for (const event of events) controller.enqueue(event)
      controller.close()
    },
  })
}

function providerWithEvents(events: Array<StreamEvent>): AnthropicProvider {
  const client = new AnthropicClient({ apiKey: 'test' })
  const controller = new AbortController()
  // Override the network call with a fixture stream.
  ;(client as unknown as { messages: () => unknown }).messages = () =>
    Object.assign(Promise.resolve(streamOf(events)), {
      abort: () => controller.abort(),
      signal: controller.signal,
    })
  return new AnthropicProvider({ client })
}

async function collect(
  stream: ReadableStream<MessagePart<StreamEvent, ToolCall>>,
): Promise<Array<MessagePart<StreamEvent, ToolCall>>> {
  const parts: Array<MessagePart<StreamEvent, ToolCall>> = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

describe('AnthropicProvider.streamChat', () => {
  test('done part carries input tokens captured at message_start', async () => {
    const provider = providerWithEvents([
      { type: 'message_start', message: { usage: { input_tokens: 10 } } } as unknown as StreamEvent,
      {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hi' },
      } as unknown as StreamEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      } as unknown as StreamEvent,
    ])
    const stream = await provider.streamChat({
      model: 'claude-x',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
    })
    const parts = await collect(stream)
    const done = parts.find((p) => p.type === 'done')
    expect(done).toBeDefined()
    expect((done as { inputTokens: number }).inputTokens).toBe(10)
    expect((done as { outputTokens: number }).outputTokens).toBe(5)
  })

  test('malformed streamed tool JSON does not abort the stream', async () => {
    const provider = providerWithEvents([
      { type: 'message_start', message: { usage: { input_tokens: 3 } } } as unknown as StreamEvent,
      {
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 't1', name: 'do_thing' },
      } as unknown as StreamEvent,
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{bad json' },
      } as unknown as StreamEvent,
      { type: 'content_block_stop' } as unknown as StreamEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 1 },
      } as unknown as StreamEvent,
    ])
    const stream = await provider.streamChat({
      model: 'claude-x',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
    })
    // Must complete without throwing, and still emit the tool-call + done.
    const parts = await collect(stream)
    expect(parts.some((p) => p.type === 'tool-call')).toBe(true)
    expect(parts.some((p) => p.type === 'done')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/anthropic-provider exec vitest run test/stream-chat.test.ts`
Expected: FAIL — first test gets `inputTokens` `0`; second test rejects with a `JSON.parse` SyntaxError surfacing from the stream.

- [ ] **Step 3: Hoist `inputTokens` and guard the parse**

In `packages/anthropic-provider/src/provider.ts`: move `inputTokens` out of `transform()` to sit beside the tool-tracking state (currently lines 195-196), and remove the per-event `let inputTokens = 0` at line 202:

```ts
    // Track state for assembling tool calls
    let currentToolUse: ToolUseBlock | null = null
    let currentToolJson = ''
    let inputTokens = 0

    const response = request.then((stream: ReadableStream<StreamEvent>) => {
      return stream.pipeThrough(
        new TransformStream<StreamEvent, MessagePart<StreamEvent, ToolCall>>({
          transform(event, controller) {
            switch (event.type) {
              case 'message_start':
                inputTokens = event.message.usage.input_tokens
                break
```

Guard the tool-JSON parse in `content_block_stop` (line 247). Parse once into a local; on failure fall back to `{}` so the tool call still surfaces as a tool-level result instead of aborting the stream:

```ts
              case 'content_block_stop':
                if (currentToolUse != null) {
                  let parsedInput: Record<string, unknown> = {}
                  if (currentToolJson) {
                    try {
                      parsedInput = JSON.parse(currentToolJson) as Record<string, unknown>
                    } catch {
                      // Malformed streamed tool JSON: surface the call with the raw
                      // arguments string and empty parsed input rather than killing the turn.
                      parsedInput = {}
                    }
                  }
                  controller.enqueue({
                    type: 'tool-call',
                    toolCalls: [
                      {
                        id: currentToolUse.id,
                        name: currentToolUse.name,
                        arguments: currentToolJson || '{}',
                        raw: {
                          id: currentToolUse.id,
                          name: currentToolUse.name,
                          input: parsedInput,
                        },
                      },
                    ],
                    raw: event,
                  })
                  currentToolUse = null
                  currentToolJson = ''
                }
                break
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/anthropic-provider exec vitest run test/stream-chat.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/anthropic-provider/src/provider.ts packages/anthropic-provider/test/stream-chat.test.ts
git commit -m "fix(anthropic-provider): report input tokens and survive malformed tool JSON"
```

---

## Task 4: ollama — make `generate()` cancellable

**Files:**
- Modify: `packages/ollama-provider/src/client.ts:136` (replace broken `Object.assign(response, controller)`)
- Test: `packages/ollama-provider/test/client.test.ts` (create)

**Interfaces:**
- Consumes: existing `OllamaClient.generate`.
- Produces: `generate()` return value now exposes working `abort()` + `signal` (matching `chat()`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/ollama-provider/test/client.test.ts
import { afterEach, describe, expect, test, vi } from 'vitest'

import { OllamaClient } from '../src/client.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OllamaClient.generate cancellation', () => {
  test('returns a working signal + abort that cancels the request', async () => {
    // Hanging fetch that rejects when its signal aborts.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, opts: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )

    const client = new OllamaClient({ baseURL: 'http://localhost:11434' })
    const request = client.generate({ model: 'llama3', prompt: 'hi', stream: false })

    expect(request.signal).toBeInstanceOf(AbortSignal)
    expect(request.signal.aborted).toBe(false)
    request.abort()
    expect(request.signal.aborted).toBe(true)
    await expect(request).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/ollama-provider exec vitest run test/client.test.ts`
Expected: FAIL — `request.signal` is `undefined` (`Object.assign` copied no prototype accessors), so `toBeInstanceOf(AbortSignal)` fails / `request.abort` throws.

- [ ] **Step 3: Fix the return shape**

In `packages/ollama-provider/src/client.ts`, change the `generate` return (line 136) to the explicit form `chat()` already uses (line 152):

```ts
    const response = params.stream ? toResponseStream(request) : request.json()
    return Object.assign(response, { abort: () => controller.abort(), signal: controller.signal })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/ollama-provider exec vitest run test/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ollama-provider/src/client.ts packages/ollama-provider/test/client.test.ts
git commit -m "fix(ollama-provider): expose working abort/signal on generate()"
```

---

## Task 5: llama — stop caching failed loads + abort on stream cancel + drop listener leak

**Files:**
- Modify: `packages/llama-provider/src/provider.ts:94-105` (delete `#loadingModels` entry in `finally`)
- Modify: `packages/llama-provider/src/provider.ts:267-413` (chain caller signal via `AbortSignal.any`; add `cancel()`; guard post-cancel `enqueue`)
- Test: `packages/llama-provider/test/load-cache.test.ts` (create)
- Test: `packages/llama-provider/test/stream-chat.test.ts` (extend — add cancel test)

**Interfaces:**
- Consumes: existing `LlamaProvider.getContext`, `LlamaProvider.streamChat`.
- Produces: behavior changes only — failed loads are retried; cancelling the stream aborts the prompt.

- [ ] **Step 1: Write the failing load-cache test**

```ts
// packages/llama-provider/test/load-cache.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockCreateContext = vi.fn().mockResolvedValue({ getSequence: vi.fn() })
const mockLoadModel = vi.fn()

vi.mock('node-llama-cpp', () => ({
  getLlama: vi.fn().mockResolvedValue({
    loadModel: (...args: Array<unknown>) => mockLoadModel(...args),
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LlamaProvider load caching', () => {
  test('a failed model load is not cached — the next call retries', async () => {
    const { LlamaProvider } = await import('../src/provider.js')
    const provider = new LlamaProvider({ models: { m: { path: '/m.gguf' } } })

    mockLoadModel.mockRejectedValueOnce(new Error('load failed'))
    mockLoadModel.mockResolvedValueOnce({
      createContext: mockCreateContext,
      dispose: vi.fn().mockResolvedValue(undefined),
      disposed: false,
    })

    await expect(provider.getContext('m')).rejects.toThrow('load failed')
    // Second call must re-invoke loadModel (entry cleared), not return the cached rejection.
    await expect(provider.getContext('m')).resolves.toBeDefined()
    expect(mockLoadModel).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/llama-provider exec vitest run test/load-cache.test.ts`
Expected: FAIL — second `getContext` returns the cached rejected promise; `mockLoadModel` called once; `resolves.toBeDefined()` rejects.

- [ ] **Step 3: Delete the loading entry in `finally`**

In `packages/llama-provider/src/provider.ts`, change `#loadModel` (lines 94-105) so the `#loadingModels` entry is cleared whether the load succeeds or fails:

```ts
  async #doLoadModel(name: string, config: LlamaModelConfig): Promise<LlamaModel> {
    try {
      const llama = await this.#getLlama()
      const gpuLayers =
        config.gpu === true || config.gpu === 'auto'
          ? 'auto'
          : config.gpu === false
            ? 0
            : undefined
      const model = await llama.loadModel({
        modelPath: config.path,
        ...(gpuLayers != null ? { gpuLayers } : {}),
      })
      this.#loadedModels.set(name, model)
      return model
    } finally {
      this.#loadingModels.delete(name)
    }
  }
```

(If the surrounding method is named `#loadModel` rather than `#doLoadModel`, apply the same try/finally to whichever method owns the `llama.loadModel` call and the `#loadingModels.delete`.)

- [ ] **Step 4: Run load-cache test to verify it passes**

Run: `pnpm --filter @mokei/llama-provider exec vitest run test/load-cache.test.ts`
Expected: PASS; `mockLoadModel` called twice.

- [ ] **Step 5: Write the failing stream-cancel test**

Add to `packages/llama-provider/test/stream-chat.test.ts` (follow the file's existing mock setup; this asserts cancellation propagates to the prompt signal):

```ts
import { describe, expect, test } from 'vitest'

import { LlamaProvider } from '../src/provider.js'

describe('LlamaProvider.streamChat cancellation', () => {
  test('cancelling the reader aborts the prompt signal', async () => {
    const provider = new LlamaProvider({ models: { m: { path: '/m.gguf' } } })
    const request = provider.streamChat({
      model: 'm',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
    })
    const stream = await request
    const reader = stream.getReader()
    expect(request.signal.aborted).toBe(false)
    await reader.cancel()
    expect(request.signal.aborted).toBe(true)
  })
})
```

Note: this test needs the `node-llama-cpp` mock from the existing `stream-chat.test.ts` setup (a `getSequence`/`LlamaChatSession`/`promptWithMeta` mock whose `promptWithMeta` returns a never-resolving or signal-aware promise). Reuse the file's existing mock; do not introduce a real model load.

- [ ] **Step 6: Run stream-cancel test to verify it fails**

Run: `pnpm --filter @mokei/llama-provider exec vitest run test/stream-chat.test.ts`
Expected: FAIL — `request.signal.aborted` stays `false` after `reader.cancel()` (the `ReadableStream` has no `cancel()` handler).

- [ ] **Step 7: Chain caller signal + add `cancel()` + guard enqueue**

In `packages/llama-provider/src/provider.ts` `streamChat` (lines 267-413):

Replace the manual listener (lines 273-278) with `AbortSignal.any` (removes the listener leak — item 4c) and a cancelled flag:

```ts
    const controller = new AbortController()
    const signal =
      params.signal != null
        ? AbortSignal.any([params.signal, controller.signal])
        : controller.signal
    const abort = () => controller.abort()
    let cancelled = false
```

Add a `cancel()` to the `ReadableStream` (the object literal currently has only `start`, lines 329-409) so consumer cancellation aborts the prompt, and guard every `streamController.enqueue`/`close` behind `if (!cancelled)`:

```ts
      return new ReadableStream<MessagePart<ChatResponseChunk, ToolCall>>({
        start(streamController) {
          const safeEnqueue = (part: MessagePart<ChatResponseChunk, ToolCall>) => {
            if (!cancelled) streamController.enqueue(part)
          }
          const safeClose = () => {
            if (!cancelled) streamController.close()
          }
          promptOptions.onTextChunk = onTextChunk(streamController)
          session
            .promptWithMeta(prompt, promptOptions)
            .then((result) => {
              // ...existing result handling, but route every
              // streamController.enqueue(...) through safeEnqueue(...)
              // and streamController.close() through safeClose().
            })
            .catch((error: unknown) => {
              // ...existing catch, using safeEnqueue / safeClose ...
            })
            .finally(() => {
              session.dispose()
            })
        },
        cancel() {
          cancelled = true
          controller.abort()
        },
      })
```

In `onTextChunk`, also guard the enqueue (it captures `streamController` directly):

```ts
      const onTextChunk =
        (streamController: ReadableStreamDefaultController<MessagePart<ChatResponseChunk, ToolCall>>) =>
        (chunk: string) => {
          if (cancelled) return
          const raw: ChatResponseChunk = { text: chunk, done: false }
          streamController.enqueue({ type: 'text-delta', text: chunk, raw })
        }
```

Keep `return Object.assign(response, { abort, signal })` at the end (signal is now the chained signal).

- [ ] **Step 8: Run llama tests to verify they pass**

Run: `pnpm --filter @mokei/llama-provider exec vitest run test/load-cache.test.ts test/stream-chat.test.ts`
Expected: PASS. Also run the full package suite to catch regressions: `pnpm --filter @mokei/llama-provider exec vitest run`.

- [ ] **Step 9: Commit**

```bash
git add packages/llama-provider/src/provider.ts packages/llama-provider/test/load-cache.test.ts packages/llama-provider/test/stream-chat.test.ts
git commit -m "fix(llama-provider): retry failed loads, abort prompt on cancel, drop signal-listener leak"
```

---

## Task 6: openai constructor default + standardize timeout to 30s

**Files:**
- Modify: `packages/openai-provider/src/provider.ts:40` (add `= {}` default param)
- Modify: `packages/anthropic-provider/src/config.ts:4` (`DEFAULT_TIMEOUT` 60_000 → 30_000)
- Test: `packages/openai-provider/test/provider.test.ts` (create)

**Interfaces:**
- Produces: `new OpenAIProvider()` compiles with zero args (like Ollama/Anthropic).

- [ ] **Step 1: Write the failing test**

```ts
// packages/openai-provider/test/provider.test.ts
import { describe, expect, test } from 'vitest'

import { OpenAIProvider } from '../src/provider.js'
import { DEFAULT_TIMEOUT } from '../src/config.js'
import { DEFAULT_TIMEOUT as ANTHROPIC_DEFAULT_TIMEOUT } from '@mokei/anthropic-provider/config'

describe('OpenAIProvider construction', () => {
  test('constructs with no arguments', () => {
    const provider = new OpenAIProvider()
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })

  test('default timeout is standardized to 30s across providers', () => {
    expect(DEFAULT_TIMEOUT).toBe(30_000)
    expect(ANTHROPIC_DEFAULT_TIMEOUT).toBe(30_000)
  })
})
```

If `@mokei/anthropic-provider/config` is not an exported subpath, import the value indirectly instead:

```ts
// alternative if the subpath export is unavailable:
import { DEFAULT_TIMEOUT as ANTHROPIC_DEFAULT_TIMEOUT } from '../../anthropic-provider/src/config.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mokei/openai-provider exec vitest run test/provider.test.ts`
Expected: FAIL — `new OpenAIProvider()` is a type error (compile) / `ANTHROPIC_DEFAULT_TIMEOUT` is `60_000`.

- [ ] **Step 3: Add the default + change the timeout**

`packages/openai-provider/src/provider.ts:40`:

```ts
  constructor(params: OpenAIProviderParams = {}) {
    this.#client =
      params.client instanceof OpenAIClient ? params.client : new OpenAIClient(params.client)
  }
```

`packages/anthropic-provider/src/config.ts:4`:

```ts
export const DEFAULT_TIMEOUT = 30_000
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mokei/anthropic-provider build && pnpm --filter @mokei/openai-provider exec vitest run test/provider.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/openai-provider/src/provider.ts packages/anthropic-provider/src/config.ts packages/openai-provider/test/provider.test.ts
git commit -m "fix(providers): zero-arg OpenAIProvider, standardize default timeout to 30s

BREAKING: Anthropic provider default request timeout changes from 60s to 30s."
```

---

## Task 7: wire sampling params through all four providers + anthropic config

**Files:**
- Modify: `packages/openai-provider/src/client.ts` (`ChatParams` + body: add `providerOptions` spread-last)
- Modify: `packages/openai-provider/src/provider.ts:105-141` (resolve + forward sampling)
- Modify: `packages/anthropic-provider/src/client.ts:48-63,100-...` (`MessagesParams` + body: `providerOptions` spread-last)
- Modify: `packages/anthropic-provider/src/provider.ts:183-192` (resolve + forward sampling, `max_tokens` fallback)
- Modify: `packages/anthropic-provider/src/config.ts` (add `maxTokens` to schema) + `provider.ts:42-45` (thread through `fromConfig`)
- Modify: `packages/ollama-provider/src/provider.ts:55-79` (resolve + forward into `options`)
- Modify: `packages/llama-provider/src/provider.ts` (resolve + forward into `promptOptions`)
- Test: `packages/openai-provider/test/sampling.test.ts`, `packages/anthropic-provider/test/sampling.test.ts`, `packages/ollama-provider/test/sampling.test.ts` (create)

**Interfaces:**
- Consumes: `resolveSamplingParams`, `SamplingParams` from `@mokei/model-provider` (Task 1).
- Produces: each provider's `streamChat` honors `temperature`/`maxTokens`/`topP`/`providerOptions`; `AnthropicProvider.fromConfig` reads `maxTokens`.

### 7a. openai

- [ ] **Step 1: Write the failing test**

```ts
// packages/openai-provider/test/sampling.test.ts
import { describe, expect, test } from 'vitest'

import { OpenAIClient } from '../src/client.js'
import { OpenAIProvider } from '../src/provider.js'

function captureChat() {
  const calls: Array<Record<string, unknown>> = []
  const client = new OpenAIClient({ apiKey: 'test' })
  ;(client as unknown as { chat: (p: Record<string, unknown>) => unknown }).chat = (p) => {
    calls.push(p)
    const controller = new AbortController()
    return Object.assign(Promise.resolve(new ReadableStream({ start: (c) => c.close() })), {
      abort: () => controller.abort(),
      signal: controller.signal,
    })
  }
  return { client, calls }
}

describe('OpenAIProvider sampling params', () => {
  test('forwards temperature/maxTokens/topP and spreads providerOptions last', async () => {
    const { client, calls } = captureChat()
    const provider = new OpenAIProvider({ client })
    await provider.streamChat({
      model: 'gpt-x',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
      temperature: 0.3,
      maxTokens: 256,
      topP: 0.8,
      providerOptions: { seed: 7, temperature: 0.9 },
    })
    const body = calls[0]
    expect(body.temperature).toBe(0.9) // providerOptions wins (spread last)
    expect(body.top_p).toBe(0.8)
    expect(body.max_tokens).toBe(256)
    expect(body.seed).toBe(7)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mokei/openai-provider exec vitest run test/sampling.test.ts`
Expected: FAIL — sampling not forwarded; `body.temperature`/`top_p`/`max_tokens`/`seed` undefined.

- [ ] **Step 3: Implement**

`packages/openai-provider/src/client.ts` — add `providerOptions` to `ChatParams` (after line 72) and spread it last in the body (`chat`, after `response_format` line 133):

```ts
// in ChatParams:
  providerOptions?: Record<string, unknown>
```

```ts
        json: {
          model: params.model,
          messages: params.messages,
          stream: params.stream,
          stream_options: { include_usage: true },
          tools: params.tools,
          temperature: params.temperature,
          top_p: params.top_p,
          n: params.n,
          max_tokens: params.max_tokens,
          presence_penalty: params.presence_penalty,
          frequency_penalty: params.frequency_penalty,
          response_format: params.response_format,
          ...params.providerOptions,
        },
```

`packages/openai-provider/src/provider.ts` — import the helper and forward (in `streamChat`, the `this.#client.chat({...})` call ~line 106):

```ts
import { resolveSamplingParams } from '@mokei/model-provider'
// ...
  streamChat(params: StreamChatParams<Message, ToolCall, Tool>) {
    const sampling = resolveSamplingParams(params)
    const request = this.#client.chat({
      messages: params.messages.map(/* unchanged */),
      model: params.model,
      signal: params.signal,
      stream: true,
      tools: params.tools,
      temperature: sampling.temperature,
      top_p: sampling.topP,
      max_tokens: sampling.maxTokens,
      providerOptions: sampling.providerOptions,
      response_format: params.output ? { /* unchanged */ } : undefined,
    })
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @mokei/openai-provider exec vitest run test/sampling.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/openai-provider/src/client.ts packages/openai-provider/src/provider.ts packages/openai-provider/test/sampling.test.ts
git commit -m "feat(openai-provider): honor per-request sampling params + providerOptions"
```

### 7b. anthropic (incl. config `maxTokens`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/anthropic-provider/test/sampling.test.ts
import { describe, expect, test } from 'vitest'

import { AnthropicClient } from '../src/client.js'
import { AnthropicProvider } from '../src/provider.js'

function captureMessages(provider: { client: AnthropicClient }) {
  const calls: Array<Record<string, unknown>> = []
  ;(provider.client as unknown as { messages: (p: Record<string, unknown>) => unknown }).messages =
    (p) => {
      calls.push(p)
      const controller = new AbortController()
      return Object.assign(Promise.resolve(new ReadableStream({ start: (c) => c.close() })), {
        abort: () => controller.abort(),
        signal: controller.signal,
      })
    }
  return calls
}

describe('AnthropicProvider sampling params', () => {
  test('forwards sampling, falls back to defaultMaxTokens, spreads providerOptions last', async () => {
    const client = new AnthropicClient({ apiKey: 'test' })
    const provider = new AnthropicProvider({ client, defaultMaxTokens: 4096 })
    const calls = captureMessages({ client })

    await provider.streamChat({
      model: 'claude-x',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
      temperature: 0.4,
      topP: 0.7,
      providerOptions: { top_k: 5 },
    })
    const body = calls[0]
    expect(body.temperature).toBe(0.4)
    expect(body.top_p).toBe(0.7)
    expect(body.max_tokens).toBe(4096) // falls back when maxTokens unset
    expect(body.top_k).toBe(5)
  })

  test('fromConfig accepts maxTokens without throwing', () => {
    const provider = AnthropicProvider.fromConfig({ apiKey: 'test', maxTokens: 1024 })
    expect(provider).toBeInstanceOf(AnthropicProvider)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mokei/anthropic-provider exec vitest run test/sampling.test.ts`
Expected: FAIL — sampling not forwarded; `top_k` undefined; `fromConfig` ignores `maxTokens` (and `maxTokens` is not in the config schema, so `assertType` rejects it).

- [ ] **Step 3: Implement**

`packages/anthropic-provider/src/client.ts` — add `providerOptions` to `MessagesParams` (after line 62) and spread it last in the body. The `messages` method destructures `{ signal, system, ...restParams }`; pull `providerOptions` out too and spread its contents:

```ts
// in MessagesParams:
  providerOptions?: Record<string, unknown>
```

```ts
  messages(params: MessagesParams): StreamReplyRequest<StreamEvent> {
    const controller = new AbortController()
    const { signal, system, providerOptions, ...restParams } = params
    const request = this.#api.post<StreamEvent>('messages', {
      json: { ...restParams, system, ...providerOptions },
      // ...signal handling unchanged
    })
```

(Match the existing `json:`/`signal:` shape in the file; only the `json` object's spread changes.)

`packages/anthropic-provider/src/provider.ts` — resolve sampling and forward, keeping the required `max_tokens` fallback (the `this.#client.messages({...})` call, lines 183-192):

```ts
import { resolveSamplingParams } from '@mokei/model-provider'
// ...
    const sampling = resolveSamplingParams(params, { maxTokens: this.#defaultMaxTokens })
    const request = this.#client.messages({
      messages,
      model: params.model,
      signal: params.signal,
      stream: true,
      tools,
      tool_choice: toolChoice,
      max_tokens: sampling.maxTokens ?? this.#defaultMaxTokens,
      temperature: sampling.temperature,
      top_p: sampling.topP,
      providerOptions: sampling.providerOptions,
      system: systemPrompt,
    })
```

`packages/anthropic-provider/src/config.ts` — add `maxTokens` to the schema (inside `properties`):

```ts
    maxTokens: {
      type: 'integer',
      minimum: 1,
      description: 'Default max tokens for requests',
    },
```

`packages/anthropic-provider/src/provider.ts:42-45` — thread `maxTokens` through `fromConfig`:

```ts
  static fromConfig(config: AnthropicConfiguration): AnthropicProvider {
    assertType(validateConfiguration, config)
    return new AnthropicProvider({
      client: new AnthropicClient(config),
      defaultMaxTokens: config.maxTokens,
    })
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @mokei/anthropic-provider exec vitest run test/sampling.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/anthropic-provider/src/client.ts packages/anthropic-provider/src/provider.ts packages/anthropic-provider/src/config.ts packages/anthropic-provider/test/sampling.test.ts
git commit -m "feat(anthropic-provider): per-request sampling params, providerOptions, config maxTokens"
```

### 7c. ollama

- [ ] **Step 1: Write the failing test**

```ts
// packages/ollama-provider/test/sampling.test.ts
import { describe, expect, test } from 'vitest'

import { OllamaClient } from '../src/client.js'
import { OllamaProvider } from '../src/provider.js'

describe('OllamaProvider sampling params', () => {
  test('maps sampling into options and spreads providerOptions last', async () => {
    const calls: Array<Record<string, unknown>> = []
    const client = new OllamaClient({ baseURL: 'http://localhost:11434' })
    ;(client as unknown as { chat: (p: Record<string, unknown>) => unknown }).chat = (p) => {
      calls.push(p)
      const controller = new AbortController()
      return Object.assign(Promise.resolve(new ReadableStream({ start: (c) => c.close() })), {
        abort: () => controller.abort(),
        signal: controller.signal,
      })
    }
    const provider = new OllamaProvider({ client })

    await provider.streamChat({
      model: 'llama3',
      messages: [{ source: 'client', role: 'user', text: 'hi' }],
      temperature: 0.5,
      maxTokens: 128,
      topP: 0.6,
      providerOptions: { top_p: 0.95, seed: 1 },
    })
    const options = calls[0].options as Record<string, unknown>
    expect(options.temperature).toBe(0.5)
    expect(options.num_predict).toBe(128)
    expect(options.top_p).toBe(0.95) // providerOptions wins
    expect(options.seed).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mokei/ollama-provider exec vitest run test/sampling.test.ts`
Expected: FAIL — `calls[0].options` undefined.

- [ ] **Step 3: Implement**

`packages/ollama-provider/src/provider.ts` `streamChat` (the `this.#client.chat({...})` call ~line 56) — build `options` from resolved sampling, dropping undefined entries, and spread `providerOptions` last:

```ts
import { resolveSamplingParams } from '@mokei/model-provider'
// ...
    const sampling = resolveSamplingParams(params)
    const options: Record<string, unknown> = {}
    if (sampling.temperature !== undefined) options.temperature = sampling.temperature
    if (sampling.maxTokens !== undefined) options.num_predict = sampling.maxTokens
    if (sampling.topP !== undefined) options.top_p = sampling.topP
    Object.assign(options, sampling.providerOptions)

    const request = this.#client.chat({
      messages: params.messages.map(/* unchanged */),
      model: params.model,
      signal: params.signal,
      stream: true,
      tools: params.tools,
      options: Object.keys(options).length > 0 ? options : undefined,
      format: params.output ? (params.output.schema as Record<string, unknown>) : undefined,
    })
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @mokei/ollama-provider exec vitest run test/sampling.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ollama-provider/src/provider.ts packages/ollama-provider/test/sampling.test.ts
git commit -m "feat(ollama-provider): map per-request sampling params into options"
```

### 7d. llama

- [ ] **Step 1: Implement (wire into promptOptions)**

`packages/llama-provider/src/provider.ts` `streamChat` — resolve sampling and merge into both `promptOptions` branches (`params.output` and the tools branch, lines 315-327). node-llama-cpp `promptWithMeta` accepts `temperature`, `topP`, `maxTokens`:

```ts
import { resolveSamplingParams } from '@mokei/model-provider'
// ...inside streamChat, before building promptOptions:
      const sampling = resolveSamplingParams(params)
      const samplingOptions: Record<string, unknown> = {}
      if (sampling.temperature !== undefined) samplingOptions.temperature = sampling.temperature
      if (sampling.topP !== undefined) samplingOptions.topP = sampling.topP
      if (sampling.maxTokens !== undefined) samplingOptions.maxTokens = sampling.maxTokens
      Object.assign(samplingOptions, sampling.providerOptions)
```

Then spread `...samplingOptions` into each `promptOptions` object (after `signal`/`functions`/`grammar`, so providerOptions remains last word). Example for the tools branch:

```ts
        : {
            signal,
            functions: this.#buildFunctions(params.tools),
            onTextChunk: undefined as ((chunk: string) => void) | undefined,
            ...samplingOptions,
          }
```

(`samplingOptions` is typed `Record<string, unknown>`; if `promptWithMeta`'s typed options reject the spread, cast the merged object at the call site: `session.promptWithMeta(prompt, promptOptions as ...)` matching the existing cast style in the file.)

- [ ] **Step 2: Verify llama suite still green**

Run: `pnpm --filter @mokei/llama-provider exec vitest run`
Expected: PASS (no regressions; sampling pass-through has no dedicated mock assertion because the existing `promptWithMeta` mock ignores options — covered structurally + by typecheck).

- [ ] **Step 3: Commit**

```bash
git add packages/llama-provider/src/provider.ts
git commit -m "feat(llama-provider): forward per-request sampling params to promptWithMeta"
```

---

## Final verification

- [ ] **Build everything**

Run: `pnpm build`
Expected: types + JS build succeed across all packages.

- [ ] **Run the full test suite**

Run: `pnpm test`
Expected: all package suites pass.

- [ ] **Lint**

Run: `rtk proxy pnpm run lint`
Expected: no errors.

- [ ] **Update the roadmap + backlog**

Move `docs/agents/plans/backlog/2026-06-12-provider-robustness.md` to `completed/` (rename `.complete.md`) and update the `Now`/`Near-term` sections of `docs/agents/plans/roadmap.md` to reflect the shipped work. Commit.

```bash
git add docs/agents/plans/
git commit -m "docs: mark provider robustness audit shipped"
```

---

## Notes / out of scope

- Real-GGUF end-to-end llama tests remain in `docs/agents/plans/backlog/2026-02-03-llama-provider-follow-ups.md`.
- `providerOptions` is an untyped raw passthrough — validation is the caller's responsibility; backends reject unknown keys at request time.
- Behavior change to flag in release notes: Anthropic default request timeout 60s → 30s.
