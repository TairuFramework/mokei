# MCP `2026-07-28` cleanup deferrals — standing notes

**Status:** backlog (decided-against / notes only)
**Origin:** deferred out of `backlog/2026-06-20-mcp-2026-07-28-deprecations-cleanup.md` (retired
2026-08-28). The two actionable items — the SSE reader-backpressure fix and the per-revision
`ServerRequest`/`ServerNotification` split — shipped 2026-08-28; see
`completed/2026-08-28-mcp-2026-07-28-cleanup-deferrals.complete.md`. What remains below is not
scheduled work: one YAGNI item and two deliberate design notes, kept so the reasoning is not
rediscovered. Section numbers are carried over from the retired file's own numbering so
cross-references in older docs still resolve by eye.

## 3. Host-level caching of `'auto'` resolution (from §3.4, speculative/YAGNI)

`ContextClient` already caches its resolved revision for the transport's lifetime, and each
context owns exactly one transport, so a host-level cache would only add reuse *across* contexts
sharing a config — which needs a registry keyed by structural config identity, invalidated on a
signal nobody has specified. Speculative work for one saved round trip. Not planned.

## 4. Deferred design notes (from §3, not scheduled)

- **`-32020` `HEADER_MISMATCH` has no emitter.** As of 2026-08-07 the constant has a reachable
  *consumer* — the HTTP client's stale-schema retry recognises a peer's `-32020` (see the shipped
  header story). It still has no emitter and will not get one from this work: mokei's HTTP server
  does not read `Mcp-Param-*`, `Mcp-Method` or `Mcp-Name` at all, so nothing in mokei is in a
  position to reject a request for a header/body disagreement. An emitter needs server-side header
  validation, which is not scheduled.
- **The CLI's `-p` means three different things.** `--provider` on `chat`
  (`packages/cli/src/options.ts`), `--port` on `monitor`
  (`packages/cli/src/commands/monitor.tsx`), `--protocol` on `inspect`
  (`packages/cli/src/commands/inspect.tsx`) — and `-p` is *also* accepted as `--protocol` inside
  the `/context add` slash command, which runs inside `chat`, where top-level `-p` means provider.
  No collision, since no two are reachable in the same argv position, but it is inconsistent enough
  to mislead. Renaming any of them is breaking, so this is a deliberate note rather than a
  proposal.
