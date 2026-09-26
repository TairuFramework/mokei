## 0.14.0

### Minor Changes

- Error classes and classes with positional constructors now take a single params object and expose their state through read-only getters. For example, `new TokenVerificationError(code, message)` becomes `new TokenVerificationError({ code, message })`, and an optional `cause` is accepted in the same object. Property reads such as `error.code` are unchanged. `ProxyHost` now takes `{ client }`. `SystemOneBackendClientOptions` is removed; use `SystemOneClientParams`.

  `ContextHost` no longer exposes its `_contexts`, `_localTools`, `_events` and `_dispose` members. Use `contexts`, `localTools` and `events`. Subclasses register contexts through `hasContext` / `registerHostedContext`, and can pass teardown through the new `ContextHostParams.dispose`, which runs both on `dispose()` and when the host is aborted.

### Patch Changes

- Updated dependencies:
  - @mokei/context-protocol@0.14.0
