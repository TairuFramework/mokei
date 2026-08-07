# MCP draft — remaining work

**Status:** backlog
**Origin:** `milestones/2026-06-08-mcp-draft-migration.md`. Consolidates the two prior
backlog files (deferred groundwork + breaking cut) down to live, unshipped work only.
Shipped work is recorded in the completed summaries, not repeated here:
`completed/2026-06-20-mcp-deferred-groundwork.complete.md` (G1–G8),
`completed/2026-08-02-mcp-2026-07-28-stateless-core.complete.md` (B5, B2, B3, B1 and the
`logLevel` half of B6) and `completed/2026-08-03-mcp-2026-07-28-defect-wave.complete.md`
(the §3.1 correctness defects, all of §3.5, §3.3.2, §3.3.4 and the §3.6 follow-ups).

Section numbers are stable: gaps mean an item shipped, not that it was renumbered.

## Pieces

This file tracks six independent sub-projects, of which three are now shipped. Each of the rest
can be picked up on its own; only D and E are large. Sections below hold the detail -- this table
says what exists and where it is.

| Piece | Scope | Size | Where |
|-------|-------|------|-------|
| A | Interop peer matrix + `Mcp-Param-*` coverage | -- | Shipped 2026-08-04 (PR #42), `completed/2026-08-04-interop-peer-matrix.complete.md` |
| B | Stale-schema retry on `-32020` (§1) | -- | Shipped 2026-08-07, `completed/2026-08-07-mcp-header-story-bc.complete.md` |
| C | Direct `Mcp-Method` assertion + remaining §3.2.4 coverage | -- | Shipped 2026-08-07, same summary |
| D | B7 MRTR -- `inputRequests` / `inputResponses` (§2 item 6) | Large | `next/2026-08-04-mcp-mrtr.md` |
| E | B4 `subscriptions/listen` + the `2025-11-25` `resources/subscribe` branch (§2 item 7, §3.3.3) | Large | Here |
| F | D1--D3 deprecation handling (§2 item 8) + the §3.4 tidy-ups | Medium | Here |

B and C together finished the `x-mcp-header` work on 2026-08-07: the encoder was already
conformant against a real decoder, and now a stale schema is refreshed and retried and
`Mcp-Method` is asserted directly against the SDK v2 peer. D unlocks
`sampling`, `elicitation` and `roots` on `2026-07-28` and makes the `-32021` ladder reachable.

## 1. Deferred groundwork — closed

- **G7 part 5** — stale-schema fallback: on a `-32020` HeaderMismatch, refresh via
  `tools/list` and retry the `tools/call`. **Shipped 2026-08-07** in `@mokei/http-client`'s
  `HTTPTransport` (`#refreshToolAnnotations` / `#retryAfterSchemaRefresh`), gated on a `-32020`
  whose `data.mismatch.header` names an `Mcp-Param-*` header, bounded at one retry, and driven
  end to end against the SDK v2 server by a peer whose `headerEcho` schema gains an annotation
  between the client's `tools/list` and its `tools/call`
  (`integration-tests/suites/interop-sdk-server.test.ts`). Design of record:
  `completed/2026-08-07-mcp-header-story-bc.complete.md`.

  Historical note on the two blockers, both gone as of 2026-08-04: SDK `2.0.0`'s server *does* emit
  `-32020` `HeaderMismatch` for an `Mcp-Param-*` disagreement
  (`core-internal/src/shared/mcpParamHeaders.ts`, `validateMcpParamHeaders`, HTTP `400`,
  offending pair in `data.mismatch`), reachable from the integration suite today via
  `startSDK20260728HTTPServer`; and the `-32001` collision with `SESSION_EXPIRED_CODE` is beside
  the point, since the specification's code is `-32020`, which mokei already reserves as
  `HEADER_MISMATCH`. Self-contained in `@mokei/http-client`. *Update 2026-07-02:*
  SDK v2 beta can now serve as the live draft peer (see
  `2026-07-02-mcp-sdk-v2-adoption.md`, interop tests item). *Update 2026-07-27:* the peer
  harness is in place (`integration-tests/support/interop/`, SDK `2.0.0-beta.5`), covering
  `2025-11-25` in all four client/server × stdio/HTTP combinations; the `2026-07-28`
  half lands with the B-wiring. *Update 2026-08-04:* the 2026-07-28 half landed (SDK
  2.0.0) — see §3.2.3.

### Non-blocking polish (from final review) — closed

All three are resolved; kept here only so the cross-references from that review still land.

- ~~Cache collected `x-mcp-header` annotations alongside the schema in `#toolSchemas`~~ — done
  2026-08-07: `#toolSchemas` became `#toolAnnotations`, written through one
  `#cacheToolAnnotations` helper shared by the list path and the refresh path, so `#sendMessage`
  no longer re-walks a schema on every `tools/call`.
- ~~Clarify the `collectHeaderAnnotations` error message for the `$ref`-wrapper-plus-target
  duplicate edge~~ — done 2026-08-07: a wrapper and its target agreeing on one name at one
  argument path is one declaration seen twice and is accepted; disagreeing on the name reports
  `Conflicting` rather than the misattributed `Duplicate`; two *different* paths sharing a name
  remain a `Duplicate`. The eligibility check moved ahead of both uniqueness branches, and a bare
  `$ref` wrapper carrying no `type` now defers that check to its target and is recorded as pending
  until some node at that path supplies a type — an unprovable type being ineligible.
- ~~Two `useLiteralKeys` Biome *infos* in `http-client/src/x-mcp-header.ts`~~ — no longer reported;
  `pnpm exec biome check packages/http-client/src` is clean.

## 2. Additive draft wiring (B4, B6-roots, B7, D1–D3)

**Draft finalized; the stateless core shipped for both transports.** Not a hard-cut: mokei
keeps `2025-11-25` and adds the finalized `2026-07-28` revision as a second version selected
per context (see the milestone's Architecture decision). The remaining B-items are additive
wiring behind a version selector, not removals.

Original numbering kept so cross-references still resolve:

5. **B6** remove `logging/setLevel` + roots list-changed; per-request `_meta` log level.
   **`logLevel` half delivered, both transports.** The roots list-changed half is not done and
   belongs with B7 (roots only exist through MRTR on `2026-07-28`).
6. **B7** MRTR — `inputRequests`/`inputResponses` replace server-initiated requests
   (SEP-2322). Deepest; dismantles bidirectional `request()`/`#sentRequests` in
   `context-rpc`. Depends on U1 + B2. **Not shipped:** client and server refuse
   `sampling/createMessage`, `elicitation/create` and `roots/list` at setup on `2026-07-28`
   (`MRTRNotSupportedError`) rather than implementing MRTR itself.

   The wire schema admits a spec-shaped suspended result (`inputRequiredResult` in
   `context-protocol/src/versions/2026-07-28.ts`) so the client's refusal fires with its own
   error rather than a generic validation failure — but nothing consumes `inputRequests` or
   sends `inputResponses`. When this lands, tighten `withResultType` to `const: 'complete'`:
   it currently admits `'input_required'` on every terminal branch, so a `callToolResult`-shaped
   frame labelled `input_required` validates.
7. **B4** `subscriptions/listen` replaces GET endpoint + `resources/subscribe` (SEP-2575).
   Rewrite HTTP server/client streaming. Depends on U1; parallel with B7.
   **`2025-11-25`-side `resources/subscribe` (folded from the retired `2026-07-02-mcp-feature-gaps.md`,
   gap 3):** the `2025-11-25` protocol types exist (`subscribeRequest` / `unsubscribeRequest` /
   `resourceUpdatedNotification` in `context-protocol/src/resource.ts`) but there are no client
   methods, no server dispatch, and no `resources.subscribe` capability declaration. Since mokei
   keeps `2025-11-25` per the coexistence decision, a `2025-11-25` peer may still expect this surface.
   Implement it as the `2025-11-25` branch of B4 only if a real peer needs it.
8. **D1–D3** apply deprecation handling (Roots/Sampling/Logging; HTTP+SSE transport;
   `includeContext`) as the above land.

The U1 streaming arm and continuation store are built, unit-tested and hardened, but have **no
wire trigger yet**; B4/B7 wire into the `_registerStreamExchange` seam
(`context-rpc` `exchange.ts` / `continuation.ts`). Nothing is open on the registry itself — the
remaining decisions (continuation state across reconnects, server-minted handles) live in the
milestone's open questions.

## 3. Findings from `feat/mcp-2026-07-28-core` (filed 2026-08-01)

Everything below was verified against source. Nothing here is speculative.

### 3.2 Test-coverage gaps

#### 3.2.1 The encode-side header logic is structurally untested

mokei's HTTP client encodes `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*`. mokei's HTTP server
validates **none** of them — zero references to any of those header names anywhere under
`packages/http-server/src`. So the encoder has only ever been exercised against a peer that
ignores its output, and **any client-side header-encoding bug is invisible to every
mokei-against-mokei suite by construction**, no matter how many are added.

This is not hypothetical: it already produced two real defects. `Mcp-Name` was omitted for
`resources/read`, and it was found the day an SDK peer was added — not by any of the
mokei-against-mokei coverage that preceded it. The Base64 sentinel gap (since fixed) was the
same shape. `Mcp-Param-*` is built by the same code and still has unit coverage only. The fix
is not more unit tests; it is a peer that reads the headers (see 3.2.3).

#### 3.2.4 Still unexercised against mokei

- `subscriptions/listen` (also B4).
- The `MissingRequiredClientCapability` ladders — not reachable on `2026-07-28`, where
  `PROTOCOL.serverMethods` is empty and no handler can need an undeclared client capability. The
  emitter arrives with MRTR (B7).
- Task-augmented params — SEP-2663 removed tasks from the specification and mokei never
  implemented them; delete this line rather than covering it.

Covered as of 2026-08-07: `Mcp-Method` is asserted directly on the outgoing request for a
`tools/call`, a `prompts/get` and a `resources/read`, no longer merely implied by the SDK's
inbound classifier accepting the `2026-07-28` HTTP calls. The `globalThis.fetch` wrapper the
omitted-argument case used became a `captureFetch` helper in
`integration-tests/suites/interop-sdk-server.test.ts` and both cases now share it.

Covered as of 2026-08-04 (see 3.2.3): `Mcp-Param-*` end to end against the SDK's decoder,
including the Base64 sentinel and integer paths and the omitted-argument case; and
`server/discover`'s `_meta` contents, asserted through the SDK client's `getServerVersion()`.
Negative `Mcp-Name` cases were deliberately not built — written the obvious way (a raw `fetch`
carrying a wrong header) they test the SDK rather than mokei, since the request never goes
through mokei's encoder at all.

### 3.3 Design and hygiene

#### 3.3.1 `-32020` and `-32021` have constants but no emitter

- `-32020` `HEADER_MISMATCH` — **half closed as of 2026-08-07.** The constant now has a reachable
  *consumer*: the HTTP client's stale-schema retry recognises a peer's `-32020` by comparing
  against it (G7 part 5, §1 above), and that path is exercised against a real SDK peer. It still
  has no **emitter**, and will not get one from this work: mokei's HTTP server does not read
  `Mcp-Param-*`, `Mcp-Method` or `Mcp-Name` at all (see 3.2.1), so nothing in mokei is in a
  position to reject a request for a header/body disagreement. An emitter needs the server-side
  header validation of 3.2.1, which is not scheduled.
- `-32021` `MISSING_REQUIRED_CLIENT_CAPABILITY` — the constant exists and has **no reachable
  emitter**. On `2026-07-28` a server sends no requests at all (`PROTOCOL.serverMethods` is
  empty), so no handler can need an undeclared client capability, and
  `ServerClient.createMessage` / `elicit` / `listRoots` throw `MRTRNotSupportedError` first.
  Revisit with MRTR (B7).

#### 3.3.3 `2025-11-25`'s `clientMethods` omits `resources/subscribe`/`unsubscribe`

`packages/context-protocol/src/versions/2025-11-25.ts` lists eleven client methods, omitting
both, although `clientRequest` / `clientMessage` do include `subscribeRequest` /
`unsubscribeRequest`.

**Do not simply widen the table.** `packages/context-server/src/server.ts` gates *inbound*
requests on that same set (`if (!protocol.clientMethods.has(request.method))` →
`METHOD_NOT_FOUND`), so widening it changes server behavior too: mokei would start accepting
subscribe/unsubscribe requests it has no dispatch for. Fix this together with the
`2025-11-25` side of B4 (§2 item 7), not on its own.

#### 3.3.5 The CLI's `-p` means three different things

`--provider` on `chat` (`packages/cli/src/options.ts:31`), `--port` on `monitor`
(`packages/cli/src/commands/monitor.tsx:21`), `--protocol` on `inspect`
(`packages/cli/src/commands/inspect.tsx:64`) — and `-p` is *also* accepted as `--protocol` inside
the `/context add` slash command, which runs inside `chat`, where top-level `-p` means provider.
No collision, since no two are reachable in the same argv position, but it is inconsistent enough
to mislead. Renaming any of them is a breaking change, so this is a deliberate note rather than a
proposal.

### 3.4 Carried over from the plan's own out-of-scope list

- **A refresh-specific timeout in `HTTPTransport`.** Since the stale-schema retry shipped
  (2026-08-07), a firing retry can hold the transport's serial outgoing sink for three round trips
  — the original POST, the `tools/list` refresh, and the re-send — each bounded by its own full
  `#timeout` budget rather than sharing one, so ~90s at the default. A tighter budget for the
  refresh alone would bound the worst case without shortening the calls the caller actually made.
  See `completed/2026-08-07-mcp-header-story-bc.complete.md`.
- Extracting a `SetupReader` unit from `packages/context-client/src/client.ts` (~1172 lines, of
  which ~240 are pure declarations that should move first).
- Removing the two derivable `ProtocolDefinition` booleans — `requiresHandshake` and
  `requiresPerRequestLogLevel` (`packages/context-protocol/src/versions/types.ts:32,43`). Drift
  is already guarded by a test (`packages/context-protocol/test/versions.test.ts:124-130`), so
  this is tidying, not a defect.
- The full per-revision `ServerRequest` / `ServerNotification` type split. The result side was
  split by the defect wave; requests and notifications still share the cross-revision unions.
- **Host-level caching of `'auto'` resolution.** `ContextClient` already caches its resolved
  revision for the transport's lifetime, and each context owns exactly one transport, so the only
  thing a host-level cache would add is reuse *across* contexts sharing a config — which needs a
  registry keyed by structural config identity, invalidated on a signal nobody has specified.
  Speculative work for one saved round trip.

## Notes

- Re-read the milestone's "Open questions" (MRTR continuation state, `server/discover` STDIO
  probe semantics, server-minted handles) before starting B4/B7.
- Re-validate every B-item against the final spec before implementing draft payloads.
