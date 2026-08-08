# MRTR follow-ups

Five items left after MRTR (SEP-2322) shipped on `2026-07-28` — see
`completed/2026-08-08-mcp-mrtr.complete.md`. Each was surfaced by a review on that branch, judged
non-blocking, and deferred deliberately. None depends on the others; they can land in any order or
individually.

## 1. `allowInputRequired` lies about its return type through the typed wrappers

`client.callTool({ name, allowInputRequired: true })` is typed `Promise<CallToolResult>` but
returns an `InputRequiredResult` at runtime. `result.content.map(...)` is then a `TypeError` with
no compile error. Same for `getPrompt` and `readResource`. This is the documented opt-in path for
a caller that wants to drive MRTR rounds itself, so it should be typed: a conditional return type
keyed on the options generic, or a `CallToolResult | InputRequiredResult` union when
`allowInputRequired` is present.

The workaround is visible in the codebase today — `docs/guides/client.md` casts through
`as unknown as {...}` and the client test does the same. Fixing the type removes both.

## 2. Duplicate `InputRequiredResult` / `isInputRequiredResult` in two packages

`@mokei/context-client` and `@mokei/context-server` each export a hand-written, structurally
identical copy under the same names, while `@mokei/context-protocol` — which owns the
`inputRequiredResult` schema and already exports `InputRequest`, `InputResponse` and
`INPUT_REQUEST_CAPABILITIES` — exports neither. A consumer importing both packages gets a name
collision on `isInputRequiredResult`.

The fix is to define both in `@mokei/context-protocol` beside the schema they describe and re-export
from the two packages. This is public API, so it is worth doing before the surface has users
depending on the current shape.

Note the client's `MRTR_METHODS` duplication is *not* part of this: the client must not depend on
`@mokei/context-server`, and that copy is documented in place with its rationale.

## 3. An empty `inputRequests` map from a foreign server burns the round cap

`inputRequiredResult`'s `anyOf` asserts key *presence*, not non-emptiness, so
`{ resultType: 'input_required', inputRequests: {} }` validates on the wire. The client then takes
the pacing branch, sleeps 250 ms, and retries with neither `inputResponses` nor `requestState` — a
byte-identical repeat of the original request — ten times, then raises
`InputRequiredRoundsExceededError`.

Bounded and terminating, which is why it was left. mokei's own `inputRequired()` builder already
refuses to emit this, so it only arises from a non-mokei peer. Worth either rejecting an empty map
in the schema or short-circuiting it in the driver with a clearer error than a round-cap timeout.

## 4. The default `requestState` minter is duplicated

`ContextServer` allocates a fresh `JSON.stringify` closure per request as the default
`mintRequestState`, and `@mokei/host`'s `local-tools.ts` repeats the same literal. Hoist one
exported constant from `@mokei/context-server`'s `mrtr.ts` and use it in both places.

## 5. No end-to-end test of a matched custom `mint` → echo → `verify` round trip

The `requestState` integrity hooks are covered by a refusal test (a throwing `verify` yields
`-32602`) and a unit-level decode test, but no test drives a server configured with a real
`mint`/`verify` pair through a full suspension → echo → verified-resume flow. That is the path a
user implementing HMAC-signed state will actually take, and it is currently unproven end to end.

Related, and cheap to fold in: the constructor guard that refuses a `verify`-without-`mint`
configuration reads the hooks at construction time, so mutating the hooks object afterwards to add
`verify` still slips through. Exotic, but a frozen copy would close it.
