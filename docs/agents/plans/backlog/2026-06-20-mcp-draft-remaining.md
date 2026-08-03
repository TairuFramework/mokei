# MCP draft — remaining work

**Status:** backlog
**Origin:** `milestones/2026-06-08-mcp-draft-migration.md`. Consolidates the two prior
backlog files (deferred groundwork + breaking cut) down to live, unshipped work only.
Shipped work is recorded in the completed summaries, not repeated here:
`completed/2026-06-20-mcp-deferred-groundwork.complete.md` (G1–G8),
`completed/2026-08-02-mcp-2026-07-28-stateless-core.complete.md` (B5, B2, B3, B1 and the
`logLevel` half of B6) and `completed/2026-08-03-mcp-2026-07-28-defect-wave.complete.md`
(the §3.1 correctness defects, §3.5.1–3.5.8 and the §3.6 follow-ups).

Section numbers are stable: gaps mean an item shipped, not that it was renumbered.

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
`Mcp-Name` defect in 3.2.1 with no bespoke test at all.

**All four peer directions are reachable**, verified against mokei with zero mokei changes, so
the same approach extends past `checkMokeiClient`:

| Direction | Transport | How |
|---|---|---|
| mokei client → SDK server | stdio | existing `support/interop/sdk-stdio-server.ts` |
| mokei client → SDK server | HTTP | existing `startSDK20260728HTTPServer` |
| SDK client → mokei server | stdio | `new Client(info, { versionNegotiation: { mode: { pin: '2026-07-28' } } })` + `StdioClientTransport` from `@modelcontextprotocol/client/stdio` |
| SDK client → mokei server | HTTP | same `Client` options + `StreamableHTTPClientTransport` |

The SDK-client direction has no harness helper yet; adding one is the counterpart to
`checkSDKClient`-style expectations and would close the matrix the spec originally planned.
Note `serveStdio(factory, { legacy: 'reject' })` if a `2026-07-28`-only SDK stdio server is
wanted (`server/dist/stdio.d.mts:20,61`).

#### 3.2.4 Still unexercised against mokei

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
- **The website quick-start's chat walkthrough is obsolete**, found during a documentation sweep
  and unrelated to protocol revisions: it documents an inquirer-style `? Select an action …` menu
  (`Add a context` / `Send a message` / `Select tools to enable`) and a `mokei chat ollama`
  invocation. The CLI is now an Ink TUI driven by slash commands, and the command is
  `mokei chat --provider ollama`. Rewriting it needs a real PTY run to capture accurate output,
  which is why it was not attempted during that sweep.

### 3.5 Findings from the whole-plan review (filed 2026-08-02)

#### 3.5.6 `CreateHTTPClientParams.protocolVersion` shadows `HTTPTransportParams.protocolVersion`

The last of that section's five transport minors; the other four shipped 2026-08-03.

`CreateHTTPClientParams` intersects `HTTPTransportParams`, and the two spell `protocolVersion`
with different meanings — the revision to speak vs. the header seed. `createHTTPClient` strips
the field before constructing `HTTPTransport`, so the documented header seed is **unreachable**
through that entry point.

**Blocked on a decision:** every correct fix renames or reshapes one of the two public param
types, which is breaking. Left as-is deliberately rather than half-fixed.

## Notes

- Re-read the milestone's "Open questions" (MRTR continuation state, `server/discover` STDIO
  probe semantics, server-minted handles) before starting B4/B7.
- Re-validate every B-item against the final spec before implementing draft payloads.
