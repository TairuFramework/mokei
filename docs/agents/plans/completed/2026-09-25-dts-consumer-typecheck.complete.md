# Typecheck published declarations as a consumer

**Status:** complete (2026-09-25)
**Origin:** `completed/2026-09-02-mcp-mrtr-followups.complete.md` records a TS2589 error in an
emitted declaration that package builds missed because they use `--skipLibCheck`.

## Goal

Add a small consumer fixture that imports published package entry points from built declarations
and runs TypeScript with `skipLibCheck: false`. The current package `build:types`, `build:types:ci`
and `test:types` scripts use `--skipLibCheck`; `integration-tests` does too. No existing
declaration-consumer gate was found.

The fixture should catch deep type instantiation errors in the public `.d.ts` graph without
rechecking unrelated dependency declarations. Run it in CI after package declaration builds and
document any necessary exclusions with an exact reason.

## Outcome

`integration-tests/dts-consumer/index.ts` type-imports every published entry point (the 22
library entries plus `@mokei/mcp-fetch/config`; the `mokei` CLI publishes no library entry).
`dts-consumer/check.mjs` runs `tsc` on it with `skipLibCheck: false` and `lib: ["es2025", "dom"]`,
the same libs the packages build against. It runs as part of the `integration-tests` `test:types`
script, which `build:types:ci` calls after every package's declarations are built, so CI gates on
it.

Errors in `node_modules` are reported as a count and do not fail the check: node-llama-cpp 3.19.0
ships declarations that reference a missing `LlamaOptions.tempDir` and the untyped `async-retry`.
A type error added to `packages/logger/lib/index.d.ts` failed the check, as expected. The first
run found no errors in mokei's own declarations.
