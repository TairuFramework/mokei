# Upstream issue: `@enkaku/socket-transport` leaks the socket handle on dispose

**Date:** 2026-06-05
**Affects:** `@enkaku/socket-transport@0.16.0`; **partially** fixed in `0.16.1` (see
"Update" below — the idle-connection case is still broken), in concert with
`@enkaku/transport@0.16.0`.
**Repo to fix:** enkaku (this is a dependency of mokei, not in this workspace)
**Severity:** Medium — forces consumers to `process.exit()` to terminate.

## Update (2026-06-05): 0.16.1 fix is incomplete

`0.16.1` added `socket.unref()` to the writable-close callback in
`createTransportStream`. Verified that this does **not** fix the mokei `chat` quit
hang, because that path never materializes the transport stream:

- `mokei chat` connects to the daemon eagerly (`ProxyHost.forDaemon()` →
  `createClient()` → `connectSocket()`), but if the user never adds a context, **no
  request is ever sent over the daemon socket**, so the lazily-created transport
  stream (`Transport._stream`) is never built.
- `Transport.dispose()` only runs the writable-close path when `this._stream != null`
  (see trace below). With an idle connection it's `null`, so `writer.close()` — and
  therefore the new `socket.unref()` — never runs.
- The connected socket is left ref'd. Diagnostic after a fully-resolved
  `session.dispose()`:
  ```
  __DBG WriteStream handle=TTY connecting=false
  __DBG WriteStream handle=TTY connecting=false
  __DBG Socket handle=Pipe connecting=false   <-- daemon Unix socket, still ref'd
  __DBG manually unref-ed the Socket
  → process then exits cleanly (exitCode 0)
  ```
  `handle=Pipe` confirms it's the Unix-domain daemon socket; manually `unref()`-ing it
  releases the loop. So the socket is simply never unref'd/destroyed on dispose when
  the stream was never used.

**Required: release the socket on dispose regardless of whether the stream was ever
materialized** — not only via the writable-close callback. See "Proposed fix
(revised)" below.

## Summary

Disposing a `SocketTransport` (or the `@enkaku/client` `Client` built on top of it)
does **not** release the underlying `net.Socket`. After `dispose()` resolves, the
socket remains an **active, ref'd libuv handle**, so the Node event loop never drains
and the process hangs until something force-exits it.

This surfaced in the mokei CLI: `mokei chat` / `mokei monitor` connect to the host
daemon via `runDaemon()` → `createClient()` → `connectSocket()`. When the user quits
the Ink UI, the command awaits `session.dispose()` (which disposes the `ProxyHost`
→ `HostClient.dispose()` → transport dispose) and then returns — but the process keeps
running because the daemon socket is still open. The mokei CLI currently works around
this with an explicit `process.exit()` (see "Downstream cleanup" below); the real fix
belongs here.

## Evidence

Instrumenting the mokei `chat` command immediately after `await session.dispose()`:

```
__DBG AFTER_DISPOSE
__DBG HANDLES WriteStream,WriteStream,Socket
```

`process._getActiveHandles()` still lists a `Socket` after dispose fully resolved.
The two `WriteStream`s are stdout/stderr (harmless); the lingering `Socket` is the
daemon connection and is what keeps the loop alive.

## Root-cause trace

1. `@enkaku/transport` — `Transport.dispose()` (`lib/index.js`): on dispose it closes
   the writable stream:
   ```js
   dispose: async (reason) => {
     await this.#events.emit('disposing', { reason })
     if (this._stream != null) {
       const writer = await this._getWriter()
       try { await writer.close() } catch {}
     }
     await this.#events.emit('disposed', { reason })
   }
   ```
   So dispose ultimately invokes the writable stream's **close** callback. It does
   nothing else to the socket.

2. `@enkaku/socket-transport` — `createTransportStream()` (`lib/index.js`) wires that
   close callback to a graceful half-close only:
   ```js
   const readable = new ReadableStream({
     start(controller) {
       socket.on('data', (buffer) => controller.enqueue(buffer.toString()))
       socket.on('close', () => controller.close())
       socket.on('error', (err) => controller.error(err))
     }
   }).pipeThrough(fromJSONLines(options))

   const writable = writeTo(
     (msg) => { socket.write(`${JSON.stringify(msg)}\n`) },
     () => { socket.end() },          // <-- only socket.end() on close
   )
   ```
   `socket.end()` sends a FIN (half-close) and flushes pending writes, but it does
   **not** destroy or unref the socket. The handle stays alive until the *remote peer*
   also closes the connection. The mokei daemon keeps its side open (it's a long-lived,
   shared daemon serving multiple clients), so the client's socket never reaches the
   `'close'` event and the handle is never released. Net result: the event loop stays
   alive after dispose.

## Proposed fix (revised — covers the idle-connection case)

The `socket.unref()` added to the writable-close callback in `0.16.1` is correct but
insufficient: it only runs when the transport stream was materialized. The socket must
be released on **transport dispose**, whether or not the stream was ever created.

`SocketTransport` extends `Transport` (a `Disposer`) and is constructed with the
`socket` (or a `connectSocket` source). It should track the resolved socket and release
it on dispose:

```js
export class SocketTransport extends Transport {
  constructor(params) {
    const { socket, signal, ...options } = params
    const source = typeof socket === 'string' ? connectSocket(socket) : socket
    super({
      stream: () => createTransportStream(source, options),
      signal,
    })
    // Release the socket when the transport disposes, even if the stream was
    // never created (an idle connection still holds a ref'd handle).
    this.events.once('disposed', () => {
      Promise.resolve(source).then((sock) => {
        sock.unref()        // or sock.destroy() for a hard close
      }, () => {})
    })
  }
}
```

(Keep the existing `socket.end()` + `socket.unref()` in `createTransportStream` for the
stream-was-used path — flushing on close is still correct. The `disposed`-event hook
above covers the stream-never-used path.)

`socket.unref()` is the gentlest fix: any pending writes are still flushed by `end()`
on the used path, no data is dropped, and the handle stops *holding the event loop
open*. `socket.destroy()` is the hard-close alternative if a deterministic close of the
readable side is also wanted.

### Original minimal change (0.16.1, keep it)

```js
const writable = writeTo(
  (msg) => { socket.write(`${JSON.stringify(msg)}\n`) },
  () => {
    socket.end()
    socket.unref()
  },
)
```

### Alternative: hard close

```js
() => {
  socket.end()
  socket.destroy()
}
```

`socket.destroy()` forces an immediate close, which also makes the readable side's
`socket.on('close', …)` fire deterministically (cleaning up the `ReadableStream`).
This is more thorough but more abrupt; prefer it only if `unref()` proves insufficient
(e.g. the readable stream is observed to stay open).

### Note on the abort `signal`

`SocketTransport` already accepts a `signal` and forwards it to the base `Transport`,
but `createTransportStream` does not receive it and does nothing socket-level on abort.
If a future change wants dispose-by-signal to also tear the socket down, thread the
`signal` into `createTransportStream` and `socket.destroy()` on `'abort'`. Not required
for this fix — closing the writable already runs the close callback above.

## Verification

After patching, a consumer that connects and disposes should exit on its own:

```js
import { createConnection } from 'node:net'
// build a SocketTransport / Client against a live socket, do one round-trip,
// then await client.dispose()
await client.dispose()
// process should now exit naturally; assert process._getActiveHandles()
// contains no Socket, or simply that a spawned process terminates without a kill.
```

In mokei specifically, the regression test
`integration-tests/suites/cli-chat.test.ts` › *"two Ctrl+C quits and the process
exits cleanly"* drives the real binary over a PTY and asserts a clean exit. Once the
enkaku fix lands and is consumed, that test should still pass **with the downstream
`process.exit()` removed**.

## Downstream cleanup (mokei, after the enkaku fix ships)

The mokei CLI added explicit exits as a band-aid; remove them once disposing the
session truly releases the socket:

- `packages/cli/src/commands/chat.tsx` — drop `process.exit(process.exitCode ?? 0)`
  after `await lifecycle.dispose?.()`.
- `packages/cli/src/commands/monitor.tsx` — drop `process.exit(process.exitCode ?? 0)`
  after `await monitor.disposer.dispose()`.

Keep the PTY regression test; it will validate the upstream fix end-to-end.
