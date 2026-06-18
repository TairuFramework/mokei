# Anthropic provider test — pre-existing red suite

**Status:** backlog
**Found:** 2026-06-18, during the provider-robustness work (not caused by it — confirmed present on `main`).

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
