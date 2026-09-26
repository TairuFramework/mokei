## 0.14.0

### Minor Changes

- Error classes and classes with positional constructors now take a single params object and expose their state through read-only getters. For example, `new TokenVerificationError(code, message)` becomes `new TokenVerificationError({ code, message })`, and an optional `cause` is accepted in the same object. Property reads such as `error.code` are unchanged. `ProxyHost` now takes `{ client }`. `SystemOneBackendClientOptions` is removed; use `SystemOneClientParams`.

  `ContextHost` no longer exposes its `_contexts`, `_localTools`, `_events` and `_dispose` members. Use `contexts`, `localTools` and `events`. Subclasses register contexts through `hasContext` / `registerHostedContext`, and can pass teardown through the new `ContextHostParams.dispose`, which runs both on `dispose()` and when the host is aborted.

- BREAKING: stdio `Session.addContext` and the `NodeContextHost`-typed `contextHost` moved to `NodeSession` in the new `@mokei/session-node` package. Import `NodeSession` for spawned MCP servers. `@mokei/session` now uses portable `ContextHost` and is React Native / Metro-safe; `AgentSession` accepts either session class.

  Stdio setup and abort cleanup now preserve a pre-existing or replacement context with the same key: `NodeContextHost.addLocalContext` rejects a concurrent spawn under a key already being spawned, and `ContextHost.setup` fails if the context under its key was replaced while it ran.

### Patch Changes

- Updated dependencies:
  - @mokei/context-protocol@0.14.0
  - @mokei/context-rpc@0.14.0
  - @mokei/host@0.14.0
  - @mokei/model-provider@0.14.0
