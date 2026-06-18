# HTTP transport resilience

**Status:** backlog
**Origin:** 2026-06-12 full audit (security, stability, usability, MCP-spec).

## Gap

The Streamable HTTP client treats one failed request as fatal to the whole transport,
serializes all outgoing traffic behind in-flight SSE responses (deadlocking
cancellation), and never reconnects the server-notification stream. The server leaks
bridges on session expiry and buffers unbounded request bodies.

## Scope

### http-client (`packages/http-client/src/transport.ts`)

1. **One failed POST kills the transport** — lines 59-61, 142-189: the writable side is
   a standard `WritableStream`; a single rejected sink write (HTTP error line 161, or
   the 30s abort line 143) errors the stream permanently — every later `request()`
   rejects, no recovery. Catch per-message errors in the sink so they reject only the
   originating request.
2. **SSE awaited in the sink serializes everything** — line 172: `#handleSSEResponse`
   is awaited inside `#sendMessage`, so while one request's SSE response streams, all
   other outgoing messages queue behind it — including the `notifications/cancelled`
   that should cancel it. The 30s timeout also aborts legitimately long streamed tool
   calls. Spawn SSE consumption (don't await in the sink); clear the timeout once
   headers arrive.
3. **GET SSE stream dies silently** — lines 294-297: server-notification stream is
   fire-and-forget with an empty catch; any network blip permanently and silently stops
   server notifications. Add reconnect with backoff using `#retryMs`.
4. **Dispose DELETE can hang shutdown** — lines 330-343: session-termination fetch has
   no signal/timeout. Add `AbortSignal.timeout`.

### http-server (`packages/http-server/src`)

5. **Bridges leak on session expiry** — `handler.ts:103` + `session.ts:87-94`:
   `SessionManager.#cleanup` deletes idle sessions on its timer, but the handler's
   `bridges` map is only pruned in `handleDELETE`/`dispose` — every timed-out session
   leaks its `TransportBridge` (controller + transport) on a long-running server. Give
   `SessionManager` an `onDelete` callback that closes and removes the bridge.
6. **Unbounded body parsing (DoS)** — `handler.ts:184`: `await request.json()` fully
   buffers and parses with no size limit before any session/auth checks. Enforce a max
   body size (413 on oversized); consider concurrent-POST-stream caps per session.

## Notes

- Spec-conformance items in the same files (negotiated-version header, 404 re-init,
  Origin default, SEP-1699 replay) already shipped — see
  `completed/2026-06-18-mcp-2025-11-25-conformance.complete.md`. Build the retry
  policy on top of the typed `SessionExpiredError` signal that work introduced.
- Verified solid: initialize waiter (30s timeout + cleanup), SSE ring buffer bounds,
  `unref`'d session-manager interval, write-after-close guards, x-mcp-header
  CRLF-safety.
