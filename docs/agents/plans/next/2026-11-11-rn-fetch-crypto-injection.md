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
