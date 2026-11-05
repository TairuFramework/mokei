# Provider error handling: typed errors and retry

**Status:** planned
**Date:** 2026-11-05
**Roadmap:** first slice of P2 "Enhanced error handling"

## Goal

Make transient model-provider failures survivable. Today a single `429`, `503`, Anthropic
`overloaded_error` or dropped connection ends a chat turn, and with it a whole `AgentSession`
run, and callers cannot tell a transient failure from a fatal one.

## Current state (evaluated 2026-11-05)

Already solid, out of scope:

- **MCP client.** `subscriptions/listen` reconnect with capped backoff and a `retryable` flag,
  HTTP GET-stream reconnect honouring the server `retry` hint, stale-schema `-32020` retry, OAuth
  401/403 step-up retry, MRTR round and total-time caps.
- **Tool failures in the agent loop.** Thrown tools, `isError` results, per-tool timeouts and
  unknown tool names become `tool-call-error` events and are fed back to the model, which can
  recover. Typed: `ToolCallTimeoutError`, `ToolCallCancelledError`, `UnknownToolError`.
- **Timeouts and cancellation.** 30s provider request timeout, agent run timeout, per-tool
  timeout, abort that unblocks a stalled stream.

Gaps this plan closes:

1. **No retry on chat or embeddings.** The OpenAI, Anthropic and Ollama clients use `ky` 2.2.0,
   whose default retry covers GET-style methods only. `chat/completions`, `messages`, `chat`,
   `embeddings` and `embed` are POSTs, so `429`, `5xx`, `529` and network errors fail at once.
   Only `listModels` gets ky's default retries. `ollama-provider` exposes `RequestOptions.retry`
   on `generate` and `listModels` only.
2. **Errors are untyped.** Callers get raw ky `HTTPError` / `TimeoutError`, or plain `Error`
   strings such as Anthropic's in-stream `new Error(\`${type}: ${message}\`)`
   (`packages/anthropic-provider/src/provider.ts`). No kind, no `retryable`, no `Retry-After`.
3. **In-stream errors.** Anthropic maps its SSE `error` event to an `error` part. The OpenAI
   provider does not handle an `{"error": …}` SSE payload, and the Ollama provider does not
   handle an `{"error": "…"}` JSON line: both are dropped or misparsed instead of surfacing.
4. **One error ends the agent run.** `Session` re-throws any `error` part
   (`packages/session/src/session.ts`), and `AgentSession` turns that into a terminal `error`
   event, even many iterations and tool calls in.

## Scope

### 1. `ProviderError` in `@mokei/model-provider`

```ts
export type ProviderErrorKind =
  | 'rate_limit'       // 429, anthropic rate_limit_error
  | 'overloaded'       // 503, 529, anthropic overloaded_error
  | 'server'           // other 5xx, anthropic api_error
  | 'network'          // fetch failure, connection reset, stream cut
  | 'timeout'          // request timeout (not caller abort)
  | 'auth'             // 401, 403
  | 'invalid_request'  // other 4xx
  | 'context_length'   // prompt too long, where the provider says so
  | 'unknown'

export class ProviderError extends Error // params object + #private fields + getters
// getters: kind, retryable, status?, retryAfterMs?, provider, cause
export type ProviderErrorParams = { … }
export function isRetryableProviderError(error: unknown): boolean
```

- `retryable` defaults from `kind`: `rate_limit`, `overloaded`, `server`, `network` and
  `timeout` are retryable; the rest are not.
- `retryAfterMs` comes from `Retry-After` (seconds or HTTP date), and from
  `retry-after-ms` / `anthropic-ratelimit-*-reset` where present.
- A caller abort is never a `ProviderError`; it stays the abort reason.
- Follows the repo error convention (one `<ClassName>Params` object, `#private` fields).

### 2. Map errors in every provider

- **OpenAI, Anthropic, Ollama:** one `toProviderError(error, provider)` per client, applied to
  every request promise (`chat`, `embeddings` / `embed`, `listModels`, `generate`). It reads
  ky `HTTPError` (status, headers, body `error.type` / `error.code` for `context_length`),
  `TimeoutError` and network `TypeError`s.
- **In-stream errors:** Anthropic's SSE `error` event, OpenAI's `{"error": …}` SSE payload and
  Ollama's `{"error": "…"}` JSON line all become an `error` part carrying a `ProviderError`.
  A stream that ends without its terminal event becomes `kind: 'network'`.
- **Llama:** local, no transport. Model-not-registered and grammar/tools conflicts become
  `invalid_request`; nothing is retryable.
- Embeddings and `listModels` get ky retry for their own requests (POST added to
  `retry.methods` for embeddings only, which are idempotent), with the same status codes and
  limits as below, so direct client users get it too.

### 3. Chat retry in `Session`

Retry lives in `Session.#streamChat`, once for every provider, rather than four times in
the clients:

- **Only before the first content part.** A rejected request promise, or an `error` part or
  stream failure before any text, reasoning or tool-call part, is retried. After the first
  content part nothing is retried: the consumer has already seen output, and replaying would
  duplicate it.
- **Policy:** `SessionParams.retry?: RetryPolicy | false`, overridable per turn on
  `StreamChatTurnParams`. Defaults: 2 retries (3 attempts), exponential backoff from 500ms
  with full jitter, capped at 30s; `retryAfterMs` wins when present and is still capped; only
  `isRetryableProviderError` errors.
- **Cancellation:** the backoff wait honours the turn signal, so abort and the agent run
  timeout still end a waiting turn at once.
- **Visibility:** a `Session` `provider-retry` event `{ attempt, error, retryInMs }`, and an
  `AgentSession` `retry` event with the same fields so the CLI can show
  `rate limited — retrying in 4s (1/2)`.
- **Telemetry:** one inference span per logical call, as with the OTel GenAI work (each
  operation counted once). Each failed attempt is a span event with `error.type` and the
  attempt number; the span's error status reflects only the final outcome.
- Export the wrapper from `@mokei/model-provider` as `retryStreamChat(start, policy)` so code
  that calls providers without `Session` can use it.

### 4. CLI

- Render `retry` events in the chat UI, and give final `ProviderError`s a message by kind
  (`auth`: check the API key; `context_length`: trim history; `rate_limit`: wait).

## Out of scope (later slices of the same roadmap item)

- **Lost-context reconnect.** `ContextHost` removes a closed context as `'lost'` and
  `NodeContextHost` does the same on stdio exit; nothing reconnects or respawns. An opt-in
  reconnect policy with backoff is the next slice.
- **Provider failover.** A composite `ModelProvider` that moves to the next provider/model on
  retryable errors. Needs this plan's `ProviderError`; request translation and model naming per
  provider make it its own design.
- **Tool circuit breaker.** Dropped in favour of a smaller rule if needed: hide a tool for the
  rest of an agent run after N consecutive failures. Tool errors already return to the model.
- **Mid-stream retry** after partial output.

## Steps

1. `ProviderError`, kinds, `isRetryableProviderError`, `Retry-After` parsing, tests.
2. Error mapping in the OpenAI, Anthropic and Ollama clients and providers, including the
   in-stream error payloads; llama mapping; embeddings/listModels ky retry. Tests against
   mocked responses for each status, header and in-stream case.
3. `retryStreamChat` and its use in `Session.#streamChat`; `retry` options and the
   `provider-retry` / `retry` events; tracing span events. Tests: retry before first part,
   no retry after it, abort during backoff, `Retry-After` honoured, non-retryable passes
   through, retries disabled with `false`.
4. CLI rendering of retry events and per-kind messages.
5. Docs: provider guide section on errors and retry; changeset (minor: new exports and
   options; errors thrown by providers change type, so note it as behaviour change).

## Done when

- A `429` or `503` with `Retry-After`, or an Anthropic in-stream `overloaded_error` before
  output, is retried and the turn completes; an agent run survives it.
- `401`, `400` and context-length errors fail at once with the right `kind`.
- OpenAI and Ollama in-stream error payloads surface as `ProviderError`s.
- `pnpm build`, `pnpm test` and `pnpm lint` pass.

## Open questions

- Default on or off? Proposed on (2 retries), since a single 429 ending an agent run is the
  worse default; `retry: false` opts out.
- `ky` `HTTPError` is still reachable as `cause`. Anyone matching on it directly breaks;
  acceptable for a minor in this lockstep release line?
