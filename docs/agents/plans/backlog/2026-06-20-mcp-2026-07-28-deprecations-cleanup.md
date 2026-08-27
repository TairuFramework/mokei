# MCP `2026-07-28` — deprecation handling + cleanup (D1–D3)

**Status:** backlog
**Size:** Medium
**Origin:** `milestones/2026-06-08-mcp-2026-07-28-migration.md`, piece F of the former
`2026-06-20-mcp-draft-remaining.md` (split out 2026-08-27). The subscriptions work (piece E) is
in `next/2026-08-27-mcp-2026-07-28-subscriptions.md`; pieces A–D shipped.

Section numbers below are the stable numbering from the original migration plan.

## 1. D1–D3 deprecation handling (§2 item 8)

Apply deprecation handling as the surrounding `2026-07-28` items land:

- **D1** Roots / Sampling / Logging.
- **D2** HTTP + SSE transport.
- **D3** `includeContext`.

## 2. §3.4 tidy-ups

Carried from the migration plan's own out-of-scope list. All hygiene, no defects.

- **A refresh-specific timeout in `HTTPTransport`.** Since the stale-schema retry shipped
  (2026-08-07), a firing retry can hold the transport's serial outgoing sink for three round trips
  — the original POST, the `tools/list` refresh, and the re-send — each bounded by its own full
  `#timeout` budget rather than sharing one, so ~90s at the default. A tighter budget for the
  refresh alone would bound the worst case without shortening the calls the caller actually made.
  See `completed/2026-08-07-mcp-header-story-bc.complete.md`.
- **Extract a `SetupReader` unit** from `packages/context-client/src/client.ts` (~1172 lines, of
  which ~240 are pure declarations that should move first).
- **Remove the two derivable `ProtocolDefinition` booleans** — `requiresHandshake` and
  `requiresPerRequestLogLevel` (`packages/context-protocol/src/versions/types.ts:32,43`). Drift is
  already guarded by a test (`packages/context-protocol/test/versions.test.ts:124-130`), so this is
  tidying, not a defect.
- **Full per-revision `ServerRequest` / `ServerNotification` type split.** The result side was
  split by the defect wave; requests and notifications still share the cross-revision unions.
- **Host-level caching of `'auto'` resolution.** `ContextClient` already caches its resolved
  revision for the transport's lifetime, and each context owns exactly one transport, so a
  host-level cache would only add reuse *across* contexts sharing a config — which needs a registry
  keyed by structural config identity, invalidated on a signal nobody has specified. Speculative
  work for one saved round trip.

## 3. Deferred design notes (not scheduled)

- **`-32020` `HEADER_MISMATCH` has no emitter.** As of 2026-08-07 the constant has a reachable
  *consumer* — the HTTP client's stale-schema retry recognises a peer's `-32020` (see the shipped
  header story). It still has no emitter and will not get one from this work: mokei's HTTP server
  does not read `Mcp-Param-*`, `Mcp-Method` or `Mcp-Name` at all, so nothing in mokei is in a
  position to reject a request for a header/body disagreement. An emitter needs server-side header
  validation, which is not scheduled.
- **The CLI's `-p` means three different things.** `--provider` on `chat`
  (`packages/cli/src/options.ts:31`), `--port` on `monitor`
  (`packages/cli/src/commands/monitor.tsx:21`), `--protocol` on `inspect`
  (`packages/cli/src/commands/inspect.tsx:64`) — and `-p` is *also* accepted as `--protocol` inside
  the `/context add` slash command, which runs inside `chat`, where top-level `-p` means provider.
  No collision, since no two are reachable in the same argv position, but it is inconsistent enough
  to mislead. Renaming any of them is breaking, so this is a deliberate note rather than a proposal.
