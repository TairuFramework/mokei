## 0.14.0

### Minor Changes

- Error classes and classes with positional constructors now take a single params object and expose their state through read-only getters. For example, `new TokenVerificationError(code, message)` becomes `new TokenVerificationError({ code, message })`, and an optional `cause` is accepted in the same object. Property reads such as `error.code` are unchanged. `ProxyHost` now takes `{ client }`. `SystemOneBackendClientOptions` is removed; use `SystemOneClientParams`.

  `ContextHost` no longer exposes its `_contexts`, `_localTools`, `_events` and `_dispose` members. Use `contexts`, `localTools` and `events`. Subclasses register contexts through `hasContext` / `registerHostedContext`, and can pass teardown through the new `ContextHostParams.dispose`, which runs both on `dispose()` and when the host is aborted.

- The JWKS verifier now reports a failed or oversized AS-metadata or JWKS fetch, and a non-https OAuth endpoint, as a plain `Error`, so `serveHTTP` answers HTTP 500 rather than a 401 that sends clients back into authorisation. Its loopback check also accepts `[::1]` and `*.localhost` hosts.

  When a refresh is rejected with `invalid_grant`, the OAuth client middleware clears the stored tokens (unless another flight already replaced them) and re-authorises instead of retrying the dead refresh token. Non-2xx OAuth responses are drained before throwing.

### Patch Changes

- Updated dependencies:
  - @mokei/context-client@0.14.0
  - @mokei/context-protocol@0.14.0
  - @mokei/logger@0.14.0
