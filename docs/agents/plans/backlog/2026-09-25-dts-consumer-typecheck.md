# Typecheck published declarations as a consumer

**Status:** backlog
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
