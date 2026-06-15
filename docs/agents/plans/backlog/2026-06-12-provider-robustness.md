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
