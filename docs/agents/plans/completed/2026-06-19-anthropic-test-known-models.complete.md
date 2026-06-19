# Anthropic provider test — pre-existing red suite

**Status:** complete
**Origin:** 2026-06-18, found during the provider-robustness work (not caused by it —
confirmed present on `main`). Shipped 2026-06-19 (commit `eb0f5b6`).

## Gap

`packages/anthropic-provider/test/provider.test.ts` was red on `main`: it imported a
non-existent `KNOWN_MODELS` symbol from `client.ts`, and two `listModels` tests hit the
live Anthropic API (401 without a key). This kept the suite red on every branch,
eroding the "all green" signal.

## Resolution

- The implementation is correct: `client.listModels` uses the real `GET /v1/models`
  endpoint (Anthropic does have a list endpoint) — kept as-is; only the stale
  "doesn't have a list endpoint" comment was fixed.
- Deleted the stale `KNOWN_MODELS` describe block + import (the symbol never existed
  in `client.ts`).
- Rewrote the two `listModels` tests to mock the transport via
  `vi.spyOn(AnthropicClient.prototype, 'listModels')` — no network, no live 401. One
  asserts the `{ id, raw }` mapping, the other asserts request-param forwarding.

## Status

Done. Suite green (19 pass, 0 fail), lint clean.
