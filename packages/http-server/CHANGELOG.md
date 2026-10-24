# @mokei/http-server

## 0.15.0

### Minor Changes

- Server OAuth exports removed in favour of `@teikyo/oauth`. `serveHTTP` is async, returns a `@sozai/http-server` `HTTPServer` (use `server.url`), answers `503` for verifier outages, and derives protected resource metadata from `auth.resource` (`auth.resourceMetadataURL` removed). Add `mcpPlugin` and `HTTPHandler.shutdown()`. JWKS and metadata fetch failures return 500 instead of 401. The OAuth client clears tokens and re-authorises on `invalid_grant`.

- Add the MCP Tasks extension for 2026-07-28: durable server tasks, task input and cancellation, authorised subscriptions, automatic client waiting, HTTP routing. Task input history persists in `TaskRecord.inputs`; withdrawn requests reject with `InputRequestWithdrawnError` and identical `requestInput` replays settle outcomes. `TaskManager.update` rejects non-outstanding keys with -32602. Add MRTR (SEP-2322) fixes: typed `allowInputRequired`, empty `inputRequests` rejected, exported `defaultMintRequestState`.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.

- Align with the current stack line: `@enkaku/*` 0.22.2, `@kokuin/token` 0.6.2, `@hozon/db` 0.5 (registering a different store definition under a taken name now throws `StoreAlreadyRegisteredError`), `@tejika/*`, `@sozai/*` and `@teikyo/oauth` on their OpenTelemetry v3 releases. Consumers sharing `@enkaku` and `@kokuin` types must upgrade in step. No mokei API changes.

### Patch Changes

- Updated dependencies:
  - @mokei/context-protocol@0.15.0
  - @mokei/context-server@0.15.0
  - @mokei/logger@0.15.0
