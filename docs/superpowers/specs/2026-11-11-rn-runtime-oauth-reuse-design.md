# React Native fetch and crypto injection, kokuin OAuth reuse, sign-in deadline

**Status:** next (2 of 3). Design approved 2026-11-11. Waits on the `@kokuin/oauth` release adding
token-request `extraParams`, `fetchOAuthJSON` GET support and `*.localhost` loopback (requested
upstream).
**Requested by:** Yosura (mobile phase; shared `ContextHost` with interactive sign-in)

## Why

React Native hosts cannot run the HTTP transport and OAuth client unchanged: PKCE uses
`crypto.subtle.digest`, which the Expo crypto polyfill lacks, and the transport always calls
`globalThis.fetch` while Yosura needs `expo/fetch` for streaming. Separately, an interactive
sign-in longer than the request timeout (default 30s) aborts: `HTTPTransport` starts its timer
before the wrapped fetch, and the OAuth middleware awaits the `AuthorizationHandler` inside it.

## Approved design

- **Runtime injection.** `runtime?: Runtime` (`@sozai/runtime`, default `createRuntime()`) on
  `HTTPTransportParams`, `HTTPContextParams` (`ContextHost.addHTTPContext`, `Session` pass-through)
  and `OAuthClientConfig`. The transport's base fetch is `runtime.fetch`; `fetchMiddleware` still
  wraps it. React Native passes `@sozai/runtime-expo`'s `createRuntime({ fetch: expoFetch })`.
  Chosen over separate `fetch`/`crypto` options (a mokei-only shape) and global polyfills (no
  `subtle.digest` polyfill exists).
- **Reuse `@kokuin/oauth` instead of custom logic** (user direction: prefer it wherever it fits):
  PKCE and `state` (`generateCodeVerifier`, `deriveCodeChallenge`, `generateState`, noble sha256,
  no `crypto.subtle`), the authorization URL (`buildAuthorizationURL`, `resource` through
  `authorizationParams`), the code exchange and refresh (`exchangeCode` / `refreshToken` with
  `extraParams: { resource, scope }`), and the OAuth JSON fetch including metadata GETs. Keep
  mokei's `invalid_grant` store clearing by mapping `OAuthTokenError.code`.
- **Sign-in outside the request deadline.** The `AuthorizationHandler` wait is excluded from the
  request timeout and gets its own budget (`authorizationTimeout`, default about 10 minutes),
  still honouring the caller's `AbortSignal`. Network requests keep the normal timeout.
- Tests: injected fetch used by every transport request and the token exchange; injected
  `getRandomValues` drives verifier and `state`; RFC 7636 challenge vector; a sign-in slower than
  the request timeout succeeds while one past its own budget or aborted fails; defaults unchanged.
- Release: patch changeset.

## Implementation calls (builder, 2026-11-11)

- **Deadline mechanism.** The per-request timer moves from around the whole middleware chain into
  the transport's base fetch (`runtime.fetch` wrapped with a time-to-headers timeout). Every
  network call -- the MCP POST, GET stream, DELETE, and the OAuth discovery and token calls made
  through `next` -- gets its own timeout, and the `AuthorizationHandler` wait, which makes no
  network call, is outside every one. The internal `tools/list` refresh keeps its shorter
  `refreshTimeout` through a symbol-keyed `RequestInit` field the base fetch reads (spread by
  `attach`, so it survives the OAuth middleware). A timeout surfaces with the same
  `Request timed out after <ms>ms` message as today.
- **Authorization budget.** `OAuthClientConfig.authorizationTimeout` (milliseconds, default
  `600_000`): the handler gets `AbortSignal.any([callerSignal, timeout])`.
- **Authorization URL** from kokuin `buildAuthorizationURL`, which omits an empty `scope` from
  `@kokuin/oauth` 0.7.4 (follow-up PR #52; before it sent `scope=`). Revocation moves to kokuin's `fetchOAuthJSON`, which accepts an empty `200`
  body (RFC 7009) by default from `@kokuin/oauth` 0.7.3 (user decision); mokei's `fetch.ts` goes.
- **Errors.** Token and discovery failures now surface as kokuin's `OAuthTokenError`
  (`status`, `code`); `invalid_grant` handling checks its `code`. `OAuthResponseError` was never
  exported, so no public API changes.
- **OAuth's own network calls keep a deadline.** Discovery, token and refresh calls the middleware
  makes through `next` carry the triggering request's timeout tag, so a hung authorization server
  still fails at `timeout` (today the outer POST timer covers them). Untagged requests (GET stream,
  DELETE) keep today's timing.

## Additions (Yosura design review, user-approved 2026-11-11)

### Setup deadline and sign-in

`ContextClient`'s setup deadline (`setupTimeout`, 30s) arms only after the setup request's
`write` resolves, and `HTTPTransport.write` resolves only when the POST (including a sign-in)
completes. A sign-in therefore never runs under the setup deadline, on `2025-11-25`, `2026-07-28` or
`'auto'`. Verified by a probe; no `@mokei/context-client` change. A regression test pins it: a
sign-in longer than `setupTimeout` completes setup on all three.

### Credential redirect safety

Default fetch redirect following can carry a credential to another origin: the Fetch standard strips
`Authorization` on cross-origin redirects, but not custom headers (`auth` with a custom header name,
`headers`), and React Native's behaviour is unspecified.

- The transport's base fetch treats a request as credentialed when it carries `Authorization` or any
  header name from the transport's `headers` / `auth`. A credentialed request is sent with
  `redirect: 'manual'` (an explicit `'error'` from the caller is kept).
- A `3xx` or `opaqueredirect` response to a credentialed request is not followed: it fails with
  `Request failed: refused to follow a redirect with credentials (status <n>)`.
- Uncredentialed requests keep the default (follow). No same-origin re-follow: MCP endpoints have no
  reason to redirect, and a manual follow would have to handle method changes on `301/302/303`.

### No-content telemetry

`PayloadCapture` gains `'never'`: the host, session and daemon `tracing.payloads` option accepts it.

- `resolveContentCapture('never')` returns `'never'`; `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`
  cannot override it (it still overrides an unset or `'off'` value, as today).
- Under `'never'` no request/response/tool content is captured (same as `'off'`), and no error
  message text reaches span status, span attributes or host observation events: only `error.type`,
  the JSON-RPC error code and the status code.
- Enforced at the sinks: `endSpanError` takes the capture and drops the message under `'never'`;
  `sanitizeMessage` and `responseOutcome` drop `error.message`. Every caller in `context-client`,
  `host`, `host-node` and `session` passes the resolved capture.
- Host-level, not per-context: Yosura runs one host per device. Per-context capture is not added.
