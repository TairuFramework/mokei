# Provider error handling: typed errors and retry

**Status:** complete
**Date:** 2026-11-05

First slice of the roadmap's "Enhanced error handling" item.

## Goal

Make transient model-provider failures survivable. A single `429`, `503`, Anthropic
`overloaded_error` or dropped connection ended a chat turn, and with it a whole `AgentSession` run,
and callers could not tell a transient failure from a fatal one.

## Shipped

- **Typed errors.** All four providers report failures as a `ProviderError` from
  `@mokei/model-provider`, with a `kind`, a `retryable` flag, and `status`, `code` and
  `retryAfterMs` where known. This includes in-stream errors: the OpenAI and Ollama payloads that
  used to crash stream parsing now surface as `error` parts.
- **Chat retry.** `Session` retries a chat request that fails with a retryable error before
  producing output: 2 retries by default, exponential backoff with full jitter, honouring
  `Retry-After`, capped at 30s. It is configurable per session and per turn. `retryStreamChat` is
  exported for code that calls providers without `Session`.
- **Embeddings and model listing** retry in ky, so direct client users get retries too.
- **Visibility.** A `provider-retry` session event, a `retry` event from `AgentSession`, and
  `mokei.retry` span events. The CLI shows retry notices and explains final failures by kind.

## Key decisions

- **Retry lives in `Session`, not the provider clients,** so it is implemented once for every
  provider and stays inside the one inference span. Each logical call counts once in telemetry, and
  the span's status reflects only the final outcome.
- **Nothing is retried after the first output part.** The consumer has already seen that output, and
  replaying would duplicate it.
- **Retry is on by default,** because a single `429` ending an agent run is the worse default.
  `retry: false` opts out.
- **Ships as a minor, flagged as a behaviour change.** Providers reject with `ProviderError` instead
  of ky's errors, which stay reachable as `cause`. Code matching on ky types must switch.
- **A caller abort is never a `ProviderError`.** It stays the abort reason.
- **`@mokei/model-provider` takes no ky dependency.** `toProviderError` is duck-typed over ky errors
  and `fetch` failures.
- **Classification is deliberately conservative:**
  - A stream ending without its terminal event is not an error, because providers do not all mark
    the end reliably. Only a read failure maps to `network`.
  - `413` is `invalid_request`, because Anthropic uses it for byte limits. `context_length` comes
    from the provider's code or message.
  - Ollama in-stream errors are `unknown` and not retried, unless the message reports a context
    overflow, because Ollama gives no code to identify a transient failure.
  - A spent OpenAI `insufficient_quota` is not retryable.

## Not included

- **Lost-context reconnect** and **provider failover** remain later slices on the roadmap. Failover
  builds on `ProviderError`.
- **Tool circuit breaker** was dropped, because tool errors already return to the model. A per-run
  consecutive-failure limit replaces it if needed.
- **Mid-stream retry** after partial output was left out.
