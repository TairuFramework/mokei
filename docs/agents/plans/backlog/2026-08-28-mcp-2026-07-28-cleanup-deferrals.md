# MCP `2026-07-28` cleanup deferrals

**Status:** backlog
**Size:** Small
**Origin:** deferred out of `backlog/2026-06-20-mcp-2026-07-28-deprecations-cleanup.md` (retired
2026-08-28), which that cycle completed in full except for the five items below. The cycle
shipped: A (D1–D3 deprecation docs, SEP-2577), B1 (the `HTTPTransport` refresh-specific timeout),
B2 (the derivable `ProtocolDefinition` booleans replaced by helpers), B3 in full — both the
declarations extraction (Stage 1) and the `SetupReader` extraction (Stage 2) out of
`packages/context-client/src/client.ts` — and C (the `#disposing` inbound-request gate). None of
that is repeated here; see `milestones/2026-06-08-mcp-2026-07-28-migration.md` for the shipped
record.

Section numbers below are carried over from the retired file's own numbering, so cross-references
in older docs still resolve by eye.

## 1. SSE reader-backpressure fix (from §4)

`createSSEStream` (`packages/http-server/src/sse-stream.ts`) enqueues into the response
`ReadableStream` synchronously without consulting `desiredSize` / awaiting `pull()`, so
`SSEWriter.writeEvent()` resolves as soon as data enters the internal queue. A genuinely slow
*network reader* therefore grows that queue unbounded rather than applying backpressure upstream —
and for subscriptions it means `SubscriptionWriter`'s 256-frame bound only trips on a fast
*producer* burst, not a slow reader. This is shared SSE infrastructure (session GET streams, post
streams, stateless exchanges, and subscriptions all use it), so a fix — a backpressure-aware
writable (await reader demand) or a bounded `TransformStream` — must be validated across every
consumer for head-of-line-blocking/hang regressions that fast-reader tests will not surface.
Surfaced by the independent Codex review of the subscriptions implementation (2026-08-27).

## 2. Full per-revision `ServerRequest` / `ServerNotification` type split (from §3.4)

The result side was split by the defect wave; requests and notifications still share the
cross-revision unions.

## 3. Host-level caching of `'auto'` resolution (from §3.4, speculative/YAGNI)

`ContextClient` already caches its resolved revision for the transport's lifetime, and each
context owns exactly one transport, so a host-level cache would only add reuse *across* contexts
sharing a config — which needs a registry keyed by structural config identity, invalidated on a
signal nobody has specified. Speculative work for one saved round trip.

## 4. Deferred design notes (from §3, not scheduled)

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
  to mislead. Renaming any of them is breaking, so this is a deliberate note rather than a
  proposal.
