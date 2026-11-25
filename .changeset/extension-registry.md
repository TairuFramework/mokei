---
"@mokei/context-protocol": patch
"@mokei/context-server": patch
"@mokei/context-client": patch
"@mokei/host": patch
"@mokei/host-node": patch
"@mokei/session": patch
"@mokei/session-node": patch
"@mokei/flow-host-node": patch
---

Breaking: `ContextClient` no longer declares the Tasks extension by default. Pass `tasks: true` (also accepted by `ContextHost`, `NodeContextHost`, `createHostedContext`, `Session` and `NodeSession`) to receive task results, as the MCP extensions spec requires explicit opt-in. With `tasks: false`, `client.tasks.*`, `waitForTask` and listening with `taskIds` are refused locally with `ExtensionNotDeclaredError`.

Breaking: `HandlerRequest.clientCapabilities` is now required in `@mokei/context-server`. Code that builds `HandlerRequest` objects by hand must supply it.

Extensions are described by a registry in `@mokei/context-protocol` (`EXTENSIONS`, `readExtension`). A peer declaring an extension with an unknown settings `revision` is treated as not supporting it. `ContextClient.getServerExtension()` reads the server's declared extensions. Servers gate extension methods from the registry and advertise extensions per revision: through `initialize` on `2025-11-25` where an extension supports that revision, and through `server/discover` on `2026-07-28`.
