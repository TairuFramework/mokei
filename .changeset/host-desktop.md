---
'@mokei/host-desktop': patch
'@mokei/host': patch
---

Add `@mokei/host-desktop`, a Node-only package that answers MCP elicitation with native desktop dialogs (`alerter` or `osascript` on macOS, `zenity` on Linux) and desktop notifications. `createDesktopElicitHandler` runs as a `ContextHost` `elicit` handler in a blocking `dialog` mode or an `inbox` mode, where `createInputInbox` holds each request as a pending entry the application answers, declines, cancels or prompts through its own registered answer surface, so long-running task input no longer depends on one dialog staying open. `createDesktopTools` adds `notify` and `ask_user` local tools, returned with a `dispose()` for the runner it creates itself.

`AddDirectContextParams.config` in `@mokei/host` is now `Omit<ServerParams, 'transport'>` instead of `ServerConfig`, so `addDirectContext` accepts the server params it already passed through at runtime, such as `subscriptions`. Existing `ServerConfig` values still type-check.
