# Anthropic provider test — pre-existing red suite

**Status:** done (2026-06-19)
**Found:** 2026-06-18, during the provider-robustness work (not caused by it — confirmed present on `main`).

## Resolution (2026-06-19)

- Deleted the stale `KNOWN_MODELS` describe block + import — no such symbol ever
  existed in `client.ts`; the source uses the real `GET /v1/models` endpoint.
- Rewrote the two `listModels` tests to mock the transport via
  `vi.spyOn(AnthropicClient.prototype, 'listModels')` — no network, no live 401.
  One asserts the `{ id, raw }` mapping, one asserts request-param forwarding.
- Fixed the stale "Anthropic doesn't have a list endpoint" comment in `client.ts`.

Suite now green: 19 pass, 0 fail. Lint clean.

## Gap

`packages/anthropic-provider/test/provider.test.ts` has 3 failing tests, red on `main`:

1. **`KNOWN_MODELS` import of a non-exported symbol** — the test does
   `import { AnthropicClient, KNOWN_MODELS } from '../src/client.js'`, but `client.ts`
   does not export `KNOWN_MODELS`. The `KNOWN_MODELS` describe block (and any test
   touching it) fails.
2. **Two `listModels` tests hit the live Anthropic API** without a key → 401.

This keeps `anthropic-provider`'s suite red regardless of other changes, eroding the
"all green" signal for every future branch.

## Fix

- Either re-add/export a `KNOWN_MODELS` constant from `client.ts` (if the known-models
  list is still intended) or delete the stale `KNOWN_MODELS` test block + import.
- Replace the live-API `listModels` tests with mocked-transport tests (no network), or
  mark them as integration-only behind an explicit opt-in.
