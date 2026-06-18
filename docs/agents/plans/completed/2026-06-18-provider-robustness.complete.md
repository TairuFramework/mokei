# Provider robustness + sampling params

**Status:** backlog
**Origin:** 2026-06-12 full audit (security, stability, usability, MCP-spec).

## Gap

Each provider has one or two stream-killing or correctness bugs (unguarded parses,
broken abort, wrong token accounting, permanently-cached failures), and the provider
abstraction offers no per-request generation options at all.

## Scope

1. **openai: unguarded SSE `JSON.parse`** — `packages/openai-provider/src/client.ts:32-34`:
   any non-JSON SSE data (keep-alive comments / empty data lines from LiteLLM, vLLM,
   `[DONE]` variants) throws inside the TransformStream and aborts the whole turn.
   Try/catch and skip unparseable events (the anthropic client already does this).
2. **anthropic: input tokens always 0** —
   `packages/anthropic-provider/src/provider.ts:201-265`: `let inputTokens = 0` is
   declared inside `transform()`, so the value captured at `message_start` is gone when
   `message_delta` enqueues `done`. Hoist next to `currentToolUse` (line 195). Same
   block: guard `JSON.parse(currentToolJson)` (line 247) — malformed streamed tool JSON
   errors the stream mid-turn instead of surfacing a tool-level error.
3. **ollama: `generate()` not cancellable** — `packages/ollama-provider/src/client.ts:136`:
   `Object.assign(response, controller)` copies nothing (`signal`/`abort` are prototype
   accessors). Use the explicit form `chat()` already uses (line 152).
4. **llama: failed model load cached forever** —
   `packages/llama-provider/src/provider.ts:89-104`: `#loadingModels` entry only deleted
   on success; a rejected `loadModel` promise is returned to every future caller. Delete
   in `finally`. Also lines 329-409: `streamChat`'s ReadableStream has no `cancel()`
   handler — consumer cancellation doesn't abort the prompt, and the subsequent
   `enqueue` throws into an unhandled rejection. And lines 274-276: signal-listener leak
   (same `anySignal` pattern as session — see lifecycle backlog).
5. **Per-request sampling params** — `packages/model-provider/src/index.ts:220-226`:
   `StreamChatParams` has no `temperature`/`maxTokens`/`topP`, so `Session`/
   `AgentSession` users cannot tune generation. Add optional sampling params and wire
   through all four providers. While there: anthropic hardcodes `max_tokens` to
   `defaultMaxTokens` (`provider.ts:190`) and `defaultMaxTokens` is unreachable via
   `fromConfig` (`provider.ts:42-45`) — add it to the config schema.
6. **Constructor consistency** — `packages/openai-provider/src/provider.ts:40`:
   `new OpenAIProvider()` is a type error (no `= {}` default) while Ollama/Anthropic
   accept zero args — and `docs/guides/providers.md:231` teaches the zero-arg pattern.
   Add the default; consider aligning default timeouts (Anthropic 60s vs others 30s).

## Notes

- Item 5 is a small API addition (feature, not fix) — fine to split out if the rest
  ships as a pure bugfix PR.
- Pairs with `2026-02-03-llama-provider-follow-ups.md` for deeper llama work.

---

## Shipped — 2026-06-18 (`fix/provider-robustness`)

All 6 audit items landed (7 commits, `d0df124`..`698578c`):

1. **openai SSE parse guard** (`3ff900a`) — `parseEventData` skips `[DONE]`/empty/non-JSON; a stray gateway line no longer kills the turn.
2. **anthropic token accounting + tool-JSON guard** (`f0d19d0`) — `inputTokens` hoisted to stream scope (was always 0 at `done`); malformed streamed tool JSON surfaces a tool-level result instead of aborting the stream.
3. **ollama `generate()` abort** (`46bb6d7`) — replaced `Object.assign(response, controller)` (copies no prototype accessors) with the explicit `{ abort, signal }` form.
4. **llama lifecycle** (`29e9207`) — failed loads cleared in `finally` (no more cached rejection); `ReadableStream.cancel()` aborts the prompt with guarded enqueue/close; `AbortSignal.any` removes the caller-signal listener leak.
6. **constructor + timeout** (`48eaa62`) — zero-arg `new OpenAIProvider()`; default request timeout standardized to 30s. **BREAKING: anthropic default timeout 60s → 30s.**
5. **sampling params** (`698578c`) — `temperature`/`maxTokens`/`topP` + raw `providerOptions` passthrough via `resolveSamplingParams` (precedence: config default → typed → providerOptions spread last; the client owns the spread-last into the JSON body). anthropic config gains `maxTokens` (reachable via `fromConfig`) with required `max_tokens` fallback.

Plan: `docs/superpowers/plans/2026-06-18-provider-robustness.md`. Whole-branch review (opus): ready to merge, no Critical/Important.

**Follow-up filed:** `backlog/2026-06-18-anthropic-test-known-models.md` (pre-existing red test, not from this branch).

### Hardening (post-review)

`6c0fe18` — `resolveSamplingParams` strips transport-reserved keys (`signal`, `stream`)
from the `providerOptions` bag centrally, so the raw escape hatch cannot disable
streaming or cancellation (notably llama's `promptOptions.signal`). Sampling/tuning keys
still pass through.

### Key design decisions (preserved from spec)

- **One precedence helper.** `resolveSamplingParams` in `@mokei/model-provider` owns the
  precedence (config default → typed per-request → `providerOptions` last). Providers
  implement only the backend name table (`max_tokens`/`num_predict`/`maxTokens`,
  `top_p`/`topP`), so they cannot diverge on precedence.
- **Client owns the `providerOptions` spread.** Providers forward the bag as a field; each
  client spreads it last into the actual request body (the wire), keeping the merge at the
  layer that builds the request. Transport-reserved keys (`signal`/`stream`) are stripped
  upstream in the helper.
- **Errors never kill a turn.** Unparseable SSE / malformed streamed tool JSON are skipped
  or surfaced as tool-level results, never thrown into the stream.
- **30s default timeout across all four providers** (anthropic 60s → 30s, BREAKING).

**Status:** complete — all 7 tasks implemented, per-task reviewed, two whole-branch opus
reviews (ready to merge), gates green (build 18/18, lint 279, all new tests pass). Only
remaining red is the pre-existing anthropic `KNOWN_MODELS` suite (filed as follow-up).
