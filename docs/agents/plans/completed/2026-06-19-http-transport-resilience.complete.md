# HTTP transport resilience

**Status:** complete
**Origin:** 2026-06-12 full audit (security, stability, usability, MCP-spec).

## Gap

The Streamable HTTP client treated one failed request as fatal to the whole transport,
serialized all outgoing traffic behind in-flight SSE responses (deadlocking
cancellation), and never reconnected the server-notification stream. The server leaked
bridges on session expiry and buffered unbounded request bodies.

## Shipped — 2026-06-19 (`fix/http-transport-resilience`)

All 6 audit items landed.

### http-client (`packages/http-client/src/transport.ts`)

1. **One failed POST no longer kills the transport.** The writable side caches a single
   writer, so a rejected sink permanently errors the stream — every later `request()`
   would then reject with the stale error. Root cause confirmed against enkaku
   `Transport.write` (caches `_getWriter()`) + the RPC layer, which already isolates
   per-request rejection (`context-rpc/rpc.ts:279`). Fix: `#sendMessage` **never throws**;
   per-message failures are routed to the read side as a correlated JSON-RPC error frame
   (`#failRequest`), so the RPC read loop rejects exactly the originating request and the
   transport stays usable. Failed notifications (no id) are logged and dropped.
2. **SSE no longer serializes outgoing traffic.** `#handleSSEResponse` is consumed in the
   background (not awaited in the sink), so a streamed tool call can't block the
   `notifications/cancelled` meant to stop it. The connect timeout is cleared once response
   headers arrive, so a long legitimate stream isn't aborted at 30s; `#pendingMethods`
   cleanup moved to stream completion.
3. **GET notification stream reconnects.** `#runGETStream` reconnects with capped
   exponential backoff (base = server `retry` else 1s, cap 30s, infinite attempts),
   resuming from `Last-Event-ID` each attempt. Stops on dispose/abort, or a server signal
   that the stream is unsupported (405) or the session is gone (404).
4. **Dispose DELETE is bounded.** The session-termination fetch carries
   `AbortSignal.timeout(5s)` so a hung server can't stall shutdown.

### http-server (`packages/http-server/src`)

5. **Bridges no longer leak on session expiry.** `SessionManager` gained an `onDelete`
   callback fired from `delete()` (covers the idle-cleanup timer, explicit DELETE, dispose,
   and init failure). The handler wires it to an idempotent `closeBridge` that releases the
   `TransportBridge` controller and any pending init waiter. Handler DELETE/init-failure
   paths now delegate bridge teardown to `sessions.delete` instead of pruning `bridges`
   manually.
6. **Request bodies are size-bounded (DoS).** `handlePOST` reads the body via
   `readBodyText(request, maxBodyBytes)` — Content-Length fast-reject plus streamed
   byte-counting — and responds **413** before buffering/parsing an unbounded payload.
   `maxBodyBytes` defaults to 4 MiB (`DEFAULT_MAX_BODY_BYTES`), configurable per handler.

## Key design decisions

- **The sink must never reject (item 1).** Given enkaku's single cached writer, a sink
  throw both rejects the current write AND poisons the stream for all future writes —
  inseparable. The only way to surface a per-request failure without killing the stream is
  the read-side error-frame channel. Consequence — an intentional **contract change**:
  `transport.write()` no longer rejects on HTTP/transport error; failures arrive as
  correlated JSON-RPC error responses on `read()`.
- **Session-expiry is now a *coded* error, not a typed instance.** The error-frame channel
  forces `RPCError` (rpc.ts:185 hardcodes `RPCError.fromResponse`), so the thrown
  `SessionExpiredError` instance can't survive end-to-end. Session-expiry travels as
  `SESSION_EXPIRED_CODE` (-32001); consumers detect it via the exported
  `isSessionExpiredCode(err.code)`. `SessionExpiredError` is retained (now carries `.code`)
  and a future retry policy builds on the coded signal. (Note: the old throw never actually
  reached an RPC consumer as a typed signal — it just killed the stream — so this is a net
  improvement.)
- **Connect timeout vs. stream timeout.** The request timeout now guards time-to-headers
  only; once a response begins streaming, the request-level timeout (`request({timeout})`)
  applies, so long tool-call streams aren't truncated.
- **Reconnect stops on 405/404.** 405 = server offers no GET notification stream; 404 =
  session gone. Retrying neither helps, so the loop exits quietly instead of hammering.

## Tests

New/updated coverage:
- http-client (`transport.test.ts`, 54 total): HTTP-error → error frame + transport stays
  usable; network failure → correlated frame; 404-without-session → HTTP 404 frame;
  404-with-session → session-expired coded frame + cleared session id; SSE-streaming does
  not block subsequent sends; connect-timeout → timeout error frame; GET reconnect resumes
  from `Last-Event-ID`; GET 405 → no reconnect; dispose DELETE carries an abort signal.
- http-server (`session.test.ts` + `handler.test.ts`, 44 total): `onDelete` on explicit
  delete (idempotent), on idle-cleanup timer, and on dispose; POST body over `maxBodyBytes`
  → 413; body within limit processed normally.

## Hardening (post-review)

A general-purpose code review (whole-diff vs `main`) flagged four real issues; all fixed:

- **(Critical) Reachable throw outside the never-throw boundary.** `buildParamHeaders` →
  `encodeHeaderValue` throws on a non-integer value for an integer-annotated `x-mcp-header`
  param, and the header block sat *before* the fetch try — re-creating the stream-poisoning
  item 1 set out to kill. Wrapped the param-header block so any throw routes through
  `#failRequest`. Regression test added (`tools/call` with a fractional value → error frame
  + transport still usable).
- **(Important) `retry: 0` hot-spin.** Server-supplied reconnect hint is now floored at
  `MIN_GET_RECONNECT_MS` (100ms) so it can't drive a no-delay reconnect loop.
- **(Minor) Duplicate `notifications/initialized` orphaned a reconnect loop.**
  `#openGETStream` now aborts the prior controller before re-opening.
- **(Minor) `#failRequest` enqueue-after-close race.** The enqueue is wrapped in try/catch
  for the dispose race (the controller is closed, never nulled).

## Verification

- Build 18/18 successful.
- Full workspace test suite green (http-client 55, http-server 44, host 64, session 59,
  cli 102, …) — zero failures.
- Lint clean (biome, 293 files).
