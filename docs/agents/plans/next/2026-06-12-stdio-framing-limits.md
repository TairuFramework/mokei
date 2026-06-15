# Stdio framing limits (enkaku 0.17 + hang/crash item 6)

**Status:** ready — upstream blocker resolved. Split out of the
2026-06-12 hang/crash-core cluster (item 6, the one deferred task) so it isn't
lost when that cluster is archived.

**Goal:** Bound child-MCP-server stdout framing so a misbehaving server can't
exhaust host memory or hang the transport forever, by threading
`@enkaku/stream` framing options into the host's `NodeStreamsTransport`.

## Why it was deferred

`packages/host/src/host.ts:111` builds the per-context transport with
`new NodeStreamsTransport({ streams })` — no framing limits. Under the hood
that hits `fromJSONLines()` with defaults. Failure modes (from the audit):

- Child prints non-JSON / huge lines to stdout → framer buffer grows unbounded.
- One stray unbalanced `{`/`[` leaves the parser mid-message → every later
  frame is swallowed and all subsequent calls hang silently.

The fix needed an enkaku API to pass `maxBufferSize` / `maxMessageSize` /
`onInvalidJSON` through `NodeStreamsTransportParams`. That ask was filed
upstream (house convention: ask doc in the `../enkaku` checkout, not GitHub —
see memory `enkaku-upstream-asks-local`). It is now **released in 0.17.0**.

## Upstream shape — IMPORTANT correction to the design doc

`docs/superpowers/specs/2026-06-12-hang-crash-core-design.md` §6 assumed a
**nested** `streamOptions?: FromJSONLinesOptions`. The shipped 0.17.0 API is
**flat** — framing options are spread directly onto the params:

```ts
// @enkaku/stream 0.17.0
type FramingLimits = { maxBufferSize?: number; maxMessageSize?: number }
type FromJSONLinesOptions<T = unknown> = FramingLimits & {
  decode?: DecodeJSON<unknown>
  onInvalidJSON?: (value: string, controller: TransformStreamDefaultController<T>) => void
}

// @enkaku/node-streams-transport 0.17.0
type NodeStreamsTransportParams<R = unknown> = FromJSONLinesOptions<R> & {
  streams: StreamsSource
  // ...
}
```

- `maxBufferSize` bounds total live framer memory (un-terminated input buffer +
  partially-accumulated message); exceeding it **errors the stream**.
- `maxMessageSize` is an optional tighter per-message cap.
- `onInvalidJSON(value, controller)` fires per un-parseable line instead of the
  default (skip/throw) behavior.

## Next steps

1. **Bump catalog** `pnpm-workspace.yaml`: every `@enkaku/*` entry `^0.16.x` →
   `^0.17.0` (currently: most `^0.16.0`, `otel ^0.16.1`, `schema ^0.16.1`,
   `socket-transport ^0.16.2` — check 0.17 line for each). `pnpm install`,
   then `pnpm build` + `pnpm test` to catch any 0.16→0.17 breakage across
   packages before touching framing.
2. **Wire framing in `spawnHostedContext`** (`packages/host/src/host.ts:111`):
   pass `maxBufferSize`, `maxMessageSize`, `onInvalidJSON` **flat** into
   `new NodeStreamsTransport({ streams, maxBufferSize, maxMessageSize, onInvalidJSON })`.
   Pick conservative defaults (proposal: `maxBufferSize` a few MB,
   `maxMessageSize` ≤ that) and make them overridable via
   `SpawnHostedContextParams`.
3. **Decide `onInvalidJSON` policy:** stray non-JSON stdout line should not
   silently vanish. Tie it into the host lifecycle work already on this branch —
   surface via the `context:failed` event / log, and consider tearing the
   context down (it's already wired to reap on abnormal exit). At minimum: log.
4. **Tests** (`packages/host/test/`, in-process pattern): child that floods
   stdout past `maxBufferSize` → stream errors, context reaped, no hang, no
   unhandled rejection; child emitting a stray non-JSON line → `onInvalidJSON`
   path exercised; well-behaved child still works. Remember cross-package tests
   resolve `@mokei/*` to built `lib/` — rebuild deps first
   (memory `workspace-tests-resolve-built-lib`).
5. **Update design §6** to match the flat API once implemented.

## Pointers

- Audit cluster item 6: `next/2026-06-12-hang-crash-core.md` §6 (mostly done; this is the leftover).
- Design: `docs/superpowers/specs/2026-06-12-hang-crash-core-design.md` §6 (note flat-API correction above).
- Implemented cluster plan: `docs/superpowers/plans/2026-06-12-hang-crash-core.md` (items 1–5, 7–9 shipped on `plans/2026-06-12-audit-clusters`).
- Memory: `enkaku-upstream-asks-local`, `workspace-tests-resolve-built-lib`.
