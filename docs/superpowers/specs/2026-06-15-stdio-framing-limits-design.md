# Stdio framing limits — design

**Date:** 2026-06-15
**Status:** approved, ready for implementation plan
**Branch:** `fix/stdio-framing`
**Supersedes planning note:** `docs/agents/plans/next/2026-06-12-stdio-framing-limits.md`
(hang/crash-core audit, deferred item 6)

## Goal

Bound a child MCP server's stdout framing so a misbehaving server can't exhaust
host memory or hang the transport forever. Thread `@enkaku/stream` framing
options into the host's `NodeStreamsTransport`, and reap any context whose stdout
stream faults instead of letting later frames silently vanish.

## Background

`packages/host/src/host.ts:111` builds the per-context transport with
`new NodeStreamsTransport({ streams })` — no framing limits. Under the hood that
hits `fromJSONLines()` with defaults. Two failure modes:

- Child prints non-JSON / huge lines to stdout → framer buffer grows unbounded.
- One stray unbalanced `{` / `[` leaves the parser mid-message → every later
  frame is swallowed and all subsequent calls hang silently.

The fix needed an upstream enkaku API to pass framing limits through
`NodeStreamsTransportParams`. Released in **`@enkaku/*` 0.17.0**.

### Upstream API (0.17.0) — flat, not nested

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
  signal?: AbortSignal
}
```

- `maxBufferSize` bounds total live framer memory (un-terminated input buffer +
  partially-accumulated message); exceeding it **errors the stream**.
- `maxMessageSize` is an optional tighter per-message cap.
- `onInvalidJSON(value, controller)` fires per un-parseable line instead of the
  default skip/throw.

### Teardown seam

The base `Transport` (`@enkaku/transport`) exposes
`events: EventEmitter<TransportEvents>` with a `readFailed: { error }` event.
A buffer/message-size overflow errors the stream, which surfaces as `readFailed`.
This is the single seam every fatal framing fault flows through.

## Decisions

| Decision | Choice |
|----------|--------|
| Invalid-JSON policy | **Strict** — any unparseable stdout line is fatal: error the stream → reap the context, surfaced via `context:failed`. A server that can't speak clean JSONL is broken. |
| Default limits | `maxBufferSize` **8 MiB**; `maxMessageSize` **undefined** (= buffer cap). One knob, generous headroom for large tool results. |
| Override surface | Optional `maxBufferSize` / `maxMessageSize` on `SpawnHostedContextParams` and `AddLocalContextParams`; defaults applied when omitted. |
| Teardown wiring | **Single path** via `readFailed`. `onInvalidJSON` only calls `controller.error(...)` to turn a bad line into a stream error; buffer-overflow already errors the stream. Both → `readFailed` → one reap handler. |

## Design

### 1. Catalog bump (`pnpm-workspace.yaml`)

Every `@enkaku/*` entry → `^0.17.0` (including the patch-pinned `otel`, `schema`,
`socket-transport`). `pnpm install` → `pnpm build` → `pnpm test` to flush any
0.16→0.17 breakage **before** touching framing. Separate commit.

### 2. Framing params threaded through spawn (`packages/host/src/host.ts`)

`SpawnContextServerParams` (`spawn.ts`) is unchanged — spawn doesn't touch the
framer. Extend `SpawnHostedContextParams`:

```ts
type SpawnHostedContextParams = SpawnContextServerParams & {
  onExit?: (error: Error | null) => void
  onStreamError?: (error: Error) => void   // fatal framing / read failure
  maxBufferSize?: number                    // default 8 MiB
  maxMessageSize?: number                   // default undefined (= buffer cap)
}
```

`spawnHostedContext` builds the transport flat and forces unparseable lines into
stream errors:

```ts
const MAX_BUFFER_SIZE = 8 * 1024 * 1024

const transport = new NodeStreamsTransport({
  streams,
  maxBufferSize: maxBufferSize ?? MAX_BUFFER_SIZE,
  maxMessageSize,                           // pass-through, undefined ok
  onInvalidJSON: (value, controller) => {
    controller.error(new Error(`Invalid JSON on context stdout: ${truncate(value)}`))
  },
}) as ClientTransport

transport.events.on('readFailed', ({ error }) => {
  childProcess.kill()       // spawnHostedContext owns childProcess — guarantees no orphan
  onStreamError?.(error)    // sync: lets host set its dedup flag before async onExit fires
})
```

`truncate(value)` caps the echoed bad line (e.g. first 200 chars) so the error
message itself can't be huge.

### 3. Host reap + dedup (`ContextHost.addLocalContext`)

`AddLocalContextParams` gains optional `maxBufferSize?` / `maxMessageSize?`,
passed straight through. `addLocalContext` wires `onStreamError` alongside the
existing `onExit`, with a flag so `context:failed` emits exactly once:

```ts
let framingError: Error | null = null
const context = await spawnHostedContext<T>({
  ...spawnParams,
  maxBufferSize,
  maxMessageSize,
  onStreamError: (error) => {
    framingError = error
    void this._events.emit('context:failed', { key, error }).catch(() => {})
    void this.remove(key).catch(() => {})        // disposes transport, kills child
  },
  onExit: (error) => {
    if (framingError != null) return             // stream error already handled it
    if (error != null && !isSubprocessExit(error)) {
      void this._events.emit('context:failed', { key, error }).catch(() => {})
    }
    void this.remove(key).catch(() => {})
  },
})
```

**Flow:** framing fault → `readFailed` → `spawnHostedContext` kills child +
calls `onStreamError` (sets `framingError` **synchronously**) → `context:failed`
emitted with the real framing error + reap. The kill rejects the subprocess
promise → `onExit` fires async, sees `framingError` set, skips — no double event.
`remove()` is already idempotent (delete-before-dispose, from the prior hardening
commit `57d104b`).

Logging stays with consumers (CLI / monitor) off `context:failed` — `ContextHost`
has no logger dependency, consistent with today.

### 4. Tests (`packages/host/test/`)

In-process pattern. Rebuild deps first — cross-package tests resolve `@mokei/*`
to built `lib/`. Child fixtures are small scripts spawned as real subprocesses;
override `maxBufferSize` small (e.g. 64 KiB) so flood tests don't pump 8 MiB.

| Test | Child behavior | Assert |
|------|---------------|--------|
| flood | writes stdout past `maxBufferSize` (low override) | `context:failed` fires, context removed, no hang, no unhandled rejection |
| stray line | emits one non-JSON line then exits | `onInvalidJSON` → `readFailed` → `context:failed` + reap |
| happy path | normal JSONL, large-ish valid result under cap | tools work, no spurious failure |
| dedup | trigger framing error | `context:failed` emitted exactly once (not also from `onExit`) |

## Out of scope

- HTTP contexts (`addHTTPContext`) — `HTTPTransport`, not `NodeStreamsTransport`;
  no stdout framer.
- `addDirectContext` — in-process `DirectTransports`, no stdout.
- Design-doc sync: the planning note's step 5 ("update hang-crash-core-design §6
  to the flat API") is dropped — that design doc has been archived and no longer
  exists. This spec is the flat-API record.

## Sequencing

1. Catalog bump `^0.16.x → ^0.17.0` + lockfile (build + test green).
2. Framing wiring (spawn + host) + types.
3. Tests.
4. Archive the planning note `next/2026-06-12-stdio-framing-limits.md`.

## Pointers

- `packages/host/src/host.ts:100` `spawnHostedContext`, `:339` `addLocalContext`.
- `packages/host/src/spawn.ts` `SpawnContextServerParams`, `spawnContextServer`.
- Memory: `enkaku-upstream-asks-local`, `workspace-tests-resolve-built-lib`,
  `cli-dev-runs-from-dist`.
