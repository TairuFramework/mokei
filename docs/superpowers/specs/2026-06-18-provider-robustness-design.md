# Provider robustness + sampling params — design

**Date:** 2026-06-18
**Status:** approved, ready for implementation plan
**Origin backlog:** `docs/agents/plans/backlog/2026-06-12-provider-robustness.md`
**Packaging:** one combined PR (bugfixes 1–4, 6 + sampling-params feature 5)

## Problem

Each provider (`openai`, `anthropic`, `ollama`, `llama`) carries one or two
stream-killing or correctness bugs — unguarded parses that abort a whole turn,
broken abort wiring, wrong token accounting, permanently-cached failed model
loads. Separately, the provider abstraction exposes no per-request generation
options, so `Session`/`AgentSession` users cannot tune temperature, max tokens,
or top-p.

## Goals

1. No single malformed stream event or backend hiccup kills an in-flight turn.
2. Cancellation propagates to the backend across all four providers.
3. Correct token accounting (anthropic input tokens).
4. Add per-request sampling params (`temperature`, `maxTokens`, `topP`) plus a
   raw `providerOptions` passthrough, wired through all four providers.

## Non-goals

- Real-GGUF end-to-end llama inference tests — tracked in
  `docs/agents/plans/backlog/2026-02-03-llama-provider-follow-ups.md`.
- Deeper llama work (function calling, streaming shape) — same follow-up.

## Architecture decision

**Centralized sampling merge.** A single `resolveSamplingParams()` helper in
`@mokei/model-provider` owns precedence; each provider owns only backend
name-mapping and spreads the raw `providerOptions` bag last into its request
body. Rejected alternatives: per-provider merge (risks 4 divergent precedence
behaviors), Session-layer merge (wrong altitude — config defaults live in the
provider, not visible to Session).

## Scope — bugfixes

### 1. openai: unguarded SSE `JSON.parse`
`packages/openai-provider/src/client.ts:32-34`. Any non-JSON SSE data
(keep-alive comments, empty data lines from LiteLLM/vLLM, `[DONE]` variants)
throws inside the `TransformStream` and aborts the turn. Wrap the parse in
try/catch and skip unparseable events, matching the anthropic client's existing
tolerance. Skip silently; add a `logger.debug` only if the logger is already
threaded into this client path (do not add a new dependency).

### 2. anthropic: input tokens always 0 + tool-JSON guard
`packages/anthropic-provider/src/provider.ts:195-265`.
- `let inputTokens = 0` is declared inside `transform()`, so the value captured
  at `message_start` is gone when `message_delta` enqueues `done`. Hoist it next
  to `currentToolUse` (~line 195) so the value survives.
- Guard `JSON.parse(currentToolJson)` (line 247): malformed streamed tool JSON
  must surface as a tool-level error result, not abort the stream mid-turn.

### 3. ollama: `generate()` not cancellable
`packages/ollama-provider/src/client.ts:136`. `Object.assign(response,
controller)` copies nothing — `signal`/`abort` are prototype accessors. Use the
explicit signal form `chat()` already uses (line 152).

### 4. llama: failed-load caching, stream cancel, listener leak
`packages/llama-provider/src/provider.ts`.
- (a) `#loadingModels` entry deleted only on success (89-104); a rejected
  `loadModel` promise is returned to every future caller. Delete in `finally`.
- (b) `streamChat`'s `ReadableStream` (329-409) has no `cancel()` handler —
  consumer cancellation does not abort the prompt and the subsequent `enqueue`
  throws into an unhandled rejection. Add a `cancel()` that aborts the prompt;
  guard the post-cancel `enqueue`.
- (c) signal-listener leak (274-276), same `anySignal` pattern as the session
  layer. Use `AbortSignal.any` or remove the listener on settle.

### 6. constructor + timeout consistency
`packages/openai-provider/src/provider.ts:40`. `new OpenAIProvider()` is a type
error (no `= {}` default) while Ollama/Anthropic accept zero args, and
`docs/guides/providers.md:231` teaches the zero-arg pattern. Add the default.
Standardize the default request timeout to **30s across all four providers**
(anthropic currently 60s — this is a behavior change; flag in the changelog).

## Scope — sampling params feature (item 5)

### Shared interface
`packages/model-provider/src/index.ts` (`StreamChatParams` ~220-226). Add
optional fields:

```ts
type SamplingParams = {
  temperature?: number
  maxTokens?: number
  topP?: number
  providerOptions?: Record<string, unknown>
}
```

Folded into `StreamChatParams`. Unset = current behavior (no regression).

### Shared helper
`resolveSamplingParams(perRequest, configDefaults)` in `@mokei/model-provider`.
- **Precedence:** config default → typed per-request params → `providerOptions`
  spread **last** (raw bag wins; documented as the explicit "last word" escape
  hatch).
- Returns a normalized `{ temperature?, maxTokens?, topP?, providerOptions? }`.

### Per-provider name mapping
Each provider maps the normalized params and spreads `providerOptions` last into
its request body:

| Param       | openai        | anthropic       | ollama (`options.`) | llama (node-llama-cpp) |
|-------------|---------------|-----------------|---------------------|------------------------|
| temperature | `temperature` | `temperature`   | `temperature`       | `temperature`          |
| maxTokens   | `max_tokens`  | `max_tokens`    | `num_predict`       | `maxTokens`            |
| topP        | `top_p`       | `top_p`         | `top_p`             | `topP`                 |

### Anthropic config fixes (same item)
`packages/anthropic-provider/src/provider.ts`.
- `provider.ts:190` hardcodes `max_tokens = defaultMaxTokens` → use resolved
  `maxTokens ?? defaultMaxTokens`. The anthropic API **requires** `max_tokens`,
  so the resolved value must always fall back to `defaultMaxTokens` when unset.
  Other providers leave it unset → backend default.
- `defaultMaxTokens` is unreachable via `fromConfig` (42-45) → add it to the
  config schema (`@enkaku/schema`).

## Error handling philosophy

- Unparseable SSE / malformed stream events: skip or surface, never kill the
  stream. Silent skip matches the anthropic precedent.
- Malformed streamed tool JSON: surface as a tool-level error result — caller
  sees a failed tool, the turn continues.
- Cancellation (items 3, 4b): abort propagates to the backend; post-abort
  `enqueue` is guarded so no unhandled rejection escapes.

## Testing

Vitest, per package. Cross-package runs resolve built `lib/` — rebuild the
dependency before running.

- **openai parse:** SSE fixture with keep-alive comment + `[DONE]` + empty data
  line → stream completes, junk skipped.
- **anthropic tokens:** `done` carries non-zero `inputTokens` from
  `message_start`. Malformed tool-JSON fixture → tool-error result, stream not
  aborted.
- **ollama abort:** abort signal mid-`generate` → request actually cancelled
  (mock fetch observes the abort).
- **llama:** rejected `loadModel` → next call retries (entry cleared);
  `streamChat` consumer cancel → prompt aborted, no unhandled rejection.
- **sampling merge:** unit-test `resolveSamplingParams` precedence
  (config → typed → providerOptions); per-provider body-mapping assertions,
  including the anthropic `max_tokens` fallback.
- **constructor:** `new OpenAIProvider()` zero-arg compiles; 30s timeout across
  all four providers.

## Risks / behavior changes

- Anthropic default timeout 60s → 30s. Document in changelog.
- `providerOptions` is untyped raw passthrough — validation is the caller's
  responsibility; backends reject unknown keys at request time.
