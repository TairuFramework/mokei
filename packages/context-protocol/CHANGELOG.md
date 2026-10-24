# @mokei/context-protocol

## 0.15.0

### Minor Changes

- Add the MCP Tasks extension for 2026-07-28: durable server tasks, task input and cancellation, authorised subscriptions, automatic client waiting, HTTP routing. Task input history persists in `TaskRecord.inputs`; withdrawn requests reject with `InputRequestWithdrawnError` and identical `requestInput` replays settle outcomes. `TaskManager.update` rejects non-outstanding keys with -32602. Add MRTR (SEP-2322) fixes: typed `allowInputRequired`, empty `inputRequests` rejected, exported `defaultMintRequestState`.

- Breaking: error classes and positional constructors take a single params object (`new TokenVerificationError({ code, message })`, `ProxyHost({ client })`) with read-only getters and exported `<ClassName>Params` types. `ContextHost` drops `_contexts`, `_localTools`, `_events`, `_dispose`; use `contexts`, `localTools`, `events` and `ContextHostParams.dispose`. `initializeTimeout` → `setupTimeout`. Flow-host drops `TERMINAL_STATES`; use `isTerminalRunState` from flow-client.
