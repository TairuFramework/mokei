# MCP draft — remaining work

**Status:** backlog
**Origin:** `milestones/2026-06-08-mcp-draft-migration.md`. Consolidates the two prior
backlog files (deferred groundwork + breaking cut) down to live, unshipped work only.
Shipped groundwork (G1–G8, G5 outbound/baggage/inbound, G7 walk depth) is recorded in
`completed/2026-06-20-mcp-deferred-groundwork.complete.md` and the milestone — not repeated
here.

## 1. Deferred groundwork — last item

- **G7 part 5** — stale-schema fallback: on a `-32001` HeaderMismatch, refresh via
  `tools/list` and retry the `tools/call`. **Deferred:** no server emits HeaderMismatch
  today (no live draft server), and `-32001` already means `SESSION_EXPIRED_CODE` in mokei
  (`http-client/src/errors.ts`). Revisit only against a live draft peer; pick a
  non-colliding code then. Self-contained in `@mokei/http-client`. *Update 2026-07-02:*
  SDK v2 beta can now serve as the live draft peer (see
  `2026-07-02-mcp-sdk-v2-adoption.md`, interop tests item). *Update 2026-07-27:* the peer
  harness is in place (`integration-tests/support/interop/`, SDK `2.0.0-beta.5`), covering
  `2025-11-25` in all four client/server × stdio/HTTP combinations; the `2026-07-28`
  half lands with the B-wiring.

### Non-blocking polish (from final review — optional, not gating)

- Cache collected `x-mcp-header` annotations alongside the schema in `#toolSchemas`
  (`http-client/src/transport.ts`) to skip the per-`tools/call` walk recompute.
- Clarify the `collectHeaderAnnotations` error message for the `$ref`-wrapper-plus-target
  duplicate edge (currently reports "Duplicate", which misattributes the cause).
- Two `useLiteralKeys` Biome *infos* in `http-client/src/x-mcp-header.ts` (`node['…']` →
  `node.…`); lint gate passes (info-level), tidy if touching the file.

## 2. Additive draft wiring (B1–B7, opt-in coexistence)

**Draft finalized; most items shipped for stdio.** U1 resolved + core shipped (PR #32).
Not a hard-cut: mokei keeps `2025-11-25` and adds the finalized `2026-07-28` revision as a
second version selected per context (see the milestone's Architecture decision). The
B-items are additive wiring behind a version selector, not removals. B5, B2, B3 and B6 are
shipped for stdio; B1 (HTTP) and B7 (MRTR) remain, per the per-item notes below.

*Update 2026-07-02:* the draft is now the **`2026-07-28` revision at RC stage** —
finalization expected July 28, 2026, with SDK v2 stable alongside. SDK v2 beta ships wire
codecs for the revision (`wire/rev2026-07-28/`), so B-item shapes can be pinned against a
reference implementation ahead of the freeze. Details in the milestone's status-update
section and `2026-07-02-mcp-sdk-v2-adoption.md`.

Scope, ordered by dependency:

1. ~~**B5** remove `ping`~~ **Delivered (`feat/mcp-2026-07-28-core`), both transports.**
   `ContextRPC` no longer auto-answers `ping`; each protocol record's method table decides, and
   `2026-07-28` has no `ping`.
2. ~~**B2** remove `initialize`/`initialized`; stateless `_meta` (version/identity/caps per
   request); version-mismatch error (SEP-2575)~~ **Delivered, both transports.** `2026-07-28`
   has `requiresHandshake: false`; every request carries protocol version and client
   capabilities in `_meta` instead.
3. ~~**B3** add `server/discover` RPC (MUST) — advertises versions/caps/identity
   (SEP-2575).~~ **Delivered, both transports.** Correction: the spec makes `server/discover`
   mandatory for the *server* to implement, not mandatory for a *client* to call — a client
   may still reach a `2026-07-28` server via the version it already knows. mokei's client
   uses it only to probe under `protocolVersion: 'auto'`.
4. ~~**B1** remove protocol sessions + `Mcp-Session-Id` (SEP-2567)~~ **Delivered
   (`feat/mcp-2026-07-28-core`).** stdio never had a session concept. The HTTP half shipped in
   plan 2: a `2026-07-28` request is handled statelessly — no `Mcp-Session-Id` is minted, `GET`
   and `DELETE` return `405`, and each request gets its own short-lived `ContextServer`. The
   `2025-11-25` session path is untouched. Cross-call state → server-minted handles as tool args
   remains unimplemented, but that is a consumer concern, not transport work.
5. **B6** remove `logging/setLevel` + roots list-changed; per-request `_meta` log level.
   **`logLevel` half delivered, both transports:** `2026-07-28`'s client method table has no
   `logging/setLevel`; log level travels in request `_meta` instead and log emission is
   scoped to the handling request. The roots list-changed half is not done and belongs with
   B7 (roots only exist through MRTR on `2026-07-28`).
6. **B7** MRTR — `inputRequests`/`inputResponses` replace server-initiated requests
   (SEP-2322). Deepest; dismantles bidirectional `request()`/`#sentRequests` in
   `context-rpc`. Depends on U1 + B2. **Not shipped:** plan 1 refuses
   `sampling/createMessage`, `elicitation/create` and `roots/list` at client/server setup on
   `2026-07-28` (`MRTRNotSupportedError`) rather than implementing MRTR itself.
7. **B4** `subscriptions/listen` replaces GET endpoint + `resources/subscribe` (SEP-2575).
   Rewrite HTTP server/client streaming. Depends on U1; parallel with B7.
   **`2025-11-25`-side `resources/subscribe` (folded from the retired `2026-07-02-mcp-feature-gaps.md`,
   gap 3):** the `2025-11-25` protocol types exist (`subscribeRequest` / `unsubscribeRequest` /
   `resourceUpdatedNotification` in `context-protocol/src/resource.ts`) but there are no client
   methods, no server dispatch, and no `resources.subscribe` capability declaration. Since mokei
   keeps `2025-11-25` per the coexistence decision, a `2025-11-25` peer may still expect this surface.
   Implement it as the `2025-11-25` branch of B4 only if a real peer needs it. (The
   `UnsubscribeRequest` alias typo that item flagged is already fixed, `d82dc9c`.)
8. **D1–D3** apply deprecation handling (Roots/Sampling/Logging; HTTP+SSE transport;
   `includeContext`) as the above land.

### B7 stream-arm follow-ons — **done 2026-07-27**

The U1 streaming arm + continuation store are built and unit-tested but have **no wire
trigger yet**; B4/B7 wire into the `_registerStreamExchange` seam they create
(`context-rpc` `exchange.ts` / `continuation.ts`). All five hardening items listed here
shipped ahead of that wiring, so the seam is ready to consume:

- `onSettle` now receives a `SettleReason` (`'result' | 'error' | 'cancel' | 'closed'`), so
  continuation teardown can tell a terminal frame from a local cancel or a transport close.
  `ContextRPC` folds it into the `clearForExchange` reason message.
- Malformed-response policy: `routeResponse` settles an exchange carrying neither a usable
  `result` nor a well-formed `error` as an internal `RPCError('Malformed response')` instead
  of deleting it while leaving the promise pending forever (the old `once`-arm leak). An
  `error` stream frame carrying a non-`Error` value is coerced; a frame of an unknown type is
  dropped **without** settling — only `result` and `error` frames are terminal.
- `isErrorResponse` in `error.ts` replaces the `as ErrorResponse` cast, so an `error: null` or
  a `code`/`message`-less error object is no longer read as an error response.
- Stream `cancel` / `endAll` / error-response / malformed-response `onSettle` paths are
  covered, plus settle-once-only under trailing frames.
- `ExchangeRegistry.#settle(id, exchange, reason, outcome)` dedups the delete +
  resolve/reject + `onSettle` blocks across all four settle sites.

Open when the wiring lands: nothing on the registry itself — the remaining decisions
(continuation state across reconnects, server-minted handles) live in the milestone's open
questions.

## 3. Findings from `feat/mcp-2026-07-28-core` (filed 2026-08-01)

Everything below was verified against source on that branch. Nothing here is speculative.

### 3.1 Correctness defects

#### 3.1.1 The read loop serializes every server — needs its own task

`ContextRPC.#readLoop` (`packages/context-rpc/src/rpc.ts:114`) does
`response = await this._handleMessage(next.value)` inside its `while (true)` loop. A server
therefore does not read the next message until the current handler has resolved:
**every mokei server handles exactly one request at a time, on every transport and every
revision.** The identical line is on `main` at the same position, so this predates the branch —
it is not a regression, it is a long-standing design defect that this branch happened to
measure.

Two consequences, both confirmed:

- **No concurrent tool calls.** Measured twice, independently: a second `tools/call` issued
  100ms behind a tool that sleeps 5s was answered at **5003ms**, one millisecond before the slow
  call itself (5004ms). An earlier measurement on the same branch put it at 5230ms. The
  reproduction is a two-tool stdio server (`slow` sleeping 5s, `quick` returning at once) and one
  client issuing both.
- **`notifications/cancelled` cannot reach an in-flight request** on stdio or the HTTP session
  path. The cancellation is not read until the handler it names has already settled, by which
  point `.finally` has deleted `#receivedRequests[id]`, so the abort is a no-op. The handler
  controllers are aborted only from the `notifications/cancelled` branch
  (`rpc.ts:191-194`), so there is no other path that could fire.

The stateless HTTP path also cannot abort, but for an independent and *documented* reason: it
acknowledges with `202` and deliberately does not dispatch. Do not conflate the two.

Fixing this means not awaiting the handler in the read loop — which requires deciding what
back-pressure replaces the implicit one-at-a-time bound, and what ordering guarantees (if any)
mokei promises between a request and a notification that follows it. That is why this is a task,
not a patch. Two suites currently document the current behavior in prose and would need
updating: `integration-tests/suites/interop-2026-07-28-stdio.test.ts` (the cancellation test's
header) and `integration-tests/support/interop/mokei-stdio-server-cancellation.ts`.

#### 3.1.2 `resultType` is unenforced inbound on `2026-07-28`

Three compounding causes — a complete fix needs **both** halves, since applying the first alone
changes nothing while the permissive branch remains:

1. `withResultType` had zero call sites anywhere and was deleted on this branch
   (`packages/context-protocol/src/versions/2026-07-28.ts`). Reintroducing it is half the fix.
2. The validator chain for an inbound server result runs to the shared `serverResult`
   (`packages/context-protocol/src/server.ts:48-61`), whose **first `anyOf` branch** is the bare
   open object `result` (`packages/context-protocol/src/rpc.ts:214-220`):
   `{ additionalProperties: {}, properties: { _meta: metadata }, type: 'object' }`. It declares
   no `required`, so it admits any object at all and the remaining branches never get a say.
3. `discoverResult` (`versions/2026-07-28.ts`) is the one schema that *does* require
   `resultType`, and it is **not** a member of `serverResult`. It is reached only through a cast
   in `#probeDiscover` — `packages/context-client/src/client.ts:855`,
   `return message.result as DiscoverResult`.

#### 3.1.3 An unsupported `protocolVersion` string silently degrades to auto-detection

`packages/context-client/src/client.ts:411`:
`const protocol = params.protocolVersion === 'auto' ? null : PROTOCOLS[params.protocolVersion]`.
`PROTOCOLS[unknown]` is `undefined`, which is nullish, so the `if (protocol != null)` guard at
`:412` skips the handler check and `#setup()`'s `this.#protocol ?? (await this.#probe())`
(`:750`) treats an invalid pin exactly like `'auto'`. Any caller passing an unvalidated version
string — a config file, a CLI argument that bypassed `parseProtocolOption`, an API consumer —
silently gets probing instead of a failure. `isSupportedProtocolVersion` exists; the constructor
does not use it.

#### 3.1.4 An invalid inbound response strands its caller

`ContextRPC._handleMessage` (`packages/context-rpc/src/rpc.ts:169-178`): when validation fails
and the frame is not a request, it hits `// TODO: call optional error handler` and `return null`.
Nothing rejects the pending exchange. So a malformed error frame delivered over a normal `200`
leaves its caller's promise pending forever — and there is no backstop: `rpc.ts:304` applies a
timeout only when one was passed (`if (options?.timeout != null)`), and nothing at the
`ContextClient` layer defaults one for a normal request. `DEFAULT_INITIALIZE_TIMEOUT`
(`client.ts:434-435`) covers `#setup` only. A second `TODO` sits at `rpc.ts:225`.

#### 3.1.5 `ContextServer#dispose()` does not abort in-flight handler signals

Handler controllers live in `#receivedRequests` and are aborted only from the
`notifications/cancelled` branch (`packages/context-rpc/src/rpc.ts:191-194`). The dispose chain
is `rpc.ts:88` `super({ dispose: () => this.#dispose() })` → `:160` `#dispose()` → `:146`
`#close()` → `:155-158` `#endPendingRequests()`, which touches only `#exchanges.endAll` and
`#continuations.clearAll`. `ContextServer` (`packages/context-server/src/server.ts:131`)
overrides no part of it. So disposing a server leaves every running tool handler running, with
nothing to observe that the connection is gone. Note the interaction with 3.1.1: while the read
loop serializes, at most one handler is ever in flight, so the blast radius is currently one
handler — fixing the read loop widens it.

### 3.2 Test-coverage gaps

#### 3.2.1 The encode-side header logic is structurally untested

mokei's HTTP client encodes `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*`. mokei's HTTP server
validates **none** of them — zero references to any of those header names anywhere under
`packages/http-server/src`. So the encoder has only ever been exercised against a peer that
ignores its output, and **any client-side header-encoding bug is invisible to every
mokei-against-mokei suite by construction**, no matter how many are added.

This is not hypothetical: it already produced one real defect. `Mcp-Name` was omitted for
`resources/read`, and it was found the day an SDK peer was added — not by any of the
mokei-against-mokei coverage that preceded it. `Mcp-Param-*` is the same shape, built by the
same code, and still has unit coverage only. The fix is not more unit tests; it is a peer that
reads the headers (see 3.2.3).

#### 3.2.2 mokei never emits the Base64 sentinel form of `Mcp-Name`

A genuine conformance gap, not an unexercised option. `packages/http-client/src/transport.ts:282`
emits the raw value: `headers['Mcp-Name'] = nameValue`, with no fallback. The sentinel encoder
`encodeHeaderValue` (`packages/http-client/src/x-mcp-header.ts:99-108`, the `=?base64?…?=`
form) exists but is called only from `buildParamHeaders` (`:271`), for `Mcp-Param-*`.

The sentinel exists precisely so a name or URI that cannot survive as a raw HTTP field-value —
non-ASCII, control characters, anything needing folding — can still be sent. A tool, prompt or
resource URI in that class is silently mis-sent today.

#### 3.2.3 Near-term cleanup — point `checkMokeiClient` at the SDK peer for `2026-07-28`

**This is not indefinite backlog; it is the cheapest high-value item on this list.**
`checkMokeiClient` (`integration-tests/support/interop/expectations.ts:34`) has four call sites.
Two already drive a **real SDK server** at `2025-11-25`, over the identical fixture
(`interop-sdk-server.test.ts:38` stdio, `:51` HTTP). The other two
(`interop-2026-07-28-http.test.ts:44`, `interop-2026-07-28-stdio.test.ts:245`) drive mokei's own
server. The SDK `2026-07-28` peer already exists in the harness
(`startSDK20260728HTTPServer`) but is checked by bespoke inline assertions instead of the shared
expectations.

So this is one call-site edit on a pattern already proven twice — and it would have caught the
`Mcp-Name` defect in 3.2.1 with no bespoke test at all. An SDK stdio peer on this revision is
reachable too, via the existing `support/interop/sdk-stdio-server.ts` (verified: `server/discover`
answers `supportedVersions: ['2026-07-28']`, `tools/list` and `tools/call` round-trip), so the
same edit applies on both transports.

#### 3.2.4 Still unexercised against mokei after this branch

- `Mcp-Param-*` entirely (unit coverage only — see 3.2.1).
- Negative `Mcp-Name` cases.
- `subscriptions/listen` (also B4).
- The `MissingRequiredClientCapability` ladders.
- Task-augmented params.
- `server/discover`'s `_meta` contents.

### 3.3 Design and hygiene

#### 3.3.1 `-32020` and `-32021` have constants but no emitter

- `-32020` `HEADER_MISMATCH` — the constant exists, the emitter belongs to `x-mcp-header` retry
  (G7 part 5, §1 above).
- `-32021` `MISSING_REQUIRED_CLIENT_CAPABILITY` — the constant exists and has **no reachable
  emitter**. On `2026-07-28` a server sends no requests at all (`PROTOCOL.serverMethods` is
  empty), so no handler can need an undeclared client capability, and
  `ServerClient.createMessage` / `elicit` / `listRoots` throw `MRTRNotSupportedError` first.
  Revisit with MRTR (B7).

#### 3.3.2 `#resolveProtocol` should mark envelope violations in structured `data`

`packages/http-server/src/stateless.ts:45-52`, `isEnvelopeFailure`, keys on **prose**:

```ts
if (error.code === INVALID_PARAMS) {
  return typeof error.message === 'string' &&
    error.message.startsWith('Missing "io.modelcontextprotocol/')
}
```

The thrower is `#resolveProtocol` in a *different package*
(`packages/context-server/src/server.ts:259`), with two `INVALID_PARAMS` sites today (`:285`
missing `META_PROTOCOL_VERSION`, `:298` missing `META_CLIENT_CAPABILITIES`) plus two
`UNSUPPORTED_PROTOCOL_VERSION` (`:266`, `:289`). A third `INVALID_PARAMS` thrower added later
escapes every existing test unless its author happens to open the message with `Missing "` —
a cross-package coupling through a string prefix, already flagged in a comment at
`packages/context-server/test/envelope-errors.test.ts:13`. Attach structured `data` marking the
failure as an envelope violation and have the HTTP transport key on that field instead.

#### 3.3.3 `2025-11-25`'s `clientMethods` omits `resources/subscribe`/`unsubscribe`

`packages/context-protocol/src/versions/2025-11-25.ts:83-95` lists eleven client methods,
omitting both, although `clientRequest` / `clientMessage` (`:36-37`, `:65-66`) do include
`subscribeRequest` / `unsubscribeRequest`.

**Do not simply widen the table.** `packages/context-server/src/server.ts:354` gates *inbound*
requests on that same set (`if (!protocol.clientMethods.has(request.method))` →
`METHOD_NOT_FOUND`), so widening it changes server behavior too: mokei would start accepting
subscribe/unsubscribe requests it has no dispatch for. Fix this together with the
`2025-11-25` side of B4 (§2 item 7), not on its own.

#### 3.3.4 `@enkaku/transport` is a `devDependency` but imported at runtime

`packages/http-server/package.json` lists it under `devDependencies` only, while
`packages/http-server/src/handler.ts:1` and `packages/http-server/src/stateless.ts:1` both do
`import { Transport } from '@enkaku/transport'` — value imports, used at runtime. A consumer
installing `@mokei/http-server` alone gets it only by hoisting luck. Move it to `dependencies`.

#### 3.3.5 The CLI's `-p` means three different things

`--provider` on `chat` (`packages/cli/src/options.ts:31`), `--port` on `monitor`
(`packages/cli/src/commands/monitor.tsx:21`), `--protocol` on `inspect`
(`packages/cli/src/commands/inspect.tsx:64`) — and `-p` is *also* accepted as `--protocol` inside
the `/context add` slash command, which runs inside `chat`, where top-level `-p` means provider.
No collision, since no two are reachable in the same argv position, but it is inconsistent enough
to mislead. Renaming any of them is a breaking change, so this is a deliberate note rather than a
proposal.

### 3.4 Carried over from the plan's own out-of-scope list

- Extracting a `SetupReader` unit from `packages/context-client/src/client.ts` (~1172 lines, of
  which ~240 are pure declarations that should move first).
- Removing the two derivable `ProtocolDefinition` booleans — `requiresHandshake` and
  `requiresPerRequestLogLevel` (`packages/context-protocol/src/versions/types.ts:32,43`). Drift
  is already guarded by a test (`packages/context-protocol/test/versions.test.ts:124-130`), so
  this is tidying, not a defect.
- The full per-revision `ServerRequest` / `ServerNotification` / `ServerResult` type split.
- **Host-level caching of `'auto'` resolution.** `ContextClient` already caches its resolved
  revision for the transport's lifetime, and each context owns exactly one transport, so the only
  thing a host-level cache would add is reuse *across* contexts sharing a config — which needs a
  registry keyed by structural config identity, invalidated on a signal nobody has specified.
  Speculative work for one saved round trip.
- **The website's `createTool(` rot.** `website/docs/quick-start.mdx` calls it positionally
  (`createTool(description, schema, handler)`) at six sites; the real signature takes a single
  options object (`packages/context-server/src/definitions.ts:88-95`). The same examples also use
  `req.arguments`, where the real handler receives `req.input`. **The page's primary code example
  therefore does not run at all**, which is worse than the "7 sites of rot" framing suggests. The
  seventh site, `website/docs/api/context-server/index.md:500`, is stale typedoc output — the
  source docstring it was generated from is already correct
  (`packages/context-server/src/types.ts:177`), so it fixes itself on the next docs build.
- **The website quick-start's chat walkthrough is obsolete**, found during the same sweep and
  unrelated to protocol revisions: it documents an inquirer-style `? Select an action …` menu
  (`Add a context` / `Send a message` / `Select tools to enable`) and a `mokei chat ollama`
  invocation. The CLI is now an Ink TUI driven by slash commands, and the command is
  `mokei chat --provider ollama`. Rewriting it needs a real PTY run to capture accurate output,
  which is why it was not attempted during a documentation sweep.

## Notes

- Re-read the milestone's "Open questions" (MRTR continuation state, `server/discover` STDIO
  probe semantics, server-minted handles) before starting B4/B7.
- Re-validate every B-item against the final spec before implementing draft payloads.
