# MRTR follow-ups (SEP-2322)

**Status:** complete
**Completed:** 2026-09-02
**Branch:** `mrtr-followups`

Closes the four deferred, non-blocking items surfaced by the MRTR review (see
`2026-08-08-mcp-mrtr.complete.md`). Each was independent and could land in any order; all four
shipped together, plus a typecheck-hardening fix and a review follow-up. No runtime behaviour
change except the empty-map rejection (item 2).

## What was built

- **1 — Typed `allowInputRequired` on the client wrappers.** `callTool`, `getPrompt` and
  `readResource` now carry overloads: passing `allowInputRequired: true` (or a non-literal
  `boolean`) widens the return type to `Result | InputRequiredResult`, while the auto-fulfilment
  path (`false` or the absent flag) keeps the terminal result type. The overload set is ordered
  `{ allowInputRequired?: false }` → `{ allowInputRequired: true }` → `{ allowInputRequired: boolean }`,
  which keeps `as never` call sites and plain calls on the terminal type while still resolving an
  overload for a flag spread from a caller's options. Removes the `as unknown as {...}` casts from
  `docs/guides/client.md` and the client test, which now narrow with `isInputRequiredResult`.
- **2 — Empty `inputRequests: {}` rejected at the wire.** The `inputRequiredResult` `anyOf` only
  asserts key *presence*, so `{ inputRequests: {} }` used to validate and drive the client into a
  `requestState`-less retry loop that repeated byte-identically until the round cap tripped. Fixed
  at the root with `minProperties: 1` on the `inputRequests` schema (`2026-07-28`), caught at wire
  validation rather than by a driver heuristic. (Design decision: schema reject over a driver
  short-circuit, chosen because it is the root cause and gives a precise validation error.)
- **3 — Hoisted the default `requestState` minter.** `defaultMintRequestState` is now exported
  once from `@mokei/context-server`'s `mrtr.ts` and reused by `ContextServer` and `@mokei/host`'s
  local-tool runner, replacing two inline `(payload) => JSON.stringify(payload)` closures.
- **4 — End-to-end `mint`/`verify` coverage + frozen hooks.** A new server test drives a real
  signed `mint`/`verify` pair through the full suspend → echo → verified-resume flow — the path an
  HMAC-signed-state integration takes — which was previously only covered by a refusal test and a
  unit decode. Related hardening: `ContextServer` now freezes a shallow copy of the request-state
  hooks at construction, so a `verify` mutated into the caller's hooks object after it clears the
  `verify`-without-`mint` guard can no longer start gating resumes (covered by a second test).

## Follow-up work folded in

- **Typecheck hardening.** `ServerResult` on `2026-07-28` is now spelled as a union of its
  members' individual `FromSchema` derivations rather than `FromSchema<typeof serverResult>`. The
  two are equivalent (`FromSchema` distributes over `anyOf` and the `allOf` that `withResultType`
  adds), but deriving the whole union in one instantiation tipped `FromSchema` past its
  recursion-depth ceiling (TS2589) whenever a downstream package type-checked the emitted `.d.ts`
  without `--skipLibCheck`. Per-member derivation stays shallow. The failure had been masked
  repo-wide because every package builds with `--skipLibCheck`.

## Status

All four items implemented and verified: full build, the whole test suite, and lint pass. A Codex
review of the branch raised one P1 — a `boolean`-typed opt-in flag matched neither of the original
two overloads — which was fixed by the third overload described in item 1.
