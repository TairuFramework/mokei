# React Native runtime, kokuin OAuth reuse, sign-in deadline, redirect safety, no-content telemetry

**Status:** complete (2026-11-11). Requested by Yosura (one `ContextHost` per device on React
Native, interactive OAuth sign-in); the redirect-safety, no-content telemetry and setup-deadline
items came from Yosura's design review and were folded in with the user's approval.

## What was built

- **Runtime injection.** `HTTPTransport`, `ContextHost.addHTTPContext` (and `Session` through it)
  and `createOAuthMiddleware` take `runtime?: Runtime` from `@sozai/runtime` (default
  `createRuntime()`). Its `fetch` is the transport's base fetch; its `getRandomValues` drives PKCE
  and `state`. React Native passes `@sozai/runtime-expo`'s `createRuntime({ fetch })`. Chosen over
  separate `fetch`/`crypto` options (mokei-only shape) and global polyfills (no `subtle.digest`
  polyfill exists). The runtime must still provide `AbortSignal.timeout`/`AbortSignal.any`, which
  mokei and `@kokuin/oauth` already used.
- **Sign-in outside the request deadline.** The request timeout moved from around the whole
  middleware chain into the base fetch, applied per network call through an internal
  symbol-keyed `RequestInit` tag (`REQUEST_TIMEOUT`) that `fetchMiddleware`s keep by spreading
  `init`. The `AuthorizationHandler` wait has its own budget, `authorizationTimeout` (default
  `600_000` ms), raced against the caller's signal; OAuth's own discovery and token calls inherit
  the triggering request's tag. The schema-refresh `tools/list` keeps a whole-refresh
  `refreshTimeout` timer (body read included). The `ContextClient` setup deadline needed no change:
  it arms only after the setup request's `write` resolves, which is after the POST and any sign-in.
- **OAuth on `@kokuin/oauth` 0.7.4.** PKCE, `state`, the authorisation URL (`resource` through
  `authorizationParams`, empty `scope` omitted), code exchange and refresh (`extraParams`
  `resource`/`scope`), metadata GETs and revocation (empty `200` accepted). `invalid_grant` and
  `unsupported_token_type` read `OAuthTokenError.code`. mokei's own OAuth fetch and PKCE modules are
  gone; its stricter https/loopback discovery checks and the bearer `token_type` check stay. Error
  text is now kokuin's.
- **Credential redirect safety.** A request carrying `Authorization` or any static `headers`/`auth`
  header name goes out with `redirect: 'manual'` (a caller's `'error'` is kept). A `3xx` or
  `opaqueredirect` answer fails the request, and so does a response with `redirected: true` (a fetch
  that followed natively). No same-origin re-follow.
- **`payloads: 'never'`.** New `PayloadCapture` value: no payloads and no error message text in span
  status, attributes or sanitised messages, only error codes and types;
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` cannot override it. Enforced at the sinks
  (`endSpanError`, `responseOutcome`, `sanitizeMessage`) with every caller in context-client, host,
  host-node and session passing the resolved capture. Host-level, not per-context.

## Follow-ons

Deferred minors are listed in `backlog/2026-09-04-oauth-hardening-followups.md`.
